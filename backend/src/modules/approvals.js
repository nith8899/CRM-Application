'use strict';
// M15 - configurable approval engine (also executes claim / event / config workflows from M33).
const express = require('express');
const db = require('../db');
const A = require('../core/access');
const { audit } = require('../core/audit');
const { nextNumber } = require('../core/numbering');
const { notify, notifyRole } = require('../core/notify');
const settings = require('../core/settings');
const { bad, forbidden, notFound, wrap } = require('../core/errors');
const { resolveRefs } = require('../core/crud');
const { entities } = require('../entities');

const router = express.Router();
const handlers = {};            // process_type -> { onApproved, onRejected, onReturned, onWithdrawn, onInvalidated }
const registerHandler = (type, h) => { handlers[type] = h; };

// ------------------------------------------------------------------ evaluation
async function resolveValue(v) {
  if (typeof v === 'string' && v.startsWith('@')) return Number(await settings.get(v.slice(1), 0));
  return v;
}
async function condTrue(cond, snap) {
  const a = snap[cond.field];
  const b = await resolveValue(cond.value);
  if (a === undefined || a === null) return cond.op === 'null' ? true : false;
  switch (cond.op) {
    case '<': return Number(a) < Number(b);
    case '<=': return Number(a) <= Number(b);
    case '>': return Number(a) > Number(b);
    case '>=': return Number(a) >= Number(b);
    case '=': case '==': return String(a) === String(b);
    case '!=': return String(a) !== String(b);
    case 'in': return Array.isArray(b) && b.map(String).includes(String(a));
    case 'true': return a === true;
    default: return false;
  }
}

/** Returns { required, rules:[names], steps:[{seq,kind,role,label,...}] } for the active process of `type`. */
async function evaluate(type, snapshot, c = db) {
  const { rows } = await c.query(
    `SELECT * FROM approval_processes WHERE process_type=$1 AND status='Active' AND is_deleted=false
       AND (effective_from IS NULL OR effective_from <= current_date) AND (effective_to IS NULL OR effective_to >= current_date)
     ORDER BY version_no DESC LIMIT 1`, [type]);
  const proc = rows[0];
  if (!proc) return { required: false, rules: [], steps: [], process: null };
  const fired = []; const steps = [];
  for (const rule of proc.rules || []) {
    let ok = true;
    for (const cd of rule.when || []) if (!(await condTrue(cd, snapshot))) { ok = false; break; }
    if (!ok) continue;
    fired.push(rule.name);
    for (const s of rule.steps || []) steps.push({ ...s });
  }
  // de-duplicate identical approvers keeping the earliest sequence
  const seen = new Set(); const merged = [];
  steps.sort((a, b) => (a.seq || 1) - (b.seq || 1));
  for (const s of steps) {
    const key = `${s.kind}|${s.role || ''}|${s.user_id || ''}|${s.level || ''}`;
    if (seen.has(key)) continue; seen.add(key); merged.push(s);
  }
  return { required: merged.length > 0, rules: fired, steps: merged, process: proc };
}

async function managerOf(userId, levels = 1, c = db) {
  let cur = userId;
  for (let i = 0; i < levels; i++) {
    const { rows } = await c.query(
      `SELECT COALESCE((SELECT manager_id FROM reporting_lines WHERE employee_id=$1 AND purpose='Approval' AND effective_from<=current_date AND (effective_to IS NULL OR effective_to>=current_date) ORDER BY effective_from DESC LIMIT 1),
              (SELECT manager_id FROM reporting_lines WHERE employee_id=$1 AND purpose='Primary' AND effective_from<=current_date AND (effective_to IS NULL OR effective_to>=current_date) ORDER BY effective_from DESC LIMIT 1),
              (SELECT manager_id FROM users WHERE id=$1)) AS mid`, [cur]);
    if (!rows[0] || !rows[0].mid) return null;
    cur = rows[0].mid;
  }
  return cur;
}

