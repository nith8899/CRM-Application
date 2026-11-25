'use strict';
// M35 - Claims & reimbursement (approval and payment kept separate); M17 - commission estimation.
const express = require('express');
const db = require('../db');
const A = require('../core/access');
const hooks = require('../core/hooks');
const fx = require('../core/fx');
const settings = require('../core/settings');
const { audit } = require('../core/audit');
const { notify, notifyRole } = require('../core/notify');
const { nextNumber } = require('../core/numbering');
const { bad, forbidden, notFound, wrap } = require('../core/errors');
const { entities } = require('../entities');
const crud = require('../core/crud');
const approvals = require('./approvals');

const router = express.Router();
const today = () => new Date().toISOString().slice(0, 10);
const EDITABLE = ['Draft', 'Returned'];

entities.claims.lockedWhen = (r) => !EDITABLE.includes(r.status);
entities.claims.lockedMsg = 'Claims can only be edited while Draft or Returned';

async function recalcClaim(claimId, c = db) {
  await c.query(`UPDATE claims SET total_amount=COALESCE((SELECT sum(claim_amount) FROM claim_lines WHERE claim_id=$1 AND is_deleted=false),0),
     approved_amount=COALESCE((SELECT sum(COALESCE(approved_amount, claim_amount)) FROM claim_lines WHERE claim_id=$1 AND is_deleted=false),0), modified_at=now() WHERE id=$1`, [claimId]);
}

// ---------------------------------------------------------------- claim lines
hooks.register('claim_lines', {
  async validate(ctx, v, existing) {
    const errs = [];
    const { rows } = await db.query('SELECT status, owner_id, currency FROM claims WHERE id=$1 AND is_deleted=false', [v.claim_id]);
    const cl = rows[0];
    if (!cl) return [{ field: 'claim_id', message: 'Claim not found' }];
    if (!EDITABLE.includes(cl.status)) errs.push({ field: 'claim_id', message: 'Lines can only be changed while the claim is Draft or Returned' });
    if (cl.owner_id !== ctx.id && !ctx.isAdmin) errs.push({ field: 'claim_id', message: 'Only the claimant can change claim lines' });
    if (!(Number(v.amount) > 0)) errs.push({ field: 'amount', message: 'Amount must be greater than zero' });
    if (v.expense_date > today()) errs.push({ field: 'expense_date', message: 'Expense date cannot be in the future' });
    return errs;
  },
  async beforeCreate(ctx, v, c) { await prep(v, c); },
  async beforeUpdate(ctx, v, existing, c) { await prep({ ...existing, ...v, _target: v }, c); },
  async afterCreate(ctx, l, c) { await recalcClaim(l.claim_id, c); },
  async afterUpdate(ctx, l, old, c) { await recalcClaim(l.claim_id, c); },
  async afterDelete(ctx, l, c) { await recalcClaim(l.claim_id, c); },
});
async function prep(v, c) {
  const { rows } = await c.query('SELECT currency FROM claims WHERE id=$1', [v.claim_id]);
  const claimCcy = rows[0].currency;
  const rate = await fx.rate(v.currency, claimCcy, v.expense_date, c);
  const target = v._target || v;
  target.fx_rate = rate; target.claim_amount = fx.round2(Number(v.amount) * rate);
  const { rows: cat } = await c.query('SELECT * FROM claim_categories WHERE id=$1', [v.category_id]);
  const flags = [];
  if (cat[0]) {
    if (cat[0].limit_per_claim && target.claim_amount > cat[0].limit_per_claim) flags.push(`Exceeds category limit of ${cat[0].limit_per_claim}`);
    if (cat[0].receipt_threshold != null && target.claim_amount > cat[0].receipt_threshold && !v.receipt_attached) flags.push('Receipt required above threshold');
    if (cat[0].requires_attendees && !v.attendees) flags.push('Attendee list required');
  }
  const maxAge = await settings.get('claim_max_age_days', 60);
  if (v.expense_date && (Date.now() - new Date(v.expense_date).getTime()) / 86400000 > maxAge) flags.push(`Expense older than ${maxAge} days`);
  const { rows: dup } = await c.query(`SELECT 1 FROM claim_lines l JOIN claims cl ON cl.id=l.claim_id WHERE l.is_deleted=false AND l.merchant=$1 AND l.expense_date=$2 AND l.amount=$3 AND l.id<>$4 AND cl.owner_id=(SELECT owner_id FROM claims WHERE id=$5) LIMIT 1`, [v.merchant || null, v.expense_date, v.amount, v.id || 0, v.claim_id]);
  if (dup.length && v.merchant) flags.push('Possible duplicate expense');
  target.policy_flags = flags;
}

