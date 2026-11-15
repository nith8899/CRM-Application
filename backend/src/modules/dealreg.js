'use strict';
// M09 - Vendor deal registration: eligibility, conflict detection, protection tracking (BRULE-DREG-001..008).
const express = require('express');
const db = require('../db');
const A = require('../core/access');
const hooks = require('../core/hooks');
const fx = require('../core/fx');
const { audit } = require('../core/audit');
const { notify, notifyRole } = require('../core/notify');
const { bad, forbidden, notFound, wrap } = require('../core/errors');
const { entities } = require('../entities');
const crud = require('../core/crud');
const approvals = require('./approvals');

const router = express.Router();
const ACTIVE_STATES = ['Submitted internally', 'Under internal review', 'Approved for submission', 'Submitted to vendor', 'Vendor approved', 'Extension requested'];
const CPM = ['ROL-CPM', 'ROL-SOP', 'ROL-ADM'];

hooks.register('deal_registrations', {
  async validate(ctx, v, existing) {
    const errs = [];
    const { rows: ve } = await db.query('SELECT * FROM vendors WHERE id=$1 AND is_deleted=false', [v.vendor_id]);
    const vendor = ve[0];
    if (!vendor) return [{ field: 'vendor_id', message: 'Vendor not found' }];
    if (vendor.status !== 'Active') errs.push({ field: 'vendor_id', message: 'Vendor is not active' });
    if (v.partner_id) {
      const { rows } = await db.query('SELECT status, authorised_vendors FROM partners WHERE id=$1 AND is_deleted=false', [v.partner_id]);
      const p = rows[0];
      if (!p || p.status !== 'Active') { if (!(v.override_partner_reason && A.roleHas(ctx, ...CPM))) errs.push({ field: 'partner_id', message: 'Registering partner must be Active (BRULE-DREG-002)' }); }
      else if (Array.isArray(p.authorised_vendors) && p.authorised_vendors.length && !p.authorised_vendors.map(Number).includes(Number(v.vendor_id))) errs.push({ field: 'partner_id', message: 'Partner is not authorised for this vendor (BRULE-DREG-002)' });
    }
    if (vendor.min_deal_value) {
      const val = await fx.toBase(v.deal_value, v.currency);
      const min = await fx.toBase(vendor.min_deal_value, vendor.currency);
      if (val < min) errs.push({ field: 'deal_value', message: `Deal value is below the vendor minimum of ${vendor.min_deal_value} ${vendor.currency} (BRULE-DREG-003)` });
    }
    return errs;
  },
  async beforeCreate(ctx, v, c) {
    const { rows } = await c.query('SELECT policy_version, reg_exclusive FROM vendors WHERE id=$1', [v.vendor_id]);
    v.policy_version = rows[0].policy_version; v.exclusive = rows[0].reg_exclusive;   // BRULE-DREG-001 / -008
    v.status = 'Draft';
  },
  async afterCreate(ctx, d, c) { await detectConflicts(d, c); },
  async decorateOne(o, ctx) {
    if (ctx.isExternal) { delete o.conflict_decision; o.conflict_status = o.conflict_status === 'None' ? 'None' : 'Under review'; }   // BRULE-DREG-005
    return o;
  },
});

async function detectConflicts(d, c) {
  const { rows } = await c.query(
    `SELECT id FROM deal_registrations WHERE vendor_id=$1 AND account_id=$2 AND id<>$3 AND is_deleted=false AND status = ANY($4) AND (protection_end IS NULL OR protection_end >= current_date)`,
    [d.vendor_id, d.account_id, d.id, ACTIVE_STATES]);
  if (rows.length) {
    await c.query(`UPDATE deal_registrations SET conflict_status='Open' WHERE id = ANY($1)`, [[d.id, ...rows.map((r) => r.id)]]);
    d.conflict_status = 'Open';
    await notifyRole('ROL-CPM', { type: 'dreg_conflict', title: 'Deal registration conflict detected', body: `${rows.length + 1} competing registrations for the same customer and vendor`, entity: 'deal_registrations', recordId: d.id }, c);
  }
  return rows.length;
}

