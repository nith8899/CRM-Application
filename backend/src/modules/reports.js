'use strict';
// M01 dashboards and M22 report catalogue.
const express = require('express');
const db = require('../db');
const A = require('../core/access');
const { audit } = require('../core/audit');
const { forbidden, notFound, wrap } = require('../core/errors');
const { stages } = require('./opportunities');

const router = express.Router();
const q = async (sql, p) => (await db.query(sql, p)).rows;
const first = async (sql, p) => (await db.query(sql, p)).rows[0];
const qStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)).toISOString().slice(0, 10); };

router.get('/dashboard', wrap(async (req, res) => {
  const ctx = req.ctx; const out = { generated_at: new Date().toISOString(), widgets: {} };
  const W = out.widgets;
  // ---- tasks (everyone)
  W.tasks = await first(`SELECT count(*) FILTER (WHERE due_at::date = current_date AND status NOT IN ('Completed','Cancelled'))::int due_today,
      count(*) FILTER (WHERE due_at < now() AND status NOT IN ('Completed','Cancelled'))::int overdue,
      count(*) FILTER (WHERE status NOT IN ('Completed','Cancelled'))::int open FROM tasks WHERE owner_id=$1 AND is_deleted=false`, [ctx.id]);
  W.my_tasks = await q(`SELECT id, subject, due_at, priority, status FROM tasks WHERE owner_id=$1 AND is_deleted=false AND status NOT IN ('Completed','Cancelled') ORDER BY due_at NULLS LAST LIMIT 8`, [ctx.id]);
  W.approvals = await first(`SELECT count(*)::int pending FROM approval_requests r WHERE r.status='Pending' AND r.submitter_id <> $3 AND EXISTS (SELECT 1 FROM approval_steps s WHERE s.request_id=r.id AND s.status='Pending' AND (s.approver_id=ANY($1::bigint[]) OR (s.approver_id IS NULL AND s.role_code=ANY($2::text[]) AND (s.candidates IS NULL OR s.candidates @> to_jsonb($3::bigint)))))`, [[ctx.id, ...ctx.delegators], [...ctx.roles], ctx.id]);
  W.my_meetings = await q(`SELECT DISTINCT m.id, m.subject, m.start_at, m.location FROM meetings m LEFT JOIN meeting_participants mp ON mp.meeting_id=m.id WHERE m.is_deleted=false AND (m.owner_id=$1 OR mp.user_id=$1) AND m.start_at >= now() AND m.status IN ('Planned','Rescheduled') ORDER BY m.start_at LIMIT 5`, [ctx.id]);
  const nots = await first(`SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND status='Sent' AND read_at IS NULL`, [ctx.id]); W.unread = nots.n;

  // ---- sales (scoped)
  if (A.can(ctx, 'M08', 'V')) {
    const p = []; const sc = await A.scopeClause('opportunities', ctx, p, 'V', 't'); const S = sc ? ' AND ' + sc : '';
    W.kpis = await first(`SELECT COALESCE(sum(amount_base) FILTER (WHERE status='Open'),0)::float pipeline, COALESCE(sum(amount_base*probability/100) FILTER (WHERE status='Open'),0)::float weighted,
        count(*) FILTER (WHERE status='Open')::int open_count, COALESCE(avg(amount_base) FILTER (WHERE status='Open'),0)::float avg_deal,
        COALESCE(sum(amount_base) FILTER (WHERE status='Won' AND closed_at::date >= '${qStart()}'),0)::float won_qtd,
        count(*) FILTER (WHERE status='Won' AND closed_at::date >= '${qStart()}')::int won_count,
        count(*) FILTER (WHERE status='Lost' AND closed_at::date >= '${qStart()}')::int lost_count
        FROM opportunities t WHERE t.is_deleted=false ${S}`, p);
    const decided = W.kpis.won_count + W.kpis.lost_count; W.kpis.win_rate = decided ? Math.round(W.kpis.won_count / decided * 1000) / 10 : null;
    const sts = await stages();
    const bs = await q(`SELECT stage, count(*)::int n, COALESCE(sum(amount_base),0)::float amount FROM opportunities t WHERE t.is_deleted=false AND t.status='Open' ${S} GROUP BY stage`, p);
    W.by_stage = sts.filter((s) => !['S11', 'S12', 'S13'].includes(s.code)).map((s) => ({ code: s.code, name: s.name, count: (bs.find((b) => b.stage === s.code) || {}).n || 0, amount: (bs.find((b) => b.stage === s.code) || {}).amount || 0 }));
    W.top_deals = await q(`SELECT t.id, t.number, t.name, t.amount_base, t.probability, t.close_date, t.stage, a.legal_name account FROM opportunities t JOIN accounts a ON a.id=t.account_id WHERE t.is_deleted=false AND t.status='Open' ${S} ORDER BY t.amount_base DESC LIMIT 6`, p);
    W.closing_soon = await q(`SELECT t.id, t.name, t.amount_base, t.close_date, t.stage FROM opportunities t WHERE t.is_deleted=false AND t.status='Open' AND t.close_date BETWEEN current_date AND current_date + 30 ${S} ORDER BY t.close_date LIMIT 6`, p);
    const stalledSql = `SELECT t.id, t.name, t.stage, COALESCE(t.last_activity_at, t.created_at) last_activity FROM opportunities t JOIN stage_definitions sd ON sd.code=t.stage AND sd.pipeline='Standard' WHERE t.is_deleted=false AND t.status='Open' AND sd.inactivity_days IS NOT NULL AND COALESCE(t.last_activity_at, t.created_at) < now() - (sd.inactivity_days || ' days')::interval ${S} ORDER BY 4 LIMIT 6`;
    W.stalled = await q(stalledSql, p);
    W.monthly_won = await q(`SELECT to_char(date_trunc('month', closed_at),'YYYY-MM') AS month, COALESCE(sum(amount_base),0)::float won FROM opportunities t WHERE t.is_deleted=false AND t.status='Won' AND closed_at > now() - interval '6 months' ${S} GROUP BY 1 ORDER BY 1`, p);
  }
  if (A.can(ctx, 'M13', 'V')) {
    const p = []; const sc = await A.scopeClause('quotations', ctx, p, 'V', 'q'); const S = sc ? ' AND ' + sc : '';
    W.expiring_quotes = await q(`SELECT q.id, q.number, v.valid_until, v.grand_total, v.currency FROM quotations q JOIN quotation_versions v ON v.quotation_id=q.id AND v.version_no=q.current_version_no WHERE q.is_deleted=false AND v.status IN ('Approved','Sent') AND v.valid_until BETWEEN current_date AND current_date + 14 ${S} ORDER BY v.valid_until LIMIT 6`, p);
    W.quote_status = await q(`SELECT q.status, count(*)::int n FROM quotations q WHERE q.is_deleted=false ${S} GROUP BY 1 ORDER BY 2 DESC`, p);
  }
  if (A.can(ctx, 'M02', 'V')) {
    const p = []; const sc = await A.scopeClause('leads', ctx, p, 'V', 't'); const S = sc ? ' AND ' + sc : '';
    W.leads = await q(`SELECT status, count(*)::int n FROM leads t WHERE t.is_deleted=false ${S} GROUP BY 1 ORDER BY 2 DESC`, p);
  }
  if (A.can(ctx, 'M19', 'V')) {
    const p = []; const sc = await A.scopeClause('renewals', ctx, p, 'V', 't'); const S = sc ? ' AND ' + sc : '';
    W.renewals = await q(`SELECT t.id, t.number, t.due_date, t.expected_value, c.name contract FROM renewals t JOIN contracts c ON c.id=t.contract_id WHERE t.is_deleted=false AND t.status IN ('Upcoming','In progress') AND t.due_date <= current_date + 90 ${S} ORDER BY t.due_date LIMIT 6`, p);
  }
  if (A.can(ctx, 'M09', 'V')) {
    const p = []; const sc = await A.scopeClause('deal_registrations', ctx, p, 'V', 't'); const S = sc ? ' AND ' + sc : '';
    W.dreg_expiring = await q(`SELECT t.id, t.number, t.protection_end FROM deal_registrations t WHERE t.is_deleted=false AND t.status='Vendor approved' AND t.protection_end BETWEEN current_date AND current_date + 30 ${S} ORDER BY t.protection_end LIMIT 5`, p);
  }
  if (A.can(ctx, 'M18', 'V')) {
    const d = new Date(); const per = `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    const p = []; const sc = await A.scopeClause('opportunities', ctx, p, 'V', 't'); const S = sc ? ' AND ' + sc : ''; p.push(qStart());
    W.forecast = await first(`SELECT COALESCE(sum(amount_base) FILTER (WHERE forecast_category='Commit'),0)::float commit, COALESCE(sum(amount_base) FILTER (WHERE forecast_category='Best case'),0)::float best_case FROM opportunities t WHERE t.is_deleted=false AND t.status='Open' AND t.close_date >= $${p.length}::date AND t.close_date < ($${p.length}::date + interval '3 months') ${S}`, p);
    W.forecast.period = per;
  }
  if (A.can(ctx, 'M35', 'V')) W.my_claims = await q(`SELECT status, payment_status, count(*)::int n, COALESCE(sum(total_amount),0)::float total FROM claims WHERE owner_id=$1 AND is_deleted=false GROUP BY 1,2`, [ctx.id]);
  res.json(out);
}));

// ---------------------------------------------------------------- report catalogue
const REPORTS = [
  { id: 'RPT-01', name: 'Pipeline by stage', module: 'M08', entity: 'opportunities', cols: [['stage', 'Stage'], ['count', 'Opportunities', 'int'], ['amount', 'Amount (base)', 'money'], ['weighted', 'Weighted', 'money']],
    sql: (S) => `SELECT sd.name stage, count(*)::int count, COALESCE(sum(t.amount_base),0)::float amount, COALESCE(sum(t.amount_base*t.probability/100),0)::float weighted FROM opportunities t JOIN stage_definitions sd ON sd.code=t.stage AND sd.pipeline='Standard' WHERE t.is_deleted=false AND t.status='Open' ${S} GROUP BY sd.name, sd.sort_order ORDER BY sd.sort_order` },
  { id: 'RPT-02', name: 'Pipeline by owner', module: 'M08', entity: 'opportunities', cols: [['owner', 'Owner'], ['count', 'Opportunities', 'int'], ['amount', 'Amount (base)', 'money'], ['weighted', 'Weighted', 'money']],
    sql: (S) => `SELECT u.name owner, count(*)::int count, COALESCE(sum(t.amount_base),0)::float amount, COALESCE(sum(t.amount_base*t.probability/100),0)::float weighted FROM opportunities t JOIN users u ON u.id=t.owner_id WHERE t.is_deleted=false AND t.status='Open' ${S} GROUP BY u.name ORDER BY amount DESC` },
  { id: 'RPT-03', name: 'Pipeline by partner', module: 'M08', entity: 'opportunities', cols: [['partner', 'Partner'], ['count', 'Opportunities', 'int'], ['amount', 'Amount (base)', 'money']],
    sql: (S) => `SELECT COALESCE(p.name,'(Direct)') partner, count(*)::int count, COALESCE(sum(t.amount_base),0)::float amount FROM opportunities t LEFT JOIN partners p ON p.id=t.primary_partner_id WHERE t.is_deleted=false AND t.status='Open' ${S} GROUP BY 1 ORDER BY amount DESC` },
  { id: 'RPT-04', name: 'Pipeline by vendor', module: 'M08', entity: 'opportunities', cols: [['vendor', 'Vendor'], ['count', 'Opportunities', 'int'], ['amount', 'Amount (base)', 'money']],
    sql: (S) => `SELECT v.name vendor, count(DISTINCT t.id)::int count, COALESCE(sum(t.amount_base),0)::float amount FROM opportunities t JOIN opportunity_partners op ON op.opportunity_id=t.id AND op.is_deleted=false JOIN vendors v ON v.id=op.vendor_id WHERE t.is_deleted=false AND t.status='Open' ${S} GROUP BY v.name ORDER BY amount DESC` },
  { id: 'RPT-05', name: 'Win / loss analysis (by month)', module: 'M08', entity: 'opportunities', cols: [['month', 'Month'], ['won', 'Won', 'int'], ['lost', 'Lost', 'int'], ['won_value', 'Won value', 'money'], ['win_rate', 'Win rate %', 'pct']],
    sql: (S) => `SELECT to_char(date_trunc('month', t.closed_at),'YYYY-MM') AS month, count(*) FILTER (WHERE t.status='Won')::int won, count(*) FILTER (WHERE t.status='Lost')::int lost, COALESCE(sum(t.amount_base) FILTER (WHERE t.status='Won'),0)::float won_value, round(100.0*count(*) FILTER (WHERE t.status='Won')/NULLIF(count(*) FILTER (WHERE t.status IN ('Won','Lost')),0),1)::float win_rate FROM opportunities t WHERE t.is_deleted=false AND t.status IN ('Won','Lost') ${S} GROUP BY 1 ORDER BY 1 DESC` },
  { id: 'RPT-06', name: 'Loss reasons', module: 'M08', entity: 'opportunities', cols: [['reason', 'Loss reason'], ['count', 'Opportunities', 'int'], ['amount', 'Lost value', 'money']],
    sql: (S) => `SELECT COALESCE(t.loss_reason,'(none)') reason, count(*)::int count, COALESCE(sum(t.amount_base),0)::float amount FROM opportunities t WHERE t.is_deleted=false AND t.status='Lost' ${S} GROUP BY 1 ORDER BY 2 DESC` },
  { id: 'RPT-07', name: 'Stage-to-win conversion (calibration)', module: 'M08', entity: 'opportunities', cols: [['stage', 'Stage'], ['reached', 'Reached', 'int'], ['won', 'Of which won', 'int'], ['conv', 'Stage-to-win %', 'pct'], ['default_prob', 'Default prob %', 'pct']],
    sql: (S) => `SELECT sd.name stage, count(DISTINCT h.opportunity_id)::int reached, count(DISTINCT h.opportunity_id) FILTER (WHERE t.status='Won')::int won, round(100.0*count(DISTINCT h.opportunity_id) FILTER (WHERE t.status='Won')/NULLIF(count(DISTINCT h.opportunity_id),0),1)::float conv, sd.probability::float default_prob FROM opportunity_stage_history h JOIN opportunities t ON t.id=h.opportunity_id JOIN stage_definitions sd ON sd.code=h.to_stage AND sd.pipeline='Standard' WHERE t.is_deleted=false AND sd.sort_order < 11 ${S} GROUP BY sd.name, sd.sort_order, sd.probability ORDER BY sd.sort_order` },
  { id: 'RPT-08', name: 'Opportunities closing this quarter', module: 'M08', entity: 'opportunities', cols: [['number', 'Number'], ['name', 'Name'], ['account', 'Account'], ['owner', 'Owner'], ['stage', 'Stage'], ['amount', 'Amount (base)', 'money'], ['probability', 'Prob %', 'pct'], ['close_date', 'Close date']],
    sql: (S) => `SELECT t.number, t.name, a.legal_name account, u.name owner, sd.name stage, t.amount_base::float amount, t.probability::float probability, t.close_date FROM opportunities t JOIN accounts a ON a.id=t.account_id JOIN users u ON u.id=t.owner_id JOIN stage_definitions sd ON sd.code=t.stage AND sd.pipeline='Standard' WHERE t.is_deleted=false AND t.status='Open' AND date_trunc('quarter', t.close_date)=date_trunc('quarter', current_date) ${S} ORDER BY t.close_date` },
  { id: 'RPT-09', name: 'Stalled opportunities', module: 'M08', entity: 'opportunities', cols: [['number', 'Number'], ['name', 'Name'], ['owner', 'Owner'], ['stage', 'Stage'], ['days', 'Days inactive', 'int'], ['amount', 'Amount (base)', 'money']],
    sql: (S) => `SELECT t.number, t.name, u.name owner, sd.name stage, extract(day from now()-COALESCE(t.last_activity_at,t.created_at))::int days, t.amount_base::float amount FROM opportunities t JOIN users u ON u.id=t.owner_id JOIN stage_definitions sd ON sd.code=t.stage AND sd.pipeline='Standard' WHERE t.is_deleted=false AND t.status='Open' AND sd.inactivity_days IS NOT NULL AND COALESCE(t.last_activity_at,t.created_at) < now()-(sd.inactivity_days||' days')::interval ${S} ORDER BY days DESC` },
  { id: 'RPT-22', name: 'Quotation register & status', module: 'M13', entity: 'quotations', cols: [['number', 'Quotation'], ['opportunity', 'Opportunity'], ['version', 'Version', 'int'], ['status', 'Status'], ['currency', 'Ccy'], ['total', 'Total', 'money'], ['valid_until', 'Valid until'], ['owner', 'Owner']],
    sql: (S) => `SELECT t.number, o.name opportunity, v.version_no version, v.status, v.currency, v.grand_total::float total, v.valid_until, u.name owner FROM quotations t JOIN opportunities o ON o.id=t.opportunity_id JOIN quotation_versions v ON v.quotation_id=t.id AND v.version_no=t.current_version_no JOIN users u ON u.id=t.owner_id WHERE t.is_deleted=false ${S} ORDER BY t.id DESC` },
  { id: 'RPT-23', name: 'Quotation turnaround (KPI-12)', module: 'M13', entity: 'quotations', cols: [['number', 'Quotation'], ['owner', 'Owner'], ['hours_to_approval', 'Hours to approval', 'num'], ['hours_to_issue', 'Hours to issue', 'num']],
    sql: (S) => `SELECT t.number, u.name owner, round(extract(epoch from (v.approved_at - t.turnaround_start))/3600,1)::float hours_to_approval, round(extract(epoch from (v.sent_at - t.turnaround_start))/3600,1)::float hours_to_issue FROM quotations t JOIN quotation_versions v ON v.quotation_id=t.id AND v.version_no=1 JOIN users u ON u.id=t.owner_id WHERE t.is_deleted=false AND v.approved_at IS NOT NULL ${S} ORDER BY t.id DESC` },
  { id: 'RPT-25', name: 'Margin by quotation', module: 'M14', entity: 'quotations', needs: 'margin', cols: [['number', 'Quotation'], ['status', 'Status'], ['subtotal', 'Subtotal', 'money'], ['gp', 'Gross profit', 'money'], ['gm', 'GM %', 'pct']],
    sql: (S) => `SELECT t.number, v.status, v.subtotal::float subtotal, v.gross_profit::float gp, round(v.gm_pct,2)::float gm FROM quotations t JOIN quotation_versions v ON v.quotation_id=t.id AND v.version_no=t.current_version_no WHERE t.is_deleted=false ${S} ORDER BY v.gm_pct NULLS LAST` },
  { id: 'RPT-12', name: 'Deal registrations expiring (90 days)', module: 'M09', entity: 'deal_registrations', cols: [['number', 'Number'], ['vendor', 'Vendor'], ['partner', 'Partner'], ['status', 'Status'], ['protection_end', 'Protection ends'], ['days', 'Days left', 'int']],
    sql: (S) => `SELECT t.number, v.name vendor, COALESCE(p.name,'-') partner, t.status, t.protection_end, (t.protection_end - current_date)::int days FROM deal_registrations t JOIN vendors v ON v.id=t.vendor_id LEFT JOIN partners p ON p.id=t.partner_id WHERE t.is_deleted=false AND t.status='Vendor approved' AND t.protection_end <= current_date + 90 ${S} ORDER BY t.protection_end` },
  { id: 'RPT-15', name: 'Renewals due (120 days)', module: 'M19', entity: 'renewals', cols: [['number', 'Renewal'], ['contract', 'Contract'], ['account', 'Account'], ['due_date', 'Due'], ['status', 'Status'], ['value', 'Expected value', 'money']],
    sql: (S) => `SELECT t.number, c.name contract, a.legal_name account, t.due_date, t.status, t.expected_value::float value FROM renewals t JOIN contracts c ON c.id=t.contract_id JOIN accounts a ON a.id=c.account_id WHERE t.is_deleted=false AND t.status IN ('Upcoming','In progress') AND t.due_date <= current_date + 120 ${S} ORDER BY t.due_date` },
  { id: 'RPT-18', name: 'Lead conversion by source', module: 'M02', entity: 'leads', cols: [['source', 'Source'], ['total', 'Leads', 'int'], ['qualified', 'Qualified', 'int'], ['converted', 'Converted', 'int'], ['rate', 'Conversion %', 'pct']],
    sql: (S) => `SELECT t.source, count(*)::int total, count(*) FILTER (WHERE t.status IN ('Qualified','Converted'))::int qualified, count(*) FILTER (WHERE t.status='Converted')::int converted, round(100.0*count(*) FILTER (WHERE t.status='Converted')/count(*),1)::float rate FROM leads t WHERE t.is_deleted=false ${S} GROUP BY 1 ORDER BY 2 DESC` },
  { id: 'RPT-30', name: 'Activity summary by user', module: 'M10', entity: 'activities', cols: [['owner', 'User'], ['type', 'Type'], ['count', 'Activities', 'int'], ['positive', 'Positive outcomes', 'int']],
    sql: (S) => `SELECT u.name owner, t.activity_type type, count(*)::int count, count(*) FILTER (WHERE t.outcome='Positive')::int positive FROM activities t JOIN users u ON u.id=t.owner_id WHERE t.is_deleted=false AND t.status='Completed' AND t.activity_date > now() - interval '90 days' ${S} GROUP BY 1,2 ORDER BY 1,3 DESC` },
  { id: 'RPT-31', name: 'Overdue tasks', module: 'M30', entity: 'tasks', cols: [['number', 'Task'], ['subject', 'Subject'], ['owner', 'Owner'], ['priority', 'Priority'], ['due_at', 'Due'], ['escalation', 'Escalation']],
    sql: (S) => `SELECT t.number, t.subject, u.name owner, t.priority, t.due_at, t.escalation_status escalation FROM tasks t JOIN users u ON u.id=t.owner_id WHERE t.is_deleted=false AND t.status NOT IN ('Completed','Cancelled') AND t.due_at < now() ${S} ORDER BY t.due_at` },
  { id: 'RPT-40', name: 'Claims by status & category', module: 'M35', entity: 'claims', cols: [['status', 'Claim status'], ['payment', 'Payment status'], ['count', 'Claims', 'int'], ['total', 'Total', 'money']],
    sql: (S) => `SELECT t.status, t.payment_status payment, count(*)::int count, COALESCE(sum(t.approved_amount),0)::float total FROM claims t WHERE t.is_deleted=false ${S} GROUP BY 1,2 ORDER BY 1` },
  { id: 'RPT-41', name: 'Event ROI', module: 'M34', entity: 'events', cols: [['name', 'Event'], ['status', 'Status'], ['budget', 'Budget', 'money'], ['actual_cost', 'Actual cost (claims)', 'money'], ['registered', 'Registered', 'int'], ['attended', 'Attended', 'int']],
    sql: (S) => `SELECT t.name, t.status, t.budget::float budget, t.actual_cost::float actual_cost, (SELECT count(*) FROM event_registrations r WHERE r.event_id=t.id AND r.status IN ('Registered','Attended','No-show') AND r.is_deleted=false)::int registered, (SELECT count(*) FROM event_registrations r WHERE r.event_id=t.id AND r.status='Attended' AND r.is_deleted=false)::int attended FROM events t WHERE t.is_deleted=false ${S} ORDER BY t.start_at DESC` },
];

router.get('/reports', wrap(async (req, res) => {
  const ctx = req.ctx;
  res.json(REPORTS.filter((r) => A.can(ctx, r.module, 'V') && (!r.needs || A.fieldAccess(ctx, r.needs).view) && A.can(ctx, 'M22', 'V')).map((r) => ({ id: r.id, name: r.name, module: r.module, columns: r.cols.map(([key, label, type]) => ({ key, label, type: type || 'text' })) })));
}));
router.get('/reports/:id', wrap(async (req, res) => {
  const ctx = req.ctx; const r = REPORTS.find((x) => x.id === req.params.id);
  if (!r) throw notFound('Unknown report');
  if (!A.can(ctx, 'M22', 'V') || !A.can(ctx, r.module, 'V') || (r.needs && !A.fieldAccess(ctx, r.needs).view)) throw forbidden();
  const params = []; const sc = await A.scopeClause(r.entity, ctx, params, 'V', 't');
  const rows = await q(r.sql(sc ? ' AND ' + sc : ''), params);
  const columns = r.cols.map(([key, label, type]) => ({ key, label, type: type || 'text' }));
  if (req.query.format === 'csv') {
    if (!A.can(ctx, 'M22', 'X')) throw forbidden('You cannot export reports');
    const esc = (v) => { if (v == null) return ''; const s = v instanceof Date ? v.toISOString() : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    await audit(ctx, { event: 'export', entity: 'reports', label: r.id, detail: `${rows.length} rows` });
    res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', `attachment; filename="${r.id}.csv"`);
    return res.send('﻿' + [columns.map((c) => esc(c.label)).join(','), ...rows.map((row) => columns.map((c) => esc(row[c.key])).join(','))].join('\r\n'));
  }
  res.json({ id: r.id, name: r.name, columns, rows });
}));

module.exports = { router };