// ------------------------------------------------------------------- claims
hooks.register('claims', {
  async beforeCreate(ctx, v) { v.status = 'Draft'; v.payment_status = 'Not ready'; v.total_amount = 0; v.approved_amount = 0; },
  async decorateOne(o, ctx) {
    o._can_submit = EDITABLE.includes(o.status) && (o.owner_id === ctx.id || ctx.isAdmin);
    if (o.status === 'In approval') {
      const { rows } = await db.query(`SELECT s.label, s.role_code FROM approval_steps s WHERE s.request_id=$1 AND s.status='Pending' LIMIT 1`, [o.approval_request_id]);
      o._pending_step = rows[0] && rows[0].label;
      if (rows[0] && rows[0].role_code === 'ROL-FINV') o._stage = 'Pending finance verification';
    }
    const { rows: ln } = await db.query('SELECT l.*, c.name AS category_name FROM claim_lines l JOIN claim_categories c ON c.id=l.category_id WHERE l.claim_id=$1 AND l.is_deleted=false ORDER BY l.expense_date, l.id', [o.id]);
    o._lines = ln;
    o._flags = ln.flatMap((l) => (l.policy_flags || []).map((f) => `Line ${l.description}: ${f}`));
    return o;
  },
});
approvals.registerHandler('claim', {
  async onApproved(ctx, req, info, c) {
    await recalcClaim(req.record_id, c);
    const { rows } = await c.query(`UPDATE claims SET status='Approved', payment_status='Ready for payment', verified_by=$2, verified_at=now() WHERE id=$1 RETURNING event_id, approved_amount, currency`, [req.record_id, ctx.id]);
    if (rows[0] && rows[0].event_id) await recalcEventCost(rows[0].event_id, c);
    await notifyRole('ROL-PAY', { type: 'claim_ready', title: `Claim ready for payment: ${req.record_label}`, entity: 'claims', recordId: req.record_id, dedupKey: `claim-ready-${req.record_id}` }, c);
  },
  async onRejected(ctx, req, info, c) { await c.query(`UPDATE claims SET status='Rejected', payment_status='Not ready' WHERE id=$1`, [req.record_id]); },
  async onReturned(ctx, req, info, c) { await c.query(`UPDATE claims SET status='Returned' WHERE id=$1`, [req.record_id]); },
  async onWithdrawn(ctx, req, info, c) { await c.query(`UPDATE claims SET status='Draft' WHERE id=$1`, [req.record_id]); },
});
async function recalcEventCost(eventId, c = db) {
  const { rows } = await c.query(`SELECT cl.approved_amount, cl.currency FROM claims cl WHERE cl.event_id=$1 AND cl.status='Approved' AND cl.is_deleted=false`, [eventId]);
  let sum = 0; for (const r of rows) sum += await fx.toBase(r.approved_amount, r.currency, null, c);
  await c.query('UPDATE events SET actual_cost=$2 WHERE id=$1', [eventId, sum]);
}