async function resolveStep(step, submitterId, amountBase, c = db) {
  const { rows: su } = await c.query('SELECT id, country, manager_id FROM users WHERE id=$1', [submitterId]);
  const out = { approver_id: null, role_code: null, candidates: null, label: step.label };
  if (step.kind === 'manager') {
    const m = await managerOf(submitterId, step.level || 1, c);
    if (m) { out.approver_id = m; out.label = out.label || (step.level > 1 ? 'Manager (level 2)' : 'Line manager'); return out; }
    // fallback: no manager -> role holder
    out.role_code = step.fallback_role || 'ROL-SM'; return out;
  }
  if (step.kind === 'authority') {   // first manager in chain whose approval limit covers the amount (BRD claims routing)
    let cur = submitterId;
    for (let i = 0; i < 6; i++) {
      const m = await managerOf(cur, 1, c); if (!m) break;
      const { rows } = await c.query('SELECT approval_limit FROM users WHERE id=$1', [m]);
      cur = m;
      if (rows[0].approval_limit != null && rows[0].approval_limit >= amountBase) { out.approver_id = m; out.label = out.label || 'Manager with authority'; return out; }
    }
    if (cur !== submitterId) { out.approver_id = cur; return out; }
    out.role_code = 'ROL-CM'; return out;
  }
  if (step.kind === 'user') { out.approver_id = step.user_id; return out; }
  // role
  out.role_code = step.role;
  if (step.country_scoped && su[0] && su[0].country) {
    const { rows } = await c.query(
      `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.code=$1 AND u.country=$2 AND u.status='Active' AND u.is_deleted=false`,
      [step.role, su[0].country]);
    if (rows.length) out.candidates = rows.map((r) => r.id);
  }
  return out;
}

/** Creates an approval request with resolved steps. Returns the request row. */
async function submit(ctx, { type, entity, recordId, label, amount, currency, snapshot = {}, comment, evaluation, prevRequestId }, c = db) {
  const ev = evaluation || await evaluate(type, snapshot, c);
  if (!ev.required) return { required: false };
  const amountBase = snapshot.amount_base != null ? snapshot.amount_base : (amount || 0);
  const number = await nextNumber('APR', c);
  const { rows } = await c.query(
    `INSERT INTO approval_requests (number, process_type, record_entity, record_id, record_label, submitter_id, status, amount, currency, snapshot, triggered_rules, current_seq, submitted_at, comment, process_id, prev_request_id, created_by, modified_by)
     VALUES ($1,$2,$3,$4,$5,$6,'Pending',$7,$8,$9,$10,$11,now(),$12,$13,$14,$6,$6) RETURNING *`,
    [number, type, entity, recordId, label, ctx.id, amount || null, currency || null, JSON.stringify(snapshot), JSON.stringify(ev.rules), 0, comment || null, ev.process ? ev.process.id : null, prevRequestId || null]);
  const req = rows[0];
  const seqs = [...new Set(ev.steps.map((s) => s.seq || 1))].sort((a, b) => a - b);
  let first = true;
  let seqNo = 0;
  for (const sq of seqs) {
    seqNo++;
    for (const s of ev.steps.filter((x) => (x.seq || 1) === sq)) {
      const r = await resolveStep(s, ctx.id, amountBase, c);
      // separation of duties: submitter cannot approve own request
      if (r.approver_id === ctx.id) { const up = await managerOf(ctx.id, 1, c); r.approver_id = up || null; if (!up) r.role_code = 'ROL-SM'; }
      const sla = s.sla_hours ? `now() + interval '${parseInt(s.sla_hours, 10)} hours'` : 'NULL';
      await c.query(
        `INSERT INTO approval_steps (request_id, seq, label, approver_kind, role_code, approver_id, candidates, status, sla_due, escalation_level)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,${sla},0)`,
        [req.id, seqNo, r.label || s.label || s.role || 'Approver', s.kind, r.role_code, r.approver_id, r.candidates ? JSON.stringify(r.candidates) : null, first ? 'Pending' : 'Waiting']);
    }
    first = false;
  }
  await c.query('UPDATE approval_requests SET current_seq=1 WHERE id=$1', [req.id]);
  await audit(ctx, { event: 'approval_submitted', entity, recordId, label, detail: `${number}: ${ev.rules.join('; ')}` }, c);
  await notifyStepApprovers(req.id, c);
  return { required: true, request: { ...req, current_seq: 1 } };
}

