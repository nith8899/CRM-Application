'use strict';
// M29-M34 - activity reporting, calendar & availability, events, organisation chart.
const express = require('express');
const db = require('../db');
const A = require('../core/access');
const hooks = require('../core/hooks');
const settings = require('../core/settings');
const fx = require('../core/fx');
const { audit } = require('../core/audit');
const { notify } = require('../core/notify');
const { nextNumber } = require('../core/numbering');
const { bad, forbidden, notFound, wrap } = require('../core/errors');
const { entities } = require('../entities');
const crud = require('../core/crud');
const approvals = require('./approvals');

const router = express.Router();

// ---------------------------------------------------------------- meetings
async function busyFor(userIds, start, end, excludeMeetingId) {
  const { rows } = await db.query(
    `SELECT mp.user_id, m.id, m.subject, m.start_at, m.end_at FROM meeting_participants mp JOIN meetings m ON m.id=mp.meeting_id
     WHERE mp.user_id = ANY($1::bigint[]) AND mp.response <> 'Declined' AND m.is_deleted=false AND m.status IN ('Planned','Rescheduled') AND m.start_at < $3 AND m.end_at > $2 AND ($4::bigint IS NULL OR m.id<>$4)
     UNION SELECT m.owner_id, m.id, m.subject, m.start_at, m.end_at FROM meetings m WHERE m.owner_id = ANY($1::bigint[]) AND m.is_deleted=false AND m.status IN ('Planned','Rescheduled') AND m.start_at < $3 AND m.end_at > $2 AND ($4::bigint IS NULL OR m.id<>$4)`,
    [userIds, start, end, excludeMeetingId || null]);
  return rows;
}
hooks.register('meetings', {
  validate(ctx, v) {
    const errs = [];
    if (v.end_at && v.start_at && new Date(v.end_at) <= new Date(v.start_at)) errs.push({ field: 'end_at', message: 'End must be after start' });
    return errs;
  },
  async afterCreate(ctx, m, c) {
    await c.query(`INSERT INTO meeting_participants (meeting_id, user_id, attendee_role, response, created_by, modified_by) VALUES ($1,$2,'Organiser','Accepted',$2,$2)`, [m.id, m.owner_id]);
    if (m.opportunity_id) await c.query('UPDATE opportunities SET last_activity_at=now() WHERE id=$1', [m.opportunity_id]);
  },
  async afterUpdate(ctx, m, old, c) {
    if (m.start_at !== old.start_at || m.end_at !== old.end_at) {
      const { rows } = await c.query('SELECT user_id FROM meeting_participants WHERE meeting_id=$1 AND user_id IS NOT NULL AND user_id<>$2 AND is_deleted=false', [m.id, ctx.id]);
      for (const r of rows) await notify(r.user_id, { type: 'meeting_changed', title: `Meeting rescheduled: ${m.subject}`, entity: 'meetings', recordId: m.id }, c);
      await c.query(`UPDATE meeting_participants SET response='Pending' WHERE meeting_id=$1 AND attendee_role<>'Organiser'`, [m.id]);
    }
  },
});
hooks.register('meeting_participants', {
  async afterCreate(ctx, p, c) {
    if (p.user_id && p.user_id !== ctx.id) {
      const { rows } = await c.query('SELECT subject, start_at FROM meetings WHERE id=$1', [p.meeting_id]);
      await notify(p.user_id, { type: 'meeting_invite', title: `Meeting invitation: ${rows[0].subject}`, body: String(rows[0].start_at), entity: 'meetings', recordId: p.meeting_id }, c);
    }
  },
});
entities.meeting_participants.actions = {
  respond: { label: 'Respond', perm: 'E', async run(ctx, p, b) {
    if (p.user_id !== ctx.id) throw forbidden('You can only respond to your own invitation');
    if (!['Accepted', 'Tentative', 'Declined'].includes(b.response)) throw bad('Invalid response');
    await db.query('UPDATE meeting_participants SET response=$2 WHERE id=$1', [p.id, b.response]);
  } },
  mark_attendance: { label: 'Record attendance', perm: 'E', async run(ctx, p, b) {   // attendance is distinct from response (FR-CAL)
    if (!['Attended', 'No-show', 'Excused'].includes(b.attendance)) throw bad('Invalid attendance');
    await db.query('UPDATE meeting_participants SET attendance=$2 WHERE id=$1', [p.id, b.attendance]);
  } },
};