entities.claims.actions = {
  submit: { label: 'Submit claim', perm: 'S', async run(ctx, cl) {
    if (!EDITABLE.includes(cl.status)) throw bad(`Claim is ${cl.status}`);
    if (cl.owner_id !== ctx.id && !ctx.isAdmin) throw forbidden('Only the claimant can submit');
    const { rows: lines } = await db.query('SELECT * FROM claim_lines WHERE claim_id=$1 AND is_deleted=false', [cl.id]);
    const issues = [];
    if (!lines.length) issues.push('Add at least one expense line');
    for (const l of lines) for (const f of l.policy_flags || []) if (!/duplicate|older/i.test(f)) issues.push(`${l.description}: ${f}`);
    if (issues.length) throw bad('Claim fails policy validation (BRULE-CLM)', { checklist: issues });
    return db.tx(async (c) => {
      await recalcClaim(cl.id, c);
      const { rows } = await c.query('SELECT total_amount, currency FROM claims WHERE id=$1', [cl.id]);
      const amountBase = await fx.toBase(rows[0].total_amount, rows[0].currency, null, c);
      const r = await approvals.submit(ctx, { type: 'claim', entity: 'claims', recordId: cl.id, label: `${cl.number} ${cl.title}`, amount: rows[0].total_amount, currency: rows[0].currency, snapshot: { amount_base: amountBase, amount: rows[0].total_amount }, comment: cl.purpose }, c);
      if (!r.required) throw bad('No approval process is configured for claims. Contact an administrator.');
      await c.query(`UPDATE claims SET status='In approval', submitted_at=now(), approval_request_id=$2 WHERE id=$1`, [cl.id, r.request.id]);
      return { approval: r.request.number };
    });
  } },
  adjust: { label: 'Finance adjustment', perm: 'A', async run(ctx, cl, b) {
    if (!A.roleHas(ctx, 'ROL-FINV', 'ROL-ADM')) throw forbidden('Only Finance Verifiers can adjust approved amounts');
    if (cl.status !== 'In approval') throw bad('Claim is not in approval');
    const { rows: st } = await db.query(`SELECT 1 FROM approval_steps WHERE request_id=$1 AND status='Pending' AND role_code='ROL-FINV'`, [cl.approval_request_id]);
    if (!st.length && !ctx.isAdmin) throw bad('Finance verification is not the current step');
    if (!Array.isArray(b.lines) || !b.lines.length) throw bad('No lines supplied');
    await db.tx(async (c) => {
      for (const a of b.lines) {
        const { rows } = await c.query('SELECT claim_amount FROM claim_lines WHERE id=$1 AND claim_id=$2', [a.id, cl.id]);
        if (!rows[0]) continue;
        const amt = Number(a.approved_amount);
        if (!(amt >= 0) || amt > rows[0].claim_amount) throw bad('Approved amount must be between 0 and the claimed amount');
        if (amt !== rows[0].claim_amount && !a.reason) throw bad('An adjustment reason is required');
        await c.query('UPDATE claim_lines SET approved_amount=$2, adjust_reason=$3 WHERE id=$1', [a.id, amt, a.reason || null]);
      }
      await recalcClaim(cl.id, c);
      await audit(ctx, { event: 'claim_adjusted', entity: 'claims', recordId: cl.id, label: cl.number, detail: JSON.stringify(b.lines) }, c);
    });
  } },
  cancel: { label: 'Cancel claim', perm: 'E', async run(ctx, cl) { if (!EDITABLE.includes(cl.status)) throw bad('Only draft/returned claims can be cancelled'); await db.query(`UPDATE claims SET status='Cancelled' WHERE id=$1`, [cl.id]); await audit(ctx, { event: 'claim_cancelled', entity: 'claims', recordId: cl.id, label: cl.number }); } },
};

// Reviewer access: approvers (not in the claimant's scope) can read the claim while a step is theirs or after deciding
router.get('/claims/:id/review', wrap(async (req, res) => {
  const ctx = req.ctx;
  const { rows } = await db.query('SELECT * FROM claims WHERE id=$1 AND is_deleted=false', [req.params.id]);
  const cl = rows[0]; if (!cl) throw notFound();
  const own = cl.owner_id === ctx.id;
  const { rows: st } = await db.query(`SELECT 1 FROM approval_steps s WHERE s.request_id=$1 AND (s.approver_id=ANY($2::bigint[]) OR s.decided_by=$3 OR (s.approver_id IS NULL AND s.role_code=ANY($4::text[])))`, [cl.approval_request_id || 0, [ctx.id, ...ctx.delegators], ctx.id, [...ctx.roles]]);
  const viaScope = await crud.loadOne(entities.claims, cl.id, ctx);
  if (!own && !st.length && !viaScope && !ctx.isAdmin && !A.roleHas(ctx, 'ROL-AUD')) throw forbidden();
  const out = await hooks.get('claims').decorateOne({ ...cl }, ctx);
  await crud.resolveRefs(entities.claims, [out]);
  const { rows: who } = await db.query('SELECT name FROM users WHERE id=$1', [cl.owner_id]); out.claimant_name = who[0].name;
  res.json(out);
}));