async function notifyStepApprovers(requestId, c = db) {
  const { rows: rq } = await c.query('SELECT * FROM approval_requests WHERE id=$1', [requestId]);
  const { rows: st } = await c.query(`SELECT * FROM approval_steps WHERE request_id=$1 AND status='Pending'`, [requestId]);
  const r = rq[0];
  for (const s of st) {
    const payload = { type: 'approval', title: `Approval needed: ${r.record_label}`, body: `${r.number} · ${s.label}`, entity: 'approval_requests', recordId: r.id, dedupKey: `apr-${r.id}-${s.id}` };
    if (s.approver_id) await notify(s.approver_id, payload, c);
    else if (s.candidates) for (const uid of s.candidates) await notify(uid, payload, c);
    else if (s.role_code) await notifyRole(s.role_code, payload, c);
  }
}

// -------------------------------------------------------------------- decisions
function eligible(ctx, step) {
  if (step.status !== 'Pending') return null;
  if (step.approver_id === ctx.id) return { onBehalfOf: null };
  if (step.approver_id && ctx.delegators.includes(step.approver_id)) return { onBehalfOf: step.approver_id };
  if (!step.approver_id && step.role_code && ctx.roles.has(step.role_code)) {
    if (!step.candidates || step.candidates.includes(ctx.id)) return { onBehalfOf: null };
  }
  return null;
}