/** Free/busy: unknown availability is never assumed free (BRULE-CAL-002). */
router.post('/calendar/availability', wrap(async (req, res) => {
  const { user_ids = [], start, end, exclude_meeting_id } = req.body || {};
  if (!user_ids.length || !start || !end) throw bad('user_ids, start and end are required');
  const busy = await busyFor(user_ids, start, end, exclude_meeting_id);
  const { rows: us } = await db.query('SELECT id, name FROM users WHERE id=ANY($1)', [user_ids]);
  const { rows: pref } = await db.query(`SELECT user_id, value FROM user_settings WHERE key='calendar_sharing' AND user_id=ANY($1)`, [user_ids]);
  const share = Object.fromEntries(pref.map((p) => [p.user_id, p.value]));
  const { rows: hol } = await db.query(`SELECT title FROM calendar_events WHERE non_working AND is_deleted=false AND start_date <= $2::date AND end_date >= $1::date`, [start, end]);
  res.json({
    holidays: hol.map((h) => h.title),
    users: us.map((u) => {
      const conflicts = busy.filter((b) => b.user_id === u.id);
      let status = conflicts.length ? 'busy' : 'free';
      if (share[u.id] === 'none') status = 'unknown';          // calendar not shared: never treated as free
      const hide = u.id !== req.ctx.id && share[u.id] === 'busy-only';
      return { id: u.id, name: u.name, status, conflicts: status === 'unknown' ? [] : conflicts.map((c) => ({ start: c.start_at, end: c.end_at, subject: hide ? 'Busy' : c.subject })) };
    }),
  });
}));

router.get('/calendar', wrap(async (req, res) => {
  const ctx = req.ctx; const from = req.query.from; const to = req.query.to;
  if (!from || !to) throw bad('from and to are required');
  const target = req.query.user_id ? Number(req.query.user_id) : ctx.id;
  if (target !== ctx.id && !ctx.isAdmin) {
    const reports = await A.reportIds(ctx);
    if (!reports.includes(target)) throw forbidden('You can only view your own calendar or your reporting line');
  }
  const { rows: mt } = await db.query(
    `SELECT DISTINCT m.id, m.subject, m.start_at, m.end_at, m.location, m.meeting_type, m.status FROM meetings m LEFT JOIN meeting_participants mp ON mp.meeting_id=m.id AND mp.is_deleted=false
     WHERE m.is_deleted=false AND (m.owner_id=$1 OR mp.user_id=$1) AND m.start_at < $3 AND m.end_at > $2 ORDER BY m.start_at`, [target, from, to]);
  const { rows: tk } = await db.query(`SELECT id, subject, due_at, priority, status FROM tasks WHERE is_deleted=false AND owner_id=$1 AND due_at BETWEEN $2 AND $3 AND status NOT IN ('Completed','Cancelled') ORDER BY due_at`, [target, from, to]);
  const { rows: ev } = await db.query(`SELECT id, title, calendar_type, start_date, end_date, non_working FROM calendar_events WHERE is_deleted=false AND start_date <= $2::date AND end_date >= $1::date AND (country IS NULL OR country=(SELECT country FROM users WHERE id=$3))`, [from, to, target]);
  const { rows: evs } = await db.query(`SELECT id, name, start_at, end_at, venue FROM events WHERE is_deleted=false AND published AND status NOT IN ('Cancelled','Draft') AND start_at < $2 AND end_at > $1`, [from, to]);
  res.json({ meetings: mt, tasks: tk, company: ev, events: evs });
}));