// ---------------------------------------------------------- payments / batches
router.get('/claims-payments/ready', wrap(async (req, res) => {
  if (!A.can(req.ctx, 'M35', 'V') || !A.roleHas(req.ctx, 'ROL-PAY', 'ROL-FIN', 'ROL-ADM', 'ROL-FINV')) throw forbidden();
  const { rows } = await db.query(`SELECT cl.id, cl.number, cl.title, cl.approved_amount, cl.currency, cl.payment_status, cl.verified_by, u.name claimant FROM claims cl JOIN users u ON u.id=cl.owner_id WHERE cl.is_deleted=false AND cl.status='Approved' AND cl.payment_status IN ('Ready for payment','Failed') ORDER BY cl.id`);
  res.json(rows);
}));
router.post('/claims-payments/batches', wrap(async (req, res) => {
  const ctx = req.ctx;
  if (!A.roleHas(ctx, 'ROL-PAY', 'ROL-ADM')) throw forbidden('Only Payment Officers prepare reimbursement batches');
  const ids = (req.body || {}).claim_ids || [];
  if (!ids.length) throw bad('Select at least one claim');
  const out = await db.tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM claims WHERE id=ANY($1) AND status='Approved' AND payment_status IN ('Ready for payment','Failed') AND is_deleted=false`, [ids]);
    if (rows.length !== ids.length) throw bad('Some claims are not ready for payment');
    const ccy = rows[0].currency;
    if (rows.some((r) => r.currency !== ccy)) throw bad('A batch must contain claims of one currency');
    for (const r of rows) if (r.verified_by === ctx.id) throw forbidden(`Segregation of duties: you verified claim ${r.number}, so you cannot pay it (BRULE-WFL-009)`);
    const total = rows.reduce((a, r) => a + r.approved_amount, 0);
    const num = await nextNumber('PAY', c);
    const needAuth = total > (await settings.get('batch_authorise_threshold', 5000));
    const { rows: b } = await c.query(`INSERT INTO claim_batches (number, status, claim_count, total_amount, currency, prepared_by, created_by, modified_by) VALUES ($1,$2,$3,$4,$5,$6,$6,$6) RETURNING *`, [num, needAuth ? 'Pending authorisation' : 'Authorised', rows.length, total, ccy, ctx.id]);
    await c.query(`UPDATE claims SET payment_status='In batch', batch_id=$2 WHERE id=ANY($1)`, [ids, b[0].id]);
    await audit(ctx, { event: 'batch_created', entity: 'claim_batches', recordId: b[0].id, label: num, detail: `${rows.length} claims, ${total} ${ccy}` }, c);
    if (needAuth) await notifyRole('ROL-FIN', { type: 'batch_auth', title: `Reimbursement batch ${num} needs authorisation`, body: `${total} ${ccy}`, entity: 'claim_batches', recordId: b[0].id }, c);
    return b[0];
  });
  res.status(201).json(out);
}));
router.post('/claims-payments/batches/:id/authorise', wrap(async (req, res) => {
  const ctx = req.ctx;
  if (!A.roleHas(ctx, 'ROL-FIN', 'ROL-ADM')) throw forbidden('Only Finance can authorise batches');
  const { rows } = await db.query('SELECT * FROM claim_batches WHERE id=$1', [req.params.id]); const b = rows[0];
  if (!b) throw notFound(); if (b.status !== 'Pending authorisation') throw bad(`Batch is ${b.status}`);
  if (b.prepared_by === ctx.id) throw forbidden('The preparer cannot authorise their own batch');
  await db.query(`UPDATE claim_batches SET status='Authorised', authorised_by=$2 WHERE id=$1`, [b.id, ctx.id]);
  await audit(ctx, { event: 'batch_authorised', entity: 'claim_batches', recordId: b.id, label: b.number });
  res.json({ ok: true });
}));
router.post('/claims-payments/batches/:id/send', wrap(async (req, res) => {
  const ctx = req.ctx;
  if (!A.roleHas(ctx, 'ROL-PAY', 'ROL-ADM')) throw forbidden();
  const { rows } = await db.query('SELECT * FROM claim_batches WHERE id=$1', [req.params.id]); const b = rows[0];
  if (!b) throw notFound(); if (b.status !== 'Authorised') throw bad('Batch must be authorised first');
  await db.tx(async (c) => {
    await c.query(`UPDATE claim_batches SET status='Sent to payment', payment_date=$2 WHERE id=$1`, [b.id, req.body.payment_date || today()]);
    await c.query(`INSERT INTO integration_logs (integration_code, direction, entity, record_id, status, attempts, idempotency_key, payload) VALUES ('INT-19','Outbound','claim_batches',$1,'Pending',0,$2,$3) ON CONFLICT (idempotency_key) DO NOTHING`, [b.id, `INT-19-batch-${b.id}`, JSON.stringify({ number: b.number, total: b.total_amount })]);
    await audit(ctx, { event: 'batch_sent', entity: 'claim_batches', recordId: b.id, label: b.number }, c);
  });
  res.json({ ok: true });
}));
router.post('/claims-payments/batches/:id/result', wrap(async (req, res) => {
  const ctx = req.ctx;
  if (!A.roleHas(ctx, 'ROL-PAY', 'ROL-ADM')) throw forbidden();
  const { rows } = await db.query('SELECT * FROM claim_batches WHERE id=$1', [req.params.id]); const b = rows[0];
  if (!b) throw notFound(); if (b.status !== 'Sent to payment') throw bad('Batch has not been sent to payment');
  const results = (req.body || {}).results || [];
  await db.tx(async (c) => {
    let ok = 0; let fail = 0;
    for (const r of results) {
      if (r.status === 'Paid') { ok++; const { rows: cl } = await c.query(`UPDATE claims SET payment_status='Paid', paid_at=now(), payment_reference=$2 WHERE id=$1 AND batch_id=$3 RETURNING owner_id, number`, [r.claim_id, r.reference || b.bank_reference, b.id]); if (cl[0]) await notify(cl[0].owner_id, { type: 'claim_paid', title: `Claim ${cl[0].number} paid`, body: r.reference, entity: 'claims', recordId: r.claim_id }, c); }
      else { fail++; const { rows: cl } = await c.query(`UPDATE claims SET payment_status='Failed', batch_id=NULL, finance_note=$2 WHERE id=$1 AND batch_id=$3 RETURNING owner_id, number`, [r.claim_id, r.error || 'Payment failed', b.id]); if (cl[0]) await notify(cl[0].owner_id, { type: 'claim_failed', title: `Payment failed for claim ${cl[0].number}`, body: r.error, entity: 'claims', recordId: r.claim_id }, c); }
    }
    await c.query('UPDATE claim_batches SET status=$2, bank_reference=COALESCE($3,bank_reference) WHERE id=$1', [b.id, fail === 0 ? 'Paid' : ok === 0 ? 'Failed' : 'Partially paid', req.body.bank_reference || null]);
    await audit(ctx, { event: 'batch_result', entity: 'claim_batches', recordId: b.id, label: b.number, detail: `${ok} paid, ${fail} failed` }, c);
  });
  res.json({ ok: true });
}));
router.get('/claims-payments/batches/:id', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM claim_batches WHERE id=$1', [req.params.id]); if (!rows[0]) throw notFound();
  const { rows: cl } = await db.query('SELECT cl.id, cl.number, cl.title, cl.approved_amount, cl.currency, cl.payment_status, u.name claimant FROM claims cl JOIN users u ON u.id=cl.owner_id WHERE cl.batch_id=$1', [req.params.id]);
  res.json({ batch: rows[0], claims: cl });
}));

// ---------------------------------------------------------------- commission
router.post('/commission/calculate', wrap(async (req, res) => {
  const ctx = req.ctx;
  if (!A.can(ctx, 'M17', 'A') && !ctx.isAdmin) throw forbidden('Only Finance can calculate commission estimates');
  const { period_start, period_end, period_label, plan_id } = req.body || {};
  if (!period_start || !period_end || !period_label) throw bad('Period start, end and label are required');
  const { rows: pl } = await db.query(`SELECT * FROM commission_plans WHERE ${plan_id ? 'id=$1' : "status='Approved'"} AND is_deleted=false ORDER BY effective_from DESC LIMIT 1`, plan_id ? [plan_id] : []);
  const plan = pl[0]; if (!plan) throw bad('No approved commission plan found');
  const measure = plan.basis === 'Revenue' ? 'Closed Won revenue' : 'Gross profit';
  const { rows: targets } = await db.query(`SELECT * FROM sales_targets WHERE measure=$1 AND status='Active' AND is_deleted=false AND period_start<=$3 AND period_end>=$2`, [measure, period_start, period_end]);
  const out = [];
  await db.tx(async (c) => {
    for (const t of targets) {
      // credit: owner, adjusted by opportunity team splits (BRULE-OPP-011)
      const { rows } = await c.query(
        `SELECT COALESCE(SUM(CASE WHEN o.owner_id=$1 AND NOT EXISTS (SELECT 1 FROM opportunity_team x WHERE x.opportunity_id=o.id AND x.split_pct IS NOT NULL AND x.is_deleted=false) THEN ${plan.basis === 'Revenue' ? 'o.amount_base' : 'COALESCE(o.gross_profit,0)'} ELSE 0 END),0)::float own,
                COALESCE((SELECT SUM(${plan.basis === 'Revenue' ? 'o2.amount_base' : 'COALESCE(o2.gross_profit,0)'} * x.split_pct/100) FROM opportunity_team x JOIN opportunities o2 ON o2.id=x.opportunity_id WHERE x.user_id=$1 AND x.split_pct IS NOT NULL AND x.is_deleted=false AND o2.status='Won' AND o2.closed_at::date BETWEEN $2 AND $3 AND o2.is_deleted=false),0)::float split
         FROM opportunities o WHERE o.status='Won' AND o.is_deleted=false AND o.closed_at::date BETWEEN $2 AND $3`, [t.owner_id, period_start, period_end]);
      const basis = rows[0].own + rows[0].split;
      const target = await fx.toBase(t.target_value, t.currency, null, c);
      const att = target > 0 ? (basis / target) * 100 : 0;
      let amount = basis * plan.base_rate / 100;
      if (att > 100 && plan.accelerator_rate) amount += (basis - target) * (plan.accelerator_rate - plan.base_rate) / 100;
      if (plan.cap_pct) amount = Math.min(amount, target * plan.cap_pct / 100);
      amount = fx.round2(amount);
      const ex = await c.query('SELECT id FROM commission_records WHERE user_id=$1 AND period_label=$2 AND plan_id=$3 AND is_deleted=false', [t.owner_id, period_label, plan.id]);
      if (ex.rows[0]) await c.query(`UPDATE commission_records SET basis_amount=$2, attainment_pct=$3, amount=$4, status='Estimated', modified_at=now() WHERE id=$1 AND status IN ('Forecast','Estimated')`, [ex.rows[0].id, basis, att, amount]);
      else { const num = await nextNumber('COM', c); await c.query(`INSERT INTO commission_records (number, user_id, plan_id, period_label, basis_amount, attainment_pct, amount, currency, status, created_by, modified_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'USD','Estimated',$8,$8)`, [num, t.owner_id, plan.id, period_label, basis, att, amount, ctx.id]); }
      out.push({ user_id: t.owner_id, basis, attainment_pct: att, amount });
    }
    await audit(ctx, { event: 'commission_calculated', entity: 'commission_records', detail: `${period_label}: ${out.length} statements` }, c);
  });
  res.json({ count: out.length, rows: out });
}));
entities.commission_records.actions = {
  approve: { label: 'Approve statement', perm: 'A', async run(ctx, r) {
    if (!['Estimated', 'Under review'].includes(r.status)) throw bad(`Statement is ${r.status}`);
    await db.query(`UPDATE commission_records SET status='Approved' WHERE id=$1`, [r.id]); await audit(ctx, { event: 'commission_approved', entity: 'commission_records', recordId: r.id, label: r.number });
    await notify(r.user_id, { type: 'commission', title: `Commission statement ${r.period_label} approved`, entity: 'commission_records', recordId: r.id });
  } },
  export: { label: 'Export to payroll', perm: 'X', async run(ctx, r) {
    if (r.status !== 'Approved') throw bad('Only approved statements can be exported');
    await db.tx(async (c) => { await c.query(`UPDATE commission_records SET status='Exported' WHERE id=$1`, [r.id]); await c.query(`INSERT INTO integration_logs (integration_code, direction, entity, record_id, status, attempts, idempotency_key, payload) VALUES ('INT-12','Outbound','commission_records',$1,'Pending',0,$2,$3) ON CONFLICT (idempotency_key) DO NOTHING`, [r.id, `INT-12-com-${r.id}`, JSON.stringify({ number: r.number, amount: r.amount })]); await audit(ctx, { event: 'commission_exported', entity: 'commission_records', recordId: r.id, label: r.number }, c); });
  } },
};
router.get('/commission/my', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT number, period_label, basis_amount, attainment_pct, amount, currency, status FROM commission_records WHERE user_id=$1 AND is_deleted=false AND status IN ('Approved','Exported','Payable') ORDER BY id DESC`, [req.ctx.id]);
  res.json(rows);
}));
router.get('/targets/attainment', wrap(async (req, res) => {
  const ctx = req.ctx;
  const params = []; const sc = await A.scopeClause('sales_targets', ctx, params, 'V', 't');
  const { rows: ts } = await db.query(`SELECT t.*, u.name owner_name FROM sales_targets t JOIN users u ON u.id=t.owner_id WHERE t.is_deleted=false AND t.status='Active' ${sc ? 'AND ' + sc : ''} ORDER BY t.period_start DESC LIMIT 200`, params);
  const out = [];
  for (const t of ts) {
    let actual = 0;
    if (t.measure === 'Closed Won revenue' || t.measure === 'Gross profit') {
      const col = t.measure === 'Gross profit' ? 'COALESCE(gross_profit,0)' : 'amount_base';
      actual = (await db.query(`SELECT COALESCE(sum(${col}),0)::float s FROM opportunities WHERE owner_id=$1 AND status='Won' AND closed_at::date BETWEEN $2 AND $3 AND is_deleted=false`, [t.owner_id, t.period_start, t.period_end])).rows[0].s;
    } else if (t.measure === 'New pipeline') actual = (await db.query(`SELECT COALESCE(sum(amount_base),0)::float s FROM opportunities WHERE owner_id=$1 AND created_at::date BETWEEN $2 AND $3 AND is_deleted=false`, [t.owner_id, t.period_start, t.period_end])).rows[0].s;
    else if (t.measure === 'Activities') actual = (await db.query(`SELECT count(*)::int s FROM activities WHERE owner_id=$1 AND status='Completed' AND activity_date::date BETWEEN $2 AND $3 AND is_deleted=false AND counts_for_target`, [t.owner_id, t.period_start, t.period_end])).rows[0].s;
    const tb = t.measure === 'Activities' ? t.target_value : await fx.toBase(t.target_value, t.currency);
    out.push({ id: t.id, number: t.number, owner_name: t.owner_name, measure: t.measure, period_label: t.period_label, target: tb, actual, pct: tb > 0 ? Math.round(actual / tb * 1000) / 10 : null });
  }
  res.json(out);
}));

module.exports = { router, recalcClaim, recalcEventCost };