async function decide(ctx, requestId, { decision, comment, reason, conditions }) {
  return db.tx(async (c) => {
    const { rows: rq } = await c.query('SELECT * FROM approval_requests WHERE id=$1 FOR UPDATE', [requestId]);
    const req = rq[0];
    if (!req) throw notFound('Approval request not found');
    if (req.status !== 'Pending') throw bad(`Request is already ${req.status}`);
    if (req.submitter_id === ctx.id) throw forbidden('You cannot approve your own request (BRULE-APR-003)');
    const { rows: steps } = await c.query('SELECT * FROM approval_steps WHERE request_id=$1 ORDER BY seq, id', [requestId]);
    const mine = steps.map((s) => ({ s, e: eligible(ctx, s) })).filter((x) => x.e);
    if (!mine.length) throw forbidden('You are not a pending approver for this request');
    if (!['approve', 'reject', 'return', 'approve_conditions'].includes(decision)) throw bad('Invalid decision');
    if (decision === 'reject' && !reason) throw bad('A reason is required to reject (BRULE-APR-004)');
    if (decision === 'return' && !comment) throw bad('A comment is required to return a request');
    if (decision === 'approve_conditions' && !conditions) throw bad('Conditions are required');
    const step = mine[0];
    const stat = { approve: 'Approved', approve_conditions: 'Approved', reject: 'Rejected', return: 'Returned' }[decision];
    await c.query(
      `UPDATE approval_steps SET status=$2, decided_by=$3, on_behalf_of=$4, decided_at=now(), comment=$5, reason=$6, conditions=$7 WHERE id=$1`,
      [step.s.id, stat, ctx.id, step.e.onBehalfOf, comment || null, reason || null, conditions || null]);
    await audit(ctx, { event: `approval_${decision}`, entity: req.record_entity, recordId: req.record_id, label: req.record_label, detail: `${req.number} step '${step.s.label}'${step.e.onBehalfOf ? ' (on behalf of user ' + step.e.onBehalfOf + ')' : ''}${reason ? ': ' + reason : ''}` }, c);

    let final = null;
    if (decision === 'reject') final = 'Rejected';
    else if (decision === 'return') final = 'Returned';
    else {
      const { rows: left } = await c.query(`SELECT * FROM approval_steps WHERE request_id=$1 AND status IN ('Pending','Waiting') ORDER BY seq`, [requestId]);
      const pendingSame = left.filter((x) => x.seq === step.s.seq && x.status === 'Pending');
      if (!pendingSame.length) {
        if (!left.length) {
          const { rows: cond } = await c.query(`SELECT 1 FROM approval_steps WHERE request_id=$1 AND conditions IS NOT NULL LIMIT 1`, [requestId]);
          final = cond.length ? 'Approved with conditions' : 'Approved';
        } else {
          const nextSeq = left[0].seq;
          await c.query(`UPDATE approval_steps SET status='Pending' WHERE request_id=$1 AND seq=$2 AND status='Waiting'`, [requestId, nextSeq]);
          await c.query('UPDATE approval_requests SET current_seq=$2 WHERE id=$1', [requestId, nextSeq]);
          await notifyStepApprovers(requestId, c);
        }
      }
    }
    if (final) {
      await c.query(`UPDATE approval_steps SET status='Skipped' WHERE request_id=$1 AND status IN ('Pending','Waiting')`, [requestId]);
      await c.query('UPDATE approval_requests SET status=$2, decided_at=now(), modified_at=now() WHERE id=$1', [requestId, final]);
      const h = handlers[req.process_type];
      const key = final.startsWith('Approved') ? 'onApproved' : final === 'Rejected' ? 'onRejected' : 'onReturned';
      if (h && h[key]) await h[key](ctx, { ...req, status: final }, { comment, reason, conditions }, c);
      await notify(req.submitter_id, { type: 'approval_result', title: `${req.record_label}: ${final}`, body: reason || comment || `${req.number}`, entity: req.record_entity, recordId: req.record_id }, c);
    }
    return { status: final || 'Pending', request_id: requestId };
  });
}

async function withdraw(ctx, requestId, reason) {
  return db.tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM approval_requests WHERE id=$1 FOR UPDATE', [requestId]);
    const req = rows[0];
    if (!req) throw notFound();
    if (req.submitter_id !== ctx.id && !ctx.isAdmin) throw forbidden('Only the submitter can withdraw');
    if (req.status !== 'Pending') throw bad(`Request is already ${req.status}`);
    await c.query(`UPDATE approval_steps SET status='Skipped' WHERE request_id=$1 AND status IN ('Pending','Waiting')`, [requestId]);
    await c.query(`UPDATE approval_requests SET status='Withdrawn', decided_at=now() WHERE id=$1`, [requestId]);
    const h = handlers[req.process_type];
    if (h && h.onWithdrawn) await h.onWithdrawn(ctx, req, { reason }, c);
    await audit(ctx, { event: 'approval_withdrawn', entity: req.record_entity, recordId: req.record_id, label: req.record_label, detail: reason }, c);
    return { ok: true };
  });
}

/** Invalidate pending requests for a record when its approved content changes (BRULE-APR-005). */
async function invalidateFor(entity, recordId, reason, c = db) {
  const { rows } = await c.query(`SELECT * FROM approval_requests WHERE record_entity=$1 AND record_id=$2 AND status='Pending'`, [entity, recordId]);
  for (const r of rows) {
    await c.query(`UPDATE approval_steps SET status='Skipped' WHERE request_id=$1 AND status IN ('Pending','Waiting')`, [r.id]);
    await c.query(`UPDATE approval_requests SET status='Invalidated', decided_at=now() WHERE id=$1`, [r.id]);
    await notify(r.submitter_id, { type: 'approval_result', title: `${r.record_label}: approval invalidated`, body: reason, entity, recordId }, c);
  }
}