approvals.registerHandler('deal_registration', {
  async onApproved(ctx, req, info, c) {
    const { rows } = await c.query('SELECT conflict_status FROM deal_registrations WHERE id=$1', [req.record_id]);
    if (rows[0] && rows[0].conflict_status === 'Open') throw bad('An open conflict case must be decided before approval for vendor submission (BRULE-DREG-004)');
    await c.query(`UPDATE deal_registrations SET status='Approved for submission' WHERE id=$1`, [req.record_id]);
  },
  async onRejected(ctx, req, info, c) { await c.query(`UPDATE deal_registrations SET status='Returned', vendor_decision_notes=$2 WHERE id=$1`, [req.record_id, info.reason]); },
  async onReturned(ctx, req, info, c) { await c.query(`UPDATE deal_registrations SET status='Returned', vendor_decision_notes=$2 WHERE id=$1`, [req.record_id, info.comment]); },
  async onWithdrawn(ctx, req, info, c) { await c.query(`UPDATE deal_registrations SET status='Draft' WHERE id=$1`, [req.record_id]); },
});

entities.deal_registrations.actions = {
  submit_internal: { label: 'Submit for internal review', perm: 'S', async run(ctx, d) {
    if (!['Draft', 'Returned'].includes(d.status)) throw bad('Only draft or returned registrations can be submitted');
    return db.tx(async (c) => {
      const amountBase = await fx.toBase(d.deal_value, d.currency, null, c);
      const r = await approvals.submit(ctx, { type: 'deal_registration', entity: 'deal_registrations', recordId: d.id, label: d.number, amount: d.deal_value, currency: d.currency, snapshot: { amount_base: amountBase, conflict: d.conflict_status === 'Open' } }, c);
      if (!r.required) await c.query(`UPDATE deal_registrations SET status='Approved for submission' WHERE id=$1`, [d.id]);
      else await c.query(`UPDATE deal_registrations SET status='Under internal review', approval_request_id=$2 WHERE id=$1`, [d.id, r.request.id]);
      return { approval: r.required ? r.request.number : 'auto-approved' };
    });
  } },
  decide_conflict: { label: 'Decide conflict', perm: 'A', async run(ctx, d, b) {
    if (!A.roleHas(ctx, ...CPM)) throw forbidden('Only Channel Partner Managers decide conflicts');
    if (d.conflict_status !== 'Open') throw bad('No open conflict on this registration');
    if (!b.winner_id || !b.rationale) throw bad('Select the winning registration and give a rationale');
    const { rows } = await db.query(`SELECT id FROM deal_registrations WHERE vendor_id=$1 AND account_id=$2 AND conflict_status='Open' AND is_deleted=false`, [d.vendor_id, d.account_id]);
    const ids = rows.map((r) => r.id);
    if (!ids.includes(Number(b.winner_id))) throw bad('Winner must be one of the competing registrations');
    await db.tx(async (c) => {
      for (const id of ids) {
        if (id === Number(b.winner_id)) await c.query(`UPDATE deal_registrations SET conflict_status='Decided', conflict_decision=$2 WHERE id=$1`, [id, `Selected. ${b.rationale}`]);
        else await c.query(`UPDATE deal_registrations SET conflict_status='Decided', status='Cancelled', conflict_decision=$2 WHERE id=$1`, [id, `Not selected. ${b.rationale}`]);
      }
      await audit(ctx, { event: 'dreg_conflict_decided', entity: 'deal_registrations', recordId: d.id, label: d.number, detail: `winner ${b.winner_id}: ${b.rationale}` }, c);
    });
  } },
  submit_to_vendor: { label: 'Mark submitted to vendor', perm: 'S', async run(ctx, d) {
    if (d.status !== 'Approved for submission') throw bad('Registration must be approved for submission first');
    await db.tx(async (c) => {
      await c.query(`UPDATE deal_registrations SET status='Submitted to vendor' WHERE id=$1`, [d.id]);
      await c.query(`INSERT INTO integration_logs (integration_code, direction, entity, record_id, status, attempts, idempotency_key, payload) VALUES ('INT-07','Outbound','deal_registrations',$1,'Pending',0,$2,$3) ON CONFLICT (idempotency_key) DO NOTHING`, [d.id, `INT-07-dr-${d.id}`, JSON.stringify({ number: d.number })]);
      await audit(ctx, { event: 'dreg_submitted_vendor', entity: 'deal_registrations', recordId: d.id, label: d.number }, c);
    });
  } },
  record_vendor_decision: { label: 'Record vendor decision', perm: 'A', async run(ctx, d, b) {
    if (!A.roleHas(ctx, ...CPM)) throw forbidden();
    if (!['Submitted to vendor', 'Extension requested'].includes(d.status)) throw bad('Registration has not been submitted to the vendor');
    if (b.approved) {
      if (!b.vendor_ref || !b.protection_start || !b.protection_end) throw bad('Vendor reference and protection dates are required');
      if (b.protection_end < b.protection_start) throw bad('Protection expiry cannot be before start (BRULE-DREG-006)');
      await db.query(`UPDATE deal_registrations SET status='Vendor approved', vendor_ref=$2, protection_start=$3, protection_end=$4, vendor_decision_notes=$5 WHERE id=$1`, [d.id, b.vendor_ref, b.protection_start, b.protection_end, b.notes || null]);
    } else {
      if (!b.notes) throw bad('Reason required');
      await db.query(`UPDATE deal_registrations SET status='Vendor rejected', vendor_decision_notes=$2 WHERE id=$1`, [d.id, b.notes]);
    }
    await audit(ctx, { event: 'dreg_vendor_decision', entity: 'deal_registrations', recordId: d.id, label: d.number, detail: b.approved ? `approved ${b.protection_start}..${b.protection_end}` : `rejected: ${b.notes}` });
    await notify(d.owner_id, { type: 'dreg', title: `Deal registration ${d.number}: ${b.approved ? 'vendor approved' : 'vendor rejected'}`, entity: 'deal_registrations', recordId: d.id });
  } },
  extend: { label: 'Extend protection', perm: 'S', async run(ctx, d, b) {
    if (d.status !== 'Vendor approved') throw bad('Only vendor-approved registrations can be extended');
    const { rows } = await db.query('SELECT reg_max_renewals FROM vendors WHERE id=$1', [d.vendor_id]);
    if (d.renewal_count >= rows[0].reg_max_renewals && !(b.exception_reason && A.roleHas(ctx, 'ROL-CPM', 'ROL-ADM'))) throw bad(`Maximum renewals (${rows[0].reg_max_renewals}) reached (BRULE-DREG-007). A Channel Partner Manager may record a documented vendor exception.`);
    if (!b.new_end || b.new_end <= d.protection_end) throw bad('New expiry must be later than the current expiry');
    await db.query(`UPDATE deal_registrations SET protection_end=$2, renewal_count=renewal_count+1 WHERE id=$1`, [d.id, b.new_end]);
    await audit(ctx, { event: 'dreg_extended', entity: 'deal_registrations', recordId: d.id, label: d.number, changes: { protection_end: [d.protection_end, b.new_end] }, detail: b.exception_reason });
  } },
  cancel: { label: 'Cancel', perm: 'E', prompt: 'reason', async run(ctx, d, b) { if (!b.reason) throw bad('Reason required'); await db.query(`UPDATE deal_registrations SET status='Cancelled' WHERE id=$1`, [d.id]); await audit(ctx, { event: 'dreg_cancelled', entity: 'deal_registrations', recordId: d.id, label: d.number, detail: b.reason }); } },
};

router.get('/e/deal_registrations/:id/conflicts', wrap(async (req, res) => {
  if (req.ctx.isExternal) throw forbidden();
  const d = await crud.loadOne(entities.deal_registrations, req.params.id, req.ctx);
  if (!d) throw notFound();
  const { rows } = await db.query(`SELECT r.id, r.number, r.status, r.deal_value, r.currency, r.protection_end, p.name AS partner_name, o.name AS owner_name FROM deal_registrations r LEFT JOIN partners p ON p.id=r.partner_id JOIN users o ON o.id=r.owner_id WHERE r.vendor_id=$1 AND r.account_id=$2 AND r.is_deleted=false AND (r.conflict_status IN ('Open','Decided')) ORDER BY r.id`, [d.vendor_id, d.account_id]);
  res.json(rows);
}));

module.exports = { router };
