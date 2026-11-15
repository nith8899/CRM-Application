'use strict';
// M18 - Forecast categories, immutable snapshots, submissions, accuracy.
const express = require('express');
const db = require('../db');
const A = require('../core/access');
const hooks = require('../core/hooks');
const { audit } = require('../core/audit');
const { notify } = require('../core/notify');
const { bad, forbidden, notFound, wrap } = require('../core/errors');
const { entities } = require('../entities');

const router = express.Router();

function periodRange(label) {
  let m = /^(\d{4})-Q([1-4])$/.exec(label || '');
  if (m) { const y = +m[1]; const q = +m[2]; const s = new Date(Date.UTC(y, (q - 1) * 3, 1)); const e = new Date(Date.UTC(y, q * 3, 0)); return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) }; }
  m = /^(\d{4})-(\d{2})$/.exec(label || '');
  if (m) { const s = new Date(Date.UTC(+m[1], +m[2] - 1, 1)); const e = new Date(Date.UTC(+m[1], +m[2], 0)); return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) }; }
  m = /^(\d{4})$/.exec(label || '');
  if (m) return { start: `${m[1]}-01-01`, end: `${m[1]}-12-31` };
  return null;
}
const currentQuarter = () => { const d = new Date(); return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };

async function openOppRows(ctx, range) {
  const params = []; const sc = await A.scopeClause('opportunities', ctx, params, 'V', 't');
  params.push(range.start, range.end);
  const { rows } = await db.query(
    `SELECT t.id, t.number, t.name, t.stage, t.probability, t.amount_base, t.forecast_category, t.close_date, t.country, t.owner_id, u.name owner_name, a.legal_name account_name,
            round(t.amount_base * t.probability / 100, 2)::float weighted
     FROM opportunities t JOIN users u ON u.id=t.owner_id JOIN accounts a ON a.id=t.account_id
     WHERE t.is_deleted=false AND t.status='Open' AND t.close_date BETWEEN $${params.length - 1} AND $${params.length} ${sc ? 'AND ' + sc : ''}`, params);
  return rows;
}

router.get('/forecast/summary', wrap(async (req, res) => {
  const ctx = req.ctx;
  if (!A.can(ctx, 'M18', 'V')) throw forbidden();
  const period = req.query.period || currentQuarter(); const range = periodRange(period);
  if (!range) throw bad('Invalid period. Use YYYY-Qn, YYYY-MM or YYYY');
  const open = await openOppRows(ctx, range);
  const sumBy = (arr, f) => arr.reduce((a, r) => a + (r[f] || 0), 0);
  const cats = ['Commit', 'Best case', 'Pipeline'].map((c) => { const r = open.filter((o) => o.forecast_category === c); return { category: c, count: r.length, amount: sumBy(r, 'amount_base'), weighted: sumBy(r, 'weighted') }; });
  const params = []; const sc = await A.scopeClause('opportunities', ctx, params, 'V', 't'); params.push(range.start, range.end);
  const won = (await db.query(`SELECT COALESCE(sum(t.amount_base),0)::float amount, count(*)::int n FROM opportunities t WHERE t.is_deleted=false AND t.status='Won' AND t.closed_at::date BETWEEN $${params.length - 1} AND $${params.length} ${sc ? 'AND ' + sc : ''}`, params)).rows[0];
  const byOwner = {};
  for (const o of open) { const x = (byOwner[o.owner_id] ||= { owner_id: o.owner_id, owner_name: o.owner_name, commit: 0, best_case: 0, pipeline: 0, weighted: 0 }); const k = o.forecast_category === 'Commit' ? 'commit' : o.forecast_category === 'Best case' ? 'best_case' : 'pipeline'; x[k] += o.amount_base || 0; x.weighted += o.weighted; }
  const { rows: subs } = await db.query(`SELECT s.*, u.name owner_name FROM forecast_submissions s JOIN users u ON u.id=s.owner_id WHERE s.period_label=$1 AND s.is_deleted=false AND ($2::boolean OR s.owner_id=$3 OR s.owner_id = ANY($4::bigint[])) ORDER BY u.name`, [period, ctx.isAdmin || A.scopesFor(ctx, 'M18', 'V').has('G'), ctx.id, await A.reportIds(ctx)]);
  // accuracy: latest period-start snapshot commit vs actual won
  const { rows: snap } = await db.query(`SELECT * FROM forecast_snapshots WHERE period_label=$1 ORDER BY taken_at ASC LIMIT 1`, [period]);
  let accuracy = null;
  if (snap[0]) accuracy = { snapshot: snap[0].label, taken_at: snap[0].taken_at, forecast_commit: snap[0].total_commit, actual_won: won.amount, pct: snap[0].total_commit > 0 ? Math.round(won.amount / snap[0].total_commit * 1000) / 10 : null };
  res.json({ period, range, closed_won: won, categories: cats, by_owner: Object.values(byOwner), submissions: subs, accuracy, opportunities: open.sort((a, b) => b.amount_base - a.amount_base).slice(0, 100) });
}));

