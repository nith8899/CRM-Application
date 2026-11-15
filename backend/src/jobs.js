'use strict';
// Scheduled background jobs (expiry, alerts, escalation, integration worker, weekly forecast snapshot).
const db = require('./db');
const settings = require('./core/settings');
const { notify } = require('./core/notify');
const { audit } = require('./core/audit');

const sysCtx = (id = null) => ({ id, user: { name: 'System' }, roles: new Set(['ROL-ADM']), delegators: [], isAdmin: true, _cache: {}, ip: 'system' });
const day = () => new Date().toISOString().slice(0, 10);
const isoWeek = () => { const d = new Date(); const j = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return `${d.getUTCFullYear()}-W${Math.ceil(((d - j) / 86400000 + j.getUTCDay() + 1) / 7)}`; };

async function safe(name, fn, out) { try { out[name] = await fn(); } catch (e) { out[name] = `error: ${e.message}`; console.error(`job ${name} failed`, e.message); } }

async function quotationExpiry() {
  const { rows: ex } = await db.query(`UPDATE quotation_versions SET status='Expired' WHERE status IN ('Approved','Sent') AND valid_until < current_date RETURNING id, quotation_id`);
  for (const v of ex) { await db.query(`UPDATE quotations SET status='Expired' WHERE id=$1 AND current_version_no=(SELECT version_no FROM quotation_versions WHERE id=$2)`, [v.quotation_id, v.id]); }
  const { rows: soon } = await db.query(`SELECT q.id, q.number, q.owner_id, v.valid_until FROM quotations q JOIN quotation_versions v ON v.quotation_id=q.id AND v.version_no=q.current_version_no WHERE q.is_deleted=false AND v.status IN ('Approved','Sent') AND v.valid_until BETWEEN current_date AND current_date + 7`);
  for (const q of soon) await notify(q.owner_id, { type: 'quote_expiring', title: `Quotation ${q.number} expires ${q.valid_until}`, entity: 'quotations', recordId: q.id, dedupKey: `qexp-${q.id}-${q.valid_until}` });
  return { expired: ex.length, expiring: soon.length };
}
async function opportunityAlerts() {
  let n = 0;
  const { rows: stalled } = await db.query(`SELECT t.id, t.name, t.owner_id, sd.inactivity_days FROM opportunities t JOIN stage_definitions sd ON sd.code=t.stage AND sd.pipeline='Standard' WHERE t.is_deleted=false AND t.status='Open' AND sd.inactivity_days IS NOT NULL AND COALESCE(t.last_activity_at,t.created_at) < now() - (sd.inactivity_days || ' days')::interval AND (t.stalled_snooze_until IS NULL OR t.stalled_snooze_until < now())`);
  for (const o of stalled) { await notify(o.owner_id, { type: 'stalled', title: `Stalled: ${o.name}`, body: `No activity for over ${o.inactivity_days} days`, entity: 'opportunities', recordId: o.id, dedupKey: `stall-${o.id}-${isoWeek()}` }); n++; }
  const { rows: late } = await db.query(`SELECT id, name, owner_id FROM opportunities WHERE is_deleted=false AND status='Open' AND close_date < current_date`);
  for (const o of late) await notify(o.owner_id, { type: 'overdue_close', title: `Close date passed: ${o.name}`, entity: 'opportunities', recordId: o.id, dedupKey: `late-${o.id}-${isoWeek()}` });
  const { rows: hold } = await db.query(`SELECT id, name, owner_id FROM opportunities WHERE is_deleted=false AND status='On hold' AND review_date <= current_date`);
  for (const o of hold) await notify(o.owner_id, { type: 'hold_review', title: `Hold review due: ${o.name}`, entity: 'opportunities', recordId: o.id, dedupKey: `hold-${o.id}-${day()}` });
  return { stalled: n, overdue_close: late.length, hold_reviews: hold.length };
}
async function dealRegExpiry() {
  await db.query(`UPDATE deal_registrations SET status='Expired' WHERE status='Vendor approved' AND protection_end < current_date`);
  const { rows } = await db.query(`SELECT id, number, owner_id, protection_end, (protection_end - current_date)::int d FROM deal_registrations WHERE is_deleted=false AND status='Vendor approved' AND (protection_end - current_date) IN (30,14,7)`);
  for (const r of rows) await notify(r.owner_id, { type: 'dreg_expiring', title: `Deal registration ${r.number} expires in ${r.d} days`, entity: 'deal_registrations', recordId: r.id, dedupKey: `dreg-${r.id}-${r.d}` });
  return { alerts: rows.length };
}
async function contractLifecycle() {
  await db.query(`UPDATE contracts SET status='Expired' WHERE status IN ('Active','Expiring') AND end_date < current_date`);
  await db.query(`UPDATE contracts SET status='Expiring' WHERE status='Active' AND end_date <= current_date + 90`);
  // auto-create renewal opportunities inside the configured lead window
  const lead = await settings.get('renewal_lead_days', 90);
  const { rows } = await db.query(`SELECT r.id, r.owner_id FROM renewals r WHERE r.is_deleted=false AND r.status='Upcoming' AND r.opportunity_id IS NULL AND r.due_date <= current_date + $1::int`, [lead]);
  const { entities } = require('./entities');
  let created = 0;
  for (const r of rows) {
    try {
      const full = (await db.query('SELECT * FROM renewals WHERE id=$1', [r.id])).rows[0];
      const res = await entities.renewals.actions.create_opportunity.run(sysCtx(r.owner_id), full, {});
      await notify(r.owner_id, { type: 'renewal', title: 'Renewal opportunity created', entity: 'opportunities', recordId: res.opportunity_id, dedupKey: `ren-${r.id}` }); created++;
    } catch (e) { console.error('renewal auto-create failed', e.message); }
  }
  return { renewal_opps: created };
}
async function taskEscalation() {
  let n = 0;
  const { rows } = await db.query(`SELECT t.id, t.subject, t.owner_id, t.priority, t.due_at, t.escalation_status, u.manager_id, extract(epoch from now()-t.due_at)/3600 AS hrs FROM tasks t JOIN users u ON u.id=t.owner_id WHERE t.is_deleted=false AND t.status NOT IN ('Completed','Cancelled') AND t.due_at < now() AND t.priority IN ('Critical','High')`);
  for (const t of rows) {
    const level = t.hrs > 72 ? 'Level 3' : t.hrs > 24 ? 'Level 2' : t.priority === 'Critical' || t.hrs > 4 ? 'Level 1' : null;
    if (!level || level === t.escalation_status) continue;
    await db.query('UPDATE tasks SET escalation_status=$2 WHERE id=$1', [t.id, level]);
    if (t.manager_id) await notify(t.manager_id, { type: 'task_escalation', title: `Task overdue (${level}): ${t.subject}`, entity: 'tasks', recordId: t.id, dedupKey: `tesc-${t.id}-${level}` });
    n++;
  }
  return { escalated: n };
}
async function leadSla() {
  const hrs = await settings.get('lead_first_response_hours', 48);
  const { rows } = await db.query(`SELECT l.id, l.company, l.owner_id, u.manager_id FROM leads l JOIN users u ON u.id=l.owner_id WHERE l.is_deleted=false AND l.status IN ('New','Pending acceptance','Working') AND l.first_response_at IS NULL AND l.assigned_at < now() - ($1 || ' hours')::interval`, [String(hrs)]);
  for (const l of rows) if (l.manager_id) await notify(l.manager_id, { type: 'lead_sla', title: `Lead SLA breach: ${l.company}`, body: `No first response within ${hrs}h`, entity: 'leads', recordId: l.id, dedupKey: `lsla-${l.id}` });
  return { breaches: rows.length };
}
async function approvalSla() {
  const { rows } = await db.query(`SELECT s.id, s.request_id, s.label, s.approver_id, s.role_code, s.escalation_level, r.record_label FROM approval_steps s JOIN approval_requests r ON r.id=s.request_id WHERE s.status='Pending' AND s.sla_due < now() AND s.escalation_level < 3`);
  const { managerOf } = require('./modules/approvals'); let n = 0;
  for (const s of rows) {
    await db.query('UPDATE approval_steps SET escalation_level=escalation_level+1, sla_due=now() + interval \'24 hours\' WHERE id=$1', [s.id]);
    const target = s.approver_id ? await managerOf(s.approver_id) : null;
    if (target) await notify(target, { type: 'approval_escalation', title: `Approval overdue: ${s.record_label}`, body: s.label, entity: 'approval_requests', recordId: s.request_id, dedupKey: `aesc-${s.id}-${s.escalation_level + 1}` });
    else { const { notifyRole } = require('./core/notify'); await notifyRole('ROL-SOP', { type: 'approval_escalation', title: `Approval overdue: ${s.record_label}`, body: s.label, entity: 'approval_requests', recordId: s.request_id, dedupKey: `aesc-${s.id}-${s.escalation_level + 1}` }); }
    n++;
  }
  return { escalated: n };
}
async function integrationWorker() {
  const { rows } = await db.query(`SELECT l.*, i.status istatus FROM integration_logs l LEFT JOIN integrations i ON i.code=l.integration_code WHERE l.status IN ('Pending','Resubmitted')`);
  let ok = 0; let fail = 0;
  for (const l of rows) {
    if (l.istatus === 'Active') { await db.query(`UPDATE integration_logs SET status='Succeeded', attempts=attempts+1, updated_at=now(), error=NULL WHERE id=$1`, [l.id]); ok++; }
    else { const attempts = l.attempts + 1; await db.query(`UPDATE integration_logs SET status=$2, attempts=$3, error='Connector not configured or inactive', updated_at=now() WHERE id=$1`, [l.id, attempts >= 3 ? 'Dead-letter' : 'Failed', attempts]); fail++; }
  }
  return { succeeded: ok, failed: fail };
}
async function housekeeping() {
  const d = await db.query(`UPDATE delegations SET active=false WHERE active AND end_date < current_date`);
  const s = await db.query(`DELETE FROM record_shares WHERE expires_at IS NOT NULL AND expires_at < now() RETURNING entity, record_id`);
  for (const r of s.rows) await audit(sysCtx(), { event: 'share_expired', entity: r.entity, recordId: r.record_id, source: 'system' });
  await db.query(`UPDATE documents SET status='Expired' WHERE status='Active' AND expiry_date < current_date`);
  await db.query(`UPDATE partner_certifications SET status='Expired' WHERE status<>'Expired' AND expires_on < current_date`);
  return { delegations_closed: d.rowCount, shares_removed: s.rowCount };
}
async function weeklySnapshot() {
  const { takeSnapshot, currentQuarter } = require('./modules/forecast');
  const w = isoWeek();
  const { rows } = await db.query(`SELECT 1 FROM forecast_snapshots WHERE snapshot_type='Weekly' AND label=$1`, [`Weekly ${w}`]);
  if (rows.length) return { skipped: true };
  const id = await takeSnapshot(sysCtx(), { type: 'Weekly', label: `Weekly ${w}`, period: currentQuarter() });
  return { snapshot: id };
}

async function runAll() {
  const out = {};
  await safe('quotations', quotationExpiry, out); await safe('opportunities', opportunityAlerts, out); await safe('deal_registrations', dealRegExpiry, out);
  await safe('contracts', contractLifecycle, out); await safe('tasks', taskEscalation, out); await safe('lead_sla', leadSla, out); await safe('approval_sla', approvalSla, out);
  await safe('integrations', integrationWorker, out); await safe('housekeeping', housekeeping, out); await safe('forecast_snapshot', weeklySnapshot, out);
  return out;
}
let timer = null;
function start() {
  if (process.env.DISABLE_JOBS === '1' || timer) return;
  setTimeout(() => runAll().catch((e) => console.error(e)), 15000);
  timer = setInterval(() => runAll().catch((e) => console.error(e)), 30 * 60 * 1000);
  timer.unref();
}
module.exports = { start, runAll };