// ------------------------------------------------------------ activity reports
function periodFor(policy, ref = new Date()) {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  const iso = (x) => x.toISOString().slice(0, 10);
  if (policy === 'End-of-day') return { start: iso(d), end: iso(d), label: iso(d) };
  if (policy === 'Monthly') { const s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)); return { start: iso(s), end: iso(e), label: iso(s).slice(0, 7) }; }
  const day = (d.getUTCDay() + 6) % 7; const s = new Date(d); s.setUTCDate(d.getUTCDate() - day); const e = new Date(s); e.setUTCDate(s.getUTCDate() + 6);
  const jan1 = new Date(Date.UTC(s.getUTCFullYear(), 0, 1)); const wk = Math.ceil(((s - jan1) / 86400000 + jan1.getUTCDay() + 1) / 7);
  return { start: iso(s), end: iso(e), label: `${s.getUTCFullYear()}-W${String(wk).padStart(2, '0')}` };
}
router.post('/activity-reports/generate', wrap(async (req, res) => {
  const ctx = req.ctx; const policy = (req.body || {}).policy || 'Weekly';
  if (!A.can(ctx, 'M29', 'C')) throw forbidden();
  const p = periodFor(policy, req.body.date ? new Date(req.body.date) : new Date());
  const ex = await db.query('SELECT id FROM activity_reports WHERE owner_id=$1 AND period_label=$2 AND policy=$3 AND is_deleted=false', [ctx.id, p.label, policy]);
  const stats = async () => {
    const a = (await db.query(`SELECT count(*) FILTER (WHERE status='Completed')::int done, count(*) FILTER (WHERE status='Planned' AND activity_date::date <= $3)::int planned FROM activities WHERE owner_id=$1 AND is_deleted=false AND activity_date::date BETWEEN $2 AND $3`, [ctx.id, p.start, p.end])).rows[0];
    const o = (await db.query(`SELECT count(*)::int n FROM tasks WHERE owner_id=$1 AND is_deleted=false AND status NOT IN ('Completed','Cancelled') AND due_at < now() AND category='Follow-up'`, [ctx.id])).rows[0].n;
    return { done: a.done, planned: a.planned, overdue: o };
  };
  const s = await stats();
  if (ex.rows[0]) { await db.query('UPDATE activity_reports SET activities_count=$2, planned_not_done=$3, overdue_followups=$4 WHERE id=$1 AND status IN (\'Draft\',\'Returned\')', [ex.rows[0].id, s.done, s.planned, s.overdue]); return res.json({ id: ex.rows[0].id, existing: true }); }
  const num = await nextNumber('ARP');
  const { rows } = await db.query(`INSERT INTO activity_reports (number, owner_id, policy, period_label, period_start, period_end, status, activities_count, planned_not_done, overdue_followups, created_by, modified_by) VALUES ($1,$2,$3,$4,$5,$6,'Draft',$7,$8,$9,$2,$2) RETURNING id`, [num, ctx.id, policy, p.label, p.start, p.end, s.done, s.planned, s.overdue]);
  await db.query('UPDATE activities SET report_id=$1 WHERE owner_id=$2 AND report_id IS NULL AND activity_date::date BETWEEN $3 AND $4', [rows[0].id, ctx.id, p.start, p.end]);
  res.status(201).json({ id: rows[0].id });
}));
entities.activity_reports.actions = {
  submit: { label: 'Submit report', perm: 'S', async run(ctx, r) {
    if (!['Draft', 'Returned', 'Reopened'].includes(r.status)) throw bad(`Report is ${r.status}`);
    if (r.owner_id !== ctx.id) throw forbidden();
    await db.query(`UPDATE activity_reports SET status='Submitted', submitted_at=now() WHERE id=$1`, [r.id]);
    const { manager_id } = (await db.query('SELECT manager_id FROM users WHERE id=$1', [r.owner_id])).rows[0];
    if (manager_id) await notify(manager_id, { type: 'activity_report', title: `Activity report to review: ${ctx.user.name} ${r.period_label}`, entity: 'activity_reports', recordId: r.id });
    await audit(ctx, { event: 'report_submitted', entity: 'activity_reports', recordId: r.id, label: r.period_label });
  } },
  approve: { label: 'Approve', perm: 'A', async run(ctx, r) { await review(ctx, r, 'Approved'); } },
  return: { label: 'Return for rework', perm: 'A', prompt: 'comment', async run(ctx, r, b) { if (!b.comment) throw bad('Comment required'); await review(ctx, r, 'Returned', b.comment); } },
  reopen: { label: 'Reopen', perm: 'A', async run(ctx, r) { if (!A.roleHas(ctx, 'ROL-SOP', 'ROL-ADM')) throw forbidden('Only Sales Operations can reopen'); await db.query(`UPDATE activity_reports SET status='Reopened' WHERE id=$1`, [r.id]); await audit(ctx, { event: 'report_reopened', entity: 'activity_reports', recordId: r.id }); } },
};
async function review(ctx, r, status, comment) {
  if (r.status !== 'Submitted' && r.status !== 'Under review') throw bad('Report is not awaiting review');
  if (r.owner_id === ctx.id) throw forbidden('You cannot review your own report');
  const reports = await A.reportIds(ctx);
  if (!reports.includes(r.owner_id) && !ctx.isAdmin) throw forbidden('You can only review reports of people in your reporting line');
  await db.query('UPDATE activity_reports SET status=$2, reviewed_by=$3, review_comment=$4 WHERE id=$1', [r.id, status, ctx.id, comment || null]);
  await notify(r.owner_id, { type: 'activity_report', title: `Activity report ${r.period_label}: ${status}`, body: comment, entity: 'activity_reports', recordId: r.id });
  await audit(ctx, { event: `report_${status.toLowerCase()}`, entity: 'activity_reports', recordId: r.id, label: r.period_label, detail: comment });
}
/** Effort vs outcome analytics (FR-ACTR): scoped by reporting line / team / org per role. */
router.get('/analytics/activities', wrap(async (req, res) => {
  const ctx = req.ctx;
  const params = []; const sc = await A.scopeClause('activities', ctx, params, 'V', 'a');
  const from = req.query.from || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  params.push(from); const f = params.length;
  const where = `a.is_deleted=false AND a.status='Completed' AND a.activity_date::date >= $${f} ${sc ? 'AND ' + sc : ''}`;
  const byType = (await db.query(`SELECT a.activity_type, count(*)::int n, count(*) FILTER (WHERE a.outcome='Positive')::int positive FROM activities a WHERE ${where} GROUP BY 1 ORDER BY n DESC`, params)).rows;
  const byUser = (await db.query(`SELECT u.name, count(*)::int activities, count(DISTINCT a.opportunity_id)::int opportunities_touched, count(*) FILTER (WHERE a.outcome='Positive')::int positive FROM activities a JOIN users u ON u.id=a.owner_id WHERE ${where} GROUP BY u.name ORDER BY activities DESC LIMIT 25`, params)).rows;
  const byWeek = (await db.query(`SELECT to_char(date_trunc('week', a.activity_date),'YYYY-MM-DD') week, count(*)::int n FROM activities a WHERE ${where} GROUP BY 1 ORDER BY 1`, params)).rows;
  const wins = (await db.query(`SELECT u.name, count(*)::int won, COALESCE(sum(o.amount_base),0)::float won_value FROM opportunities o JOIN users u ON u.id=o.owner_id WHERE o.status='Won' AND o.closed_at::date >= $1 AND o.is_deleted=false GROUP BY u.name`, [from])).rows;
  res.json({ from, by_type: byType, by_user: byUser.map((u) => ({ ...u, outcomes: wins.find((w) => w.name === u.name) || { won: 0, won_value: 0 } })), by_week: byWeek });
}));