router.post('/forecast/snapshots', wrap(async (req, res) => {
  const ctx = req.ctx;
  if (!A.can(ctx, 'M18', 'E') && !A.can(ctx, 'M18', 'A') && !ctx.isAdmin) throw forbidden();
  const period = (req.body || {}).period_label || currentQuarter(); const range = periodRange(period);
  if (!range) throw bad('Invalid period');
  const id = await takeSnapshot(ctx, { type: req.body.snapshot_type || 'Manual', label: req.body.label || `${period} snapshot ${new Date().toISOString().slice(0, 10)}`, period });
  res.status(201).json({ id });
}));
async function takeSnapshot(ctx, { type, label, period }) {
  const range = periodRange(period);
  const open = await openOppRows(ctx, range);
  return db.tx(async (c) => {
    const tot = (f) => open.reduce((a, r) => a + (f(r) || 0), 0);
    const { rows } = await c.query(`INSERT INTO forecast_snapshots (label, snapshot_type, period_label, taken_at, taken_by, total_pipeline, total_weighted, total_commit, opp_count) VALUES ($1,$2,$3,now(),$4,$5,$6,$7,$8) RETURNING id`,
      [label, type, period, ctx.id, tot((r) => r.amount_base), tot((r) => r.weighted), tot((r) => (r.forecast_category === 'Commit' ? r.amount_base : 0)), open.length]);
    for (const o of open) await c.query(`INSERT INTO forecast_snapshot_rows (snapshot_id, opportunity_id, opp_number, opp_name, account_name, owner_id, owner_name, country, stage, probability, amount_base, weighted, forecast_category, close_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [rows[0].id, o.id, o.number, o.name, o.account_name, o.owner_id, o.owner_name, o.country, o.stage, o.probability, o.amount_base, o.weighted, o.forecast_category, o.close_date]);
    await audit(ctx, { event: 'forecast_snapshot', entity: 'forecast_snapshots', recordId: rows[0].id, label, detail: `${open.length} opportunities` }, c);
    return rows[0].id;
  });
}
router.get('/forecast/snapshots/:id/rows', wrap(async (req, res) => {
  if (!A.can(req.ctx, 'M18', 'V')) throw forbidden();
  const { rows: s } = await db.query('SELECT * FROM forecast_snapshots WHERE id=$1', [req.params.id]); if (!s[0]) throw notFound();
  const { rows } = await db.query('SELECT * FROM forecast_snapshot_rows WHERE snapshot_id=$1 ORDER BY amount_base DESC', [req.params.id]);
  res.json({ snapshot: s[0], rows });
}));

hooks.register('forecast_submissions', {
  async validate(ctx, v, existing) {
    const e = [];
    if (!periodRange(v.period_label)) e.push({ field: 'period_label', message: 'Use YYYY-Qn, YYYY-MM or YYYY' });
    if (Number(v.commit_amount) > Number(v.best_case_amount)) e.push({ field: 'commit_amount', message: 'Commit cannot exceed best case' });
    if (!existing) { const { rows } = await db.query('SELECT 1 FROM forecast_submissions WHERE owner_id=$1 AND period_label=$2 AND is_deleted=false', [v.owner_id || ctx.id, v.period_label]); if (rows.length) e.push({ field: 'period_label', message: 'You already have a submission for this period' }); }
    return e;
  },
  async beforeCreate(ctx, v) {
    const range = periodRange(v.period_label);
    const { rows } = await db.query(`SELECT COALESCE(sum(amount_base) FILTER (WHERE forecast_category='Commit'),0)::float c, COALESCE(sum(amount_base) FILTER (WHERE forecast_category IN ('Commit','Best case')),0)::float b FROM opportunities WHERE owner_id=$1 AND status='Open' AND is_deleted=false AND close_date BETWEEN $2 AND $3`, [v.owner_id, range.start, range.end]);
    v.system_commit = rows[0].c; v.system_best_case = rows[0].b; v.status = 'Draft';
  },
});
entities.forecast_submissions.actions = {
  submit: { label: 'Submit forecast', perm: 'S', async run(ctx, s) {
    if (s.status !== 'Draft') throw bad('Already submitted');
    await db.query(`UPDATE forecast_submissions SET status='Submitted' WHERE id=$1`, [s.id]);
    const { manager_id } = (await db.query('SELECT manager_id FROM users WHERE id=$1', [s.owner_id])).rows[0];
    if (manager_id) await notify(manager_id, { type: 'forecast', title: `Forecast submitted: ${ctx.user.name} ${s.period_label}`, entity: 'forecast_submissions', recordId: s.id });
    await audit(ctx, { event: 'forecast_submitted', entity: 'forecast_submissions', recordId: s.id, label: s.period_label });
  } },
  review: { label: 'Review / adjust', perm: 'A', async run(ctx, s, b) {
    if (s.owner_id === ctx.id) throw forbidden('You cannot review your own forecast');
    if (b.manager_adjustment != null && b.manager_adjustment !== '' && !b.reason) throw bad('A reason is required for an adjustment');
    await db.query(`UPDATE forecast_submissions SET status=$2, manager_adjustment=$3, adjustment_reason=$4 WHERE id=$1`, [s.id, b.manager_adjustment ? 'Adjusted' : 'Reviewed', b.manager_adjustment || null, b.reason || null]);
    await audit(ctx, { event: 'forecast_reviewed', entity: 'forecast_submissions', recordId: s.id, label: s.period_label, detail: b.reason });
  } },
};

module.exports = { router, takeSnapshot, periodRange, currentQuarter };