// ---------------------------------------------------------------------- queries
function myRoleArray(ctx) { return [...ctx.roles]; }
async function visibilityWhere(ctx, params) {
  if (ctx.isAdmin || A.roleHas(ctx, 'ROL-FIN', 'ROL-AUD', 'ROL-ROE', 'ROL-WFA')) return 'true';
  const reports = await A.reportIds(ctx);
  params.push(ctx.id, [ctx.id, ...ctx.delegators], myRoleArray(ctx), reports);
  const n = params.length;
  return `(r.submitter_id = $${n - 3} OR r.submitter_id = ANY($${n}::bigint[]) OR EXISTS (SELECT 1 FROM approval_steps s WHERE s.request_id=r.id AND (s.approver_id = ANY($${n - 2}::bigint[]) OR s.decided_by = $${n - 3} OR (s.approver_id IS NULL AND s.role_code = ANY($${n - 1}::text[])) OR r.submitter_id = ANY($${n}::bigint[]))))`;
}

const inbox = wrap(async (req, res) => {
  const ctx = req.ctx; const view = req.query.view || 'pending';
  const params = [];
  let where = '';
  if (view === 'pending') {
    params.push([ctx.id, ...ctx.delegators], myRoleArray(ctx), ctx.id);
    where = `r.status='Pending' AND r.submitter_id <> $3 AND EXISTS (SELECT 1 FROM approval_steps s WHERE s.request_id=r.id AND s.status='Pending' AND (s.approver_id = ANY($1::bigint[]) OR (s.approver_id IS NULL AND s.role_code = ANY($2::text[]) AND (s.candidates IS NULL OR s.candidates @> to_jsonb($3::bigint)))))`;
  } else if (view === 'submitted') { params.push(ctx.id); where = 'r.submitter_id = $1'; }
  else if (view === 'decided') { params.push(ctx.id); where = `EXISTS (SELECT 1 FROM approval_steps s WHERE s.request_id=r.id AND s.decided_by=$1)`; }
  else { where = await visibilityWhere(ctx, params); }
  const { rows } = await db.query(
    `SELECT r.*, u.name AS submitter_name,
       (SELECT json_agg(json_build_object('id',s.id,'seq',s.seq,'label',s.label,'status',s.status,'sla_due',s.sla_due,'escalation_level',s.escalation_level) ORDER BY s.seq, s.id) FROM approval_steps s WHERE s.request_id=r.id) AS steps
     FROM approval_requests r JOIN users u ON u.id=r.submitter_id WHERE ${where} ORDER BY r.submitted_at DESC LIMIT 200`, params);
  // external partners and non-privileged viewers never see approver comments here (list shows status only)
  res.json({ rows });
});
router.get('/approvals/inbox', inbox);
router.get('/approvals/count', wrap(async (req, res) => {
  const ctx = req.ctx;
  const { rows } = await db.query(
    `SELECT count(*)::int n FROM approval_requests r WHERE r.status='Pending' AND r.submitter_id <> $3 AND EXISTS (SELECT 1 FROM approval_steps s WHERE s.request_id=r.id AND s.status='Pending' AND (s.approver_id = ANY($1::bigint[]) OR (s.approver_id IS NULL AND s.role_code = ANY($2::text[]) AND (s.candidates IS NULL OR s.candidates @> to_jsonb($3::bigint)))))`,
    [[ctx.id, ...ctx.delegators], myRoleArray(ctx), ctx.id]);
  res.json({ pending: rows[0].n });
}));
// generic list/get for approval_requests must respect visibility (override the generic route)
router.get('/e/approval_requests', (req, res, next) => { req.query.view = 'all'; inbox(req, res, next); });