// ------------------------------------------------------------------- events
approvals.registerHandler('event', {
  async onApproved(ctx, req, i, c) { await c.query(`UPDATE events SET status='Approved' WHERE id=$1`, [req.record_id]); },
  async onRejected(ctx, req, i, c) { await c.query(`UPDATE events SET status='Draft' WHERE id=$1`, [req.record_id]); },
  async onReturned(ctx, req, i, c) { await c.query(`UPDATE events SET status='Draft' WHERE id=$1`, [req.record_id]); },
  async onWithdrawn(ctx, req, i, c) { await c.query(`UPDATE events SET status='Draft' WHERE id=$1`, [req.record_id]); },
});
hooks.register('events', {
  validate(ctx, v) { const e = []; if (v.end_at && v.start_at && new Date(v.end_at) < new Date(v.start_at)) e.push({ field: 'end_at', message: 'End cannot be before start' }); return e; },
  async beforeCreate(ctx, v) { v.status = 'Draft'; },
  async decorateOne(o) {
    const { rows } = await db.query(`SELECT count(*) FILTER (WHERE status IN ('Registered','Attended','No-show'))::int reg, count(*) FILTER (WHERE status='Attended')::int att, count(*) FILTER (WHERE lead_created)::int leads FROM event_registrations WHERE event_id=$1 AND is_deleted=false`, [o.id]);
    o.registered_count = rows[0].reg; o.attended_count = rows[0].att; o.leads_generated = rows[0].leads;
    const { rows: pi } = await db.query(`SELECT COALESCE(sum(o.amount_base),0)::float v FROM opportunities o JOIN leads l ON l.converted_opportunity_id=o.id WHERE l.source='Event' AND l.campaign_id=$1 AND o.is_deleted=false`, [o.campaign_id || 0]);
    o.pipeline_influenced = pi[0].v;
    const budgetBase = o.budget ? await fx.toBase(o.budget, o.currency) : 0;
    o._roi = { budget: budgetBase, actual_cost: o.actual_cost, variance: budgetBase - (o.actual_cost || 0), cost_per_lead: o.leads_generated ? Math.round((o.actual_cost || 0) / o.leads_generated * 100) / 100 : null };
    return o;
  },
});
hooks.register('event_registrations', {
  async validate(ctx, v) {
    const { rows } = await db.query('SELECT capacity, status FROM events WHERE id=$1', [v.event_id]);
    const e = []; if (rows[0] && rows[0].capacity) { const n = (await db.query(`SELECT count(*)::int n FROM event_registrations WHERE event_id=$1 AND status='Registered' AND is_deleted=false`, [v.event_id])).rows[0].n; if (n >= rows[0].capacity && v.status === 'Registered') e.push({ field: 'status', message: 'Event is at capacity - set the status to Waitlisted' }); }
    return e;
  },
});
entities.events.actions = {
  submit_budget: { label: 'Submit budget for approval', perm: 'S', async run(ctx, ev) {
    if (!['Draft'].includes(ev.status)) throw bad('Only draft events can be submitted');
    if (!ev.budget) throw bad('Enter a budget first');
    return db.tx(async (c) => {
      const base = await fx.toBase(ev.budget, ev.currency, null, c);
      const r = await approvals.submit(ctx, { type: 'event', entity: 'events', recordId: ev.id, label: ev.name, amount: ev.budget, currency: ev.currency, snapshot: { amount_base: base } }, c);
      if (!r.required) await c.query(`UPDATE events SET status='Approved' WHERE id=$1`, [ev.id]); else await c.query(`UPDATE events SET status='Budget pending', approval_request_id=$2 WHERE id=$1`, [ev.id, r.request.id]);
      return { approval: r.required ? r.request.number : 'auto-approved' };
    });
  } },
  open_registration: { label: 'Open registration & publish', perm: 'E', async run(ctx, ev) { if (ev.status !== 'Approved') throw bad('Event budget must be approved first'); await db.query(`UPDATE events SET status='Open for registration', published=true WHERE id=$1`, [ev.id]); await audit(ctx, { event: 'event_opened', entity: 'events', recordId: ev.id, label: ev.name }); } },
  start: { label: 'Mark in progress', perm: 'E', async run(ctx, ev) { await db.query(`UPDATE events SET status='In progress' WHERE id=$1`, [ev.id]); } },
  complete: { label: 'Complete event', perm: 'E', async run(ctx, ev) {
    await db.tx(async (c) => {
      await c.query(`UPDATE event_registrations SET status='No-show' WHERE event_id=$1 AND status='Registered'`, [ev.id]);
      await c.query(`UPDATE events SET status='Completed' WHERE id=$1`, [ev.id]);
      await c.query(`UPDATE event_registrations SET dietary=NULL WHERE event_id=$1`, [ev.id]);   // BRULE-EVT-008: anonymise sensitive attendee data after the event
      await audit(ctx, { event: 'event_completed', entity: 'events', recordId: ev.id, label: ev.name }, c);
    });
  } },
  cancel: { label: 'Cancel event', perm: 'E', prompt: 'reason', async run(ctx, ev, b) { if (!b.reason) throw bad('Reason required'); await db.query(`UPDATE events SET status='Cancelled' WHERE id=$1`, [ev.id]); await audit(ctx, { event: 'event_cancelled', entity: 'events', recordId: ev.id, label: ev.name, detail: b.reason }); } },
  leads_from_attendees: { label: 'Create leads from attendees', perm: 'E', async run(ctx, ev) {
    const { rows: regs } = await db.query(`SELECT * FROM event_registrations WHERE event_id=$1 AND status IN ('Attended','Registered') AND lead_created=false AND is_deleted=false AND contact_id IS NULL AND user_id IS NULL`, [ev.id]);
    let n = 0;
    await db.tx(async (c) => {
      for (const r of regs) {
        if (!r.attendee_email) continue;
        const dup = await c.query('SELECT 1 FROM leads WHERE lower(email)=lower($1) AND is_deleted=false', [r.attendee_email]);
        if (dup.rows.length) continue;
        const num = await nextNumber('LEAD', c); const parts = r.attendee_name.split(' ');
        await c.query(`INSERT INTO leads (number, owner_id, company, first_name, last_name, email, country, source, status, campaign_id, interest, created_by, modified_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'Event','New',$8,$9,$2,$2)`,
          [num, ev.owner_id, r.company || r.attendee_name, parts.slice(0, -1).join(' ') || null, parts[parts.length - 1], r.attendee_email, ev.country || 'KH', ev.campaign_id, `Attended ${ev.name}`]);
        await c.query('UPDATE event_registrations SET lead_created=true WHERE id=$1', [r.id]); n++;
      }
      await audit(ctx, { event: 'event_leads', entity: 'events', recordId: ev.id, label: ev.name, detail: `${n} leads created` }, c);
    });
    return { created: n };
  } },
};
entities.event_registrations.actions = {
  mark_attended: { label: 'Mark attended', perm: 'E', async run(ctx, r) { await db.query(`UPDATE event_registrations SET status='Attended' WHERE id=$1`, [r.id]); } },
};
router.post('/events/:id/register', wrap(async (req, res) => {   // employee self-registration for published events
  const { rows } = await db.query(`SELECT * FROM events WHERE id=$1 AND is_deleted=false AND published AND status='Open for registration'`, [req.params.id]);
  const e = rows[0]; if (!e) throw notFound('Event is not open for registration');
  const ex = await db.query('SELECT id FROM event_registrations WHERE event_id=$1 AND user_id=$2 AND is_deleted=false', [e.id, req.ctx.id]);
  if (ex.rows[0]) throw bad('You are already registered');
  const n = (await db.query(`SELECT count(*)::int n FROM event_registrations WHERE event_id=$1 AND status='Registered' AND is_deleted=false`, [e.id])).rows[0].n;
  const status = e.capacity && n >= e.capacity ? 'Waitlisted' : 'Registered';
  await db.query(`INSERT INTO event_registrations (event_id, attendee_name, attendee_email, company, user_id, status, dietary, created_by, modified_by) VALUES ($1,$2,$3,'Internal',$4,$5,$6,$4,$4)`, [e.id, req.ctx.user.name, req.ctx.user.email, req.ctx.id, status, (req.body || {}).dietary || null]);
  res.json({ status });
}));