router.get('/approvals/:id', wrap(async (req, res) => {
  const params = [req.params.id];
  const vis = await visibilityWhere(req.ctx, params);
  const { rows } = await db.query(
    `SELECT r.*, u.name AS submitter_name FROM approval_requests r JOIN users u ON u.id=r.submitter_id WHERE r.id=$1 AND ${vis}`, params);
  const r = rows[0];
  if (!r) throw notFound();
  const { rows: steps } = await db.query(
    `SELECT s.*, a.name AS approver_name, d.name AS decided_by_name, o.name AS on_behalf_name FROM approval_steps s
       LEFT JOIN users a ON a.id=s.approver_id LEFT JOIN users d ON d.id=s.decided_by LEFT JOIN users o ON o.id=s.on_behalf_of WHERE s.request_id=$1 ORDER BY s.seq, s.id`, [r.id]);
  const mine = steps.some((s) => eligible(req.ctx, s)) && r.submitter_id !== req.ctx.id;
  // Margin/cost values in the snapshot are only shown to those with margin view (BRD 7.6)
  if (!A.fieldAccess(req.ctx, 'margin').view) r.snapshot = { requires_approval: true };
  const involved = r.submitter_id === req.ctx.id || steps.some((s) => s.approver_id === req.ctx.id || s.decided_by === req.ctx.id || (s.role_code && req.ctx.roles.has(s.role_code))) || req.ctx.isAdmin || A.roleHas(req.ctx, 'ROL-FIN', 'ROL-AUD');
  if (!involved) for (const s of steps) { s.comment = null; s.reason = null; s.conditions = null; }
  res.json({ ...r, steps, can_decide: mine, can_withdraw: r.status === 'Pending' && r.submitter_id === req.ctx.id });
}));

router.post('/approvals/:id/decide', wrap(async (req, res) => {
  res.json(await decide(req.ctx, Number(req.params.id), req.body || {}));
}));
router.post('/approvals/:id/withdraw', wrap(async (req, res) => {
  res.json(await withdraw(req.ctx, Number(req.params.id), (req.body || {}).reason));
}));
router.post('/approvals/steps/:sid/delegate', wrap(async (req, res) => {
  const { user_id, reason } = req.body || {};
  const { rows } = await db.query('SELECT s.*, r.amount, r.submitter_id FROM approval_steps s JOIN approval_requests r ON r.id=s.request_id WHERE s.id=$1', [req.params.sid]);
  const s = rows[0]; if (!s) throw notFound();
  if (!eligible(req.ctx, s)) throw forbidden('You are not the pending approver of this step');
  if (Number(user_id) === s.submitter_id) throw bad('Cannot delegate to the submitter');
  const { rows: tu } = await db.query(`SELECT id, name, approval_limit FROM users WHERE id=$1 AND status='Active'`, [user_id]);
  if (!tu[0]) throw bad('Delegate must be an active user');
  await db.query(`UPDATE approval_steps SET approver_id=$2, role_code=NULL, candidates=NULL, on_behalf_of=$3, comment=COALESCE(comment,'') || $4 WHERE id=$1`,
    [s.id, tu[0].id, req.ctx.id, `Delegated by ${req.ctx.user.name}: ${reason || ''}\n`]);
  await audit(req.ctx, { event: 'approval_delegated', entity: 'approval_requests', recordId: s.request_id, detail: `to ${tu[0].name}: ${reason || ''}` });
  await notify(tu[0].id, { type: 'approval', title: 'Approval delegated to you', body: s.label, entity: 'approval_requests', recordId: s.request_id });
  res.json({ ok: true });
}));

// Approval delegation windows (FR-APR-007)
router.get('/approvals-delegations', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT d.*, a.name delegator_name, b.name delegate_name FROM delegations d JOIN users a ON a.id=d.delegator_id JOIN users b ON b.id=d.delegate_id WHERE d.delegator_id=$1 OR d.delegate_id=$1 ORDER BY d.id DESC`, [req.ctx.id]);
  res.json(rows);
}));
router.post('/approvals-delegations', wrap(async (req, res) => {
  const { delegate_id, start_date, end_date, reason } = req.body || {};
  if (!delegate_id || !start_date || !end_date) throw bad('Delegate, start and end dates are required');
  if (end_date < start_date) throw bad('End date must be on or after start date');
  const { rows: d } = await db.query('SELECT approval_limit, status FROM users WHERE id=$1', [delegate_id]);
  if (!d[0] || d[0].status !== 'Active') throw bad('Delegate must be an active user');
  if (Number(delegate_id) === req.ctx.id) throw bad('Cannot delegate to yourself');
  if ((req.ctx.user.approval_limit || 0) > (d[0].approval_limit || 0)) throw bad('Delegate must have equal or higher approval authority (FR-APR-007)');
  await db.query('INSERT INTO delegations (delegator_id, delegate_id, start_date, end_date, reason) VALUES ($1,$2,$3,$4,$5)', [req.ctx.id, delegate_id, start_date, end_date, reason || null]);
  await audit(req.ctx, { event: 'delegation_created', entity: 'users', recordId: req.ctx.id, detail: `to ${delegate_id} ${start_date}..${end_date}` });
  res.json({ ok: true });
}));
router.delete('/approvals-delegations/:id', wrap(async (req, res) => {
  await db.query('UPDATE delegations SET active=false WHERE id=$1 AND delegator_id=$2', [req.params.id, req.ctx.id]);
  res.json({ ok: true });
}));

// Workflow definition lifecycle (versioned; activation retires the previous version)
const proc = entities.approval_processes;
proc.actions = {
  activate: { label: 'Activate version', perm: 'S', confirm: 'Activate this version? The currently active version will be retired.', run: async (ctx, row) => {
    if (!Array.isArray(row.rules) || !row.rules.length) throw bad('Process has no rules');
    await db.tx(async (c) => {
      await c.query(`UPDATE approval_processes SET status='Retired' WHERE process_type=$1 AND status='Active' AND id<>$2`, [row.process_type, row.id]);
      await c.query(`UPDATE approval_processes SET status='Active', effective_from=COALESCE(effective_from, current_date), modified_at=now() WHERE id=$1`, [row.id]);
      await audit(ctx, { event: 'workflow_activated', entity: 'approval_processes', recordId: row.id, label: row.name, detail: `version ${row.version_no}` }, c);
    });
  } },
  new_version: { label: 'Create new version', perm: 'C', run: async (ctx, row) => {
    const { rows } = await db.query('SELECT coalesce(max(version_no),0)+1 v FROM approval_processes WHERE process_type=$1 AND name=$2', [row.process_type, row.name]);
    const num = await nextNumber('WFD');
    const r = await db.query(`INSERT INTO approval_processes (number, name, process_type, version_no, status, rules, description, created_by, modified_by) VALUES ($1,$2,$3,$4,'Draft',$5,$6,$7,$7) RETURNING id`,
      [num, row.name, row.process_type, rows[0].v, JSON.stringify(row.rules), row.description, ctx.id]);
    await audit(ctx, { event: 'workflow_version_created', entity: 'approval_processes', recordId: r.rows[0].id, label: row.name });
    return { id: r.rows[0].id };
  } },
};
router.get('/approvals-workflow/impact/:type', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT count(*)::int n FROM approval_requests WHERE process_type=$1 AND status='Pending'`, [req.params.type]);
  res.json({ pending_requests: rows[0].n });
}));
router.post('/approvals-workflow/simulate', wrap(async (req, res) => {
  const { type, snapshot } = req.body || {};
  const ev = await evaluate(type, snapshot || {});
  res.json({ required: ev.required, rules: ev.rules, steps: ev.steps, process: ev.process && { id: ev.process.id, name: ev.process.name, version: ev.process.version_no } });
}));

module.exports = { router, evaluate, submit, decide, withdraw, invalidateFor, registerHandler, managerOf, eligible, notifyStepApprovers };