// -------------------------------------------------------------- org chart (M33)
router.get('/org/chart', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT u.id, u.name, u.job_title, u.manager_id, u.country, u.team_id, t.name team, u.status, ${A.fieldAccess(req.ctx, 'employee').view ? 'u.job_grade' : 'NULL::text'} AS job_grade FROM users u LEFT JOIN teams t ON t.id=u.team_id WHERE u.is_deleted=false AND u.user_type='internal' AND u.status<>'Deactivated' ORDER BY u.name`);
  res.json(rows);
}));
router.post('/org/impact-preview', wrap(async (req, res) => {
  if (!A.roleHas(req.ctx, 'ROL-ORGA', 'ROL-ADM')) throw forbidden();
  const { employee_id, new_manager_id } = req.body || {};
  if (!employee_id) throw bad('employee_id required');
  const q = async (sql, p) => (await db.query(sql, p)).rows[0].n;
  const emp = (await db.query('SELECT name, manager_id FROM users WHERE id=$1', [employee_id])).rows[0];
  if (!emp) throw notFound();
  // cycle detection
  if (new_manager_id) {
    const { rows } = await db.query(`WITH RECURSIVE up AS (SELECT id, manager_id FROM users WHERE id=$1 UNION SELECT u.id, u.manager_id FROM users u JOIN up ON u.id=up.manager_id) SELECT 1 FROM up WHERE id=$2`, [new_manager_id, employee_id]);
    if (rows.length) throw bad('This change would create a reporting-line cycle');
  }
  res.json({
    employee: emp.name, direct_reports: await q('SELECT count(*)::int n FROM users WHERE manager_id=$1 AND is_deleted=false', [employee_id]),
    pending_approvals_as_submitter: await q(`SELECT count(*)::int n FROM approval_requests WHERE submitter_id=$1 AND status='Pending'`, [employee_id]),
    pending_approval_steps_as_approver: await q(`SELECT count(*)::int n FROM approval_steps WHERE approver_id=$1 AND status='Pending'`, [employee_id]),
    open_opportunities: await q(`SELECT count(*)::int n FROM opportunities WHERE owner_id=$1 AND status='Open' AND is_deleted=false`, [employee_id]),
    open_tasks: await q(`SELECT count(*)::int n FROM tasks WHERE owner_id=$1 AND status NOT IN ('Completed','Cancelled') AND is_deleted=false`, [employee_id]),
    claims_in_approval: await q(`SELECT count(*)::int n FROM claims WHERE owner_id=$1 AND status='In approval' AND is_deleted=false`, [employee_id]),
    note: 'Pending approval steps already resolved to the current manager are not re-routed automatically; use delegation or the audited admin intervention.',
  });
}));

module.exports = { router, busyFor, periodFor };
