'use strict';
// M08 - Opportunity & pipeline governance (BRD §11, BRULE-OPP-001..017).
const express = require('express');
const db = require('../db');
const A = require('../core/access');
const hooks = require('../core/hooks');
const settings = require('../core/settings');
const fx = require('../core/fx');
const { audit } = require('../core/audit');
const { notify, notifyRole } = require('../core/notify');
const { nextNumber } = require('../core/numbering');
const { bad, forbidden, wrap } = require('../core/errors');
const { entities } = require('../entities');
const crud = require('../core/crud');

const router = express.Router();
const MANAGER_ROLES = ['ROL-SM', 'ROL-CM', 'ROL-SD', 'ROL-ADM'];

let stageCache = { at: 0, list: [] };
async function stages(pipeline = 'Standard') {
  if (Date.now() - stageCache.at > 20000) {
    const { rows } = await db.query('SELECT * FROM stage_definitions WHERE is_deleted=false ORDER BY sort_order');
    stageCache = { at: Date.now(), list: rows };
  }
  return stageCache.list.filter((s) => s.pipeline === pipeline);
}
const clearStages = () => { stageCache.at = 0; };
const stageOf = async (code) => (await stages()).find((s) => s.code === code);

const RANK = {
  budget: ['Unknown', 'None', 'Indicated', 'Confirmed'],
  authority: ['Unknown', 'User', 'Influencer', 'Decision maker', 'Economic buyer'],
  fit: ['Unknown', 'None', 'Partial', 'Full'],
};
const atLeast = (list, v, min) => list.indexOf(v) >= list.indexOf(min);

/** Exit-criteria checklist for a stage (BRULE-OPP-006). Returns an array of unmet criteria. */
async function exitChecklist(opp, stageCode) {
  const miss = [];
  const need = (cond, msg) => { if (!cond) miss.push(msg); };
  const cnt = async (sql, p) => (await db.query(sql, p)).rows[0].n;
  switch (stageCode) {
    case 'S01':
      need(opp.account_id, 'Account'); need(opp.source, 'Source'); need(opp.amount > 0, 'Estimated amount'); need(opp.close_date, 'Expected close date'); need(opp.bu_id, 'Business unit');
      if (opp.route === 'Indirect') need(opp.primary_partner_id, 'Primary fulfilment partner (indirect route)');
      break;
    case 'S02':
      need(opp.opp_type, 'Opportunity type'); need(opp.procurement_method, 'Procurement method');
      need(atLeast(RANK.budget, opp.budget_status, 'Indicated'), 'Budget at least "Indicated"');
      need(atLeast(RANK.authority, opp.authority, 'Influencer'), 'Authority at least "Influencer"');
      need(opp.need_status && opp.need_status !== 'Unclear', 'Need defined');
      need(opp.timeline_months != null && opp.timeline_months <= 12, 'Timeline within 12 months');
      need(atLeast(RANK.fit, opp.technical_fit, 'Partial'), 'Technical fit at least "Partial"');
      break;
    case 'S03':
      need(opp.business_need, 'Business need documented'); need(opp.decision_date, 'Decision date');
      need(await cnt(`SELECT count(*)::int n FROM opportunity_contacts WHERE opportunity_id=$1 AND buying_role IN ('Decision maker','Economic buyer') AND is_deleted=false`, [opp.id]), 'At least one decision maker / economic buyer stakeholder');
      need(await cnt('SELECT count(*)::int n FROM opportunity_competitors WHERE opportunity_id=$1 AND is_deleted=false', [opp.id]), 'Competitors recorded (add "None known" if applicable)');
      break;
    case 'S04':
      need(await cnt('SELECT count(*)::int n FROM opportunity_partners WHERE opportunity_id=$1 AND vendor_id IS NOT NULL AND is_deleted=false', [opp.id]), 'Vendors involved (add a vendor under Partners)');
      need(await cnt('SELECT count(*)::int n FROM tech_requirements WHERE opportunity_id=$1 AND is_deleted=false', [opp.id]), 'Technical requirement record');
      need(await cnt('SELECT count(*)::int n FROM solution_configs WHERE opportunity_id=$1 AND is_deleted=false', [opp.id]), 'At least one solution configuration drafted');
      break;
    case 'S05':
      need(await cnt(`SELECT count(*)::int n FROM solution_configs WHERE opportunity_id=$1 AND status IN ('Validated','Vendor validated') AND is_deleted=false`, [opp.id]), 'A validated configuration (BRULE-SIZ-004)');
      break;
    case 'S06': {
      const need_dr = opp.route === 'Indirect' && (await settings.get('require_deal_reg_indirect', true));
      if (need_dr) need(await cnt(`SELECT count(*)::int n FROM deal_registrations WHERE opportunity_id=$1 AND status IN ('Approved for submission','Submitted to vendor','Vendor approved') AND is_deleted=false`, [opp.id]), 'Deal registration approved/submitted (indirect route)');
      break;
    }
    case 'S07':
      need(await cnt(`SELECT count(*)::int n FROM quotation_versions v JOIN quotations q ON q.id=v.quotation_id WHERE q.opportunity_id=$1 AND v.status IN ('Approved','Sent','Accepted') AND q.is_deleted=false`, [opp.id]), 'An approved quotation version');
      break;
    case 'S08':
      need(await cnt(`SELECT count(*)::int n FROM quotation_versions v JOIN quotations q ON q.id=v.quotation_id WHERE q.opportunity_id=$1 AND v.status IN ('Sent','Accepted') AND q.is_deleted=false`, [opp.id]), 'A quotation sent to the customer/partner');
      if (opp.procurement_method === 'Tender / RFP') { need(opp.tender_ref, 'Tender reference'); need(opp.tender_deadline, 'Tender deadline'); }
      break;
    case 'S09': need(opp.next_step, 'Negotiation notes / next step'); break;
    case 'S10': need(opp.expected_po_date, 'Expected PO date'); break;
    default: break;
  }
  return miss;
}

// --------------------------------------------------------------------- risk
async function riskFlags(opp) {
  const flags = [];
  if (opp.status !== 'Open') return flags;
  const st = await stageOf(opp.stage);
  const today = new Date().toISOString().slice(0, 10);
  if (opp.close_date && opp.close_date < today) flags.push({ code: 'overdue_close', label: 'Expected close date has passed', severity: 'high' });
  if (opp.close_date_changes >= 3) flags.push({ code: 'slippage', label: `Close date changed ${opp.close_date_changes} times`, severity: 'medium' });
  const days = opp.last_activity_at ? (Date.now() - new Date(opp.last_activity_at).getTime()) / 86400000 : (Date.now() - new Date(opp.created_at).getTime()) / 86400000;
  const snoozed = opp.stalled_snooze_until && new Date(opp.stalled_snooze_until) > new Date();
  if (st && st.inactivity_days && days > st.inactivity_days && !snoozed) flags.push({ code: 'stalled', label: `No activity for ${Math.floor(days)} days`, severity: 'medium' });
  if (opp.timeline_months > 12) flags.push({ code: 'long_timeline', label: 'Timeline longer than 12 months', severity: 'low' });
  if (opp.budget_status === 'Unknown' && st && st.sort_order >= 2) flags.push({ code: 'unknown_budget', label: 'Budget unknown', severity: 'low' });
  if (opp.status === 'Open' && opp.stage && st && st.sort_order >= 3 && opp._noDecisionMaker) flags.push({ code: 'no_decision_maker', label: 'No decision maker identified', severity: 'medium' });
  return flags;
}

// ---------------------------------------------------------------------- hooks
hooks.register('opportunities', {
  async validate(ctx, v, existing) {
    const errs = [];
    const isOpen = !existing || existing.status === 'Open' || existing.status === 'On hold';
    if (v.route === 'Indirect' && !v.primary_partner_id)
      errs.push({ field: 'primary_partner_id', message: 'Indirect opportunities require a primary fulfilment partner (BRULE-OPP-003)' });
    const today = new Date().toISOString().slice(0, 10);
    if (isOpen && v.close_date && v.close_date < today && (!existing || v.close_date !== existing.close_date))
      errs.push({ field: 'close_date', message: 'Expected close date cannot be in the past (BRULE-OPP-004)' });
    if (v.amount != null && Number(v.amount) < 0) errs.push({ field: 'amount', message: 'Amount cannot be negative' });
    if (v.account_id) {
      const { rows } = await db.query('SELECT status FROM accounts WHERE id=$1 AND is_deleted=false', [v.account_id]);
      if (!rows[0]) errs.push({ field: 'account_id', message: 'Account not found' });
    }
    if (existing && existing.primary_quotation_id && v.amount != null && Number(v.amount) !== Number(existing.amount) && !A.roleHas(ctx, ...MANAGER_ROLES, 'ROL-SOP')) {
      const { rows } = await db.query(`SELECT 1 FROM quotation_versions WHERE quotation_id=$1 AND status IN ('Approved','Sent','Accepted') LIMIT 1`, [existing.primary_quotation_id]);
      if (rows.length) errs.push({ field: 'amount', message: 'Amount is synchronised from the approved primary quotation (BRULE-OPP-008)' });
    }
    return errs;
  },
  async beforeCreate(ctx, v, c) {
    const st0 = (await stages())[0];
    v.stage = st0.code; v.probability = st0.probability; v.forecast_category = v.forecast_category || st0.forecast_category || 'Pipeline';
    v.status = 'Open'; v.stage_entered_at = new Date().toISOString(); v.last_activity_at = new Date().toISOString(); v.close_date_changes = 0;
    if (!v.country) { const { rows } = await c.query('SELECT country FROM accounts WHERE id=$1', [v.account_id]); v.country = rows[0] && rows[0].country; }
    v.amount_base = await fx.toBase(v.amount, v.currency, null, c);
    if (v.cost != null) v.gross_profit = fx.round2(v.amount_base - await fx.toBase(v.cost, v.currency, null, c));
  },
  async afterCreate(ctx, rec, c) {
    await c.query('INSERT INTO opportunity_stage_history (opportunity_id, from_stage, to_stage, changed_by, amount, probability) VALUES ($1,NULL,$2,$3,$4,$5)', [rec.id, rec.stage, ctx.id, rec.amount_base, rec.probability]);
  },
  async beforeUpdate(ctx, v, existing, c) {
    if (v.amount != null || v.currency || v.cost != null) {
      const amount = v.amount != null ? v.amount : existing.amount; const ccy = v.currency || existing.currency;
      v.amount_base = await fx.toBase(amount, ccy, null, c);
      const cost = v.cost != null ? v.cost : existing.cost;
      if (cost != null) v.gross_profit = fx.round2(v.amount_base - await fx.toBase(cost, ccy, null, c));
    }
    if (v.close_date && existing.close_date && v.close_date !== existing.close_date) {
      v.close_date_changes = (existing.close_date_changes || 0) + 1;
      // pushing a Commit deal out of the current quarter requires a comment (BRULE-OPP-010 configurable)
      const q = (d) => `${d.slice(0, 4)}-${Math.floor((parseInt(d.slice(5, 7), 10) - 1) / 3)}`;
      if (existing.forecast_category === 'Commit' && v.close_date > existing.close_date && q(v.close_date) !== q(existing.close_date) && !v.next_step)
        throw bad('Moving a Commit deal out of the current quarter requires a comment in "Next step" (BRULE-OPP-010)');
    }
  },
  async decorateList(rows) {
    for (const r of rows) { r.risk_flags = await riskFlags({ ...r, last_activity_at: r.last_activity_at }); r.weighted_amount = Math.round((r.amount_base || 0) * (r.probability || 0)) / 100; }
  },
  async decorateOne(o, ctx) {
    const raw = { ...o };
    const { rows: dm } = await db.query(`SELECT count(*)::int n FROM opportunity_contacts WHERE opportunity_id=$1 AND buying_role IN ('Decision maker','Economic buyer') AND is_deleted=false`, [o.id]);
    raw._noDecisionMaker = dm[0].n === 0;
    o.risk_flags = await riskFlags(raw);
    o.weighted_amount = Math.round((o.amount_base || 0) * (o.probability || 0)) / 100;
    const sts = await stages();
    const cur = sts.find((s) => s.code === o.stage);
    o._stages = sts.map((s) => ({ code: s.code, name: s.name, probability: s.probability, sort_order: s.sort_order }));
    o._next = cur ? (cur.next_stages || []) : [];
    o._stage_checklist = o.status === 'Open' && cur ? await exitChecklist(o, cur.code) : [];
    const { rows: h } = await db.query(`SELECT h.*, u.name AS changed_by_name FROM opportunity_stage_history h LEFT JOIN users u ON u.id=h.changed_by WHERE h.opportunity_id=$1 ORDER BY h.changed_at DESC`, [o.id]);
    o._history = h;
    o._is_manager = A.roleHas(ctx, ...MANAGER_ROLES);
    return o;
  },
});

// -------------------------------------------------------------- stage actions
async function cancelOpenQuotations(ctx, oppId, reason, c) {
  const approvals = require('./approvals');
  const { rows } = await c.query(`SELECT v.id, v.quotation_id FROM quotation_versions v JOIN quotations q ON q.id=v.quotation_id WHERE q.opportunity_id=$1 AND v.status NOT IN ('Accepted','Cancelled','Superseded','Rejected','Expired')`, [oppId]);
  for (const v of rows) {
    await approvals.invalidateFor('quotation_versions', v.id, 'Opportunity closed', c);
    await c.query(`UPDATE quotation_versions SET status='Cancelled', cancel_reason=$2 WHERE id=$1`, [v.id, reason]);
    await c.query(`UPDATE quotations SET status='Cancelled' WHERE id=$1`, [v.quotation_id]);
  }
}

async function applyStage(ctx, o, to, extra, c, { override = false, reason } = {}) {
  const now = new Date();
  const days = o.stage_entered_at ? Math.round((now - new Date(o.stage_entered_at)) / 86400000) : 0;
  const cat = o.forecast_category;
  const patch = { stage: to.code, probability: to.probability, prob_overridden: false, stage_entered_at: now.toISOString(), forecast_category: to.forecast_category || cat, ...extra };
  // keep manual Commit/Best-case choice during late stages
  if (['S07', 'S08', 'S09', 'S10'].includes(to.code) && ['Best case', 'Commit'].includes(cat)) patch.forecast_category = cat;
  const keys = Object.keys(patch);
  await c.query(`UPDATE opportunities SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(', ')}, modified_by=$${keys.length + 1}, modified_at=now(), version=version+1 WHERE id=$${keys.length + 2}`,
    [...keys.map((k) => patch[k]), ctx.id, o.id]);
  await c.query('INSERT INTO opportunity_stage_history (opportunity_id, from_stage, to_stage, changed_by, reason, days_in_stage, amount, probability, override) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [o.id, o.stage, to.code, ctx.id, reason || null, days, patch.amount_base != null ? patch.amount_base : o.amount_base, to.probability, override]);
  await audit(ctx, { event: 'stage_change', entity: 'opportunities', recordId: o.id, label: o.name, changes: { stage: [o.stage, to.code] }, detail: reason }, c);
}

entities.opportunities.actions = {
  change_stage: {
    label: 'Change stage', perm: 'E',
    async run(ctx, o, b) {
      const sts = await stages();
      const to = sts.find((s) => s.code === b.to);
      if (!to) throw bad('Unknown target stage');
      if (['Won', 'Lost', 'Cancelled'].includes(o.status)) throw forbidden('Opportunity is closed. Use Reopen (BRULE-OPP-014).');
      if (o.status === 'On hold') throw bad('Opportunity is on hold. Resume it first.');
      const cur = sts.find((s) => s.code === o.stage);
      const isManager = A.roleHas(ctx, ...MANAGER_ROLES);
      const backwards = to.sort_order < cur.sort_order;
      const permitted = (cur.next_stages || []).includes(to.code);
      let overridden = false;
      if (!permitted) {
        if (backwards && isManager) { if (!b.reason) throw bad('A reason is required when a manager moves an opportunity backwards (BRULE-OPP-005)'); overridden = true; }
        else throw bad(`Stage transition ${cur.name} → ${to.name} is not permitted (BRULE-OPP-005). Allowed: ${(cur.next_stages || []).join(', ') || 'none'}`);
      }
      return db.tx(async (c) => {
        const extra = {};
        // ---- closure rules
        if (to.code === 'S11') {
          const miss = [];
          const { rows: acc } = await c.query(`SELECT v.id, v.grand_total, v.currency, v.fx_to_base, v.total_cost, v.gross_profit FROM quotation_versions v JOIN quotations q ON q.id=v.quotation_id WHERE q.opportunity_id=$1 AND v.status='Accepted' AND q.is_deleted=false ORDER BY v.accepted_at DESC LIMIT 1`, [o.id]);
          const noQuoteTypes = await settings.get('no_quotation_types', ['Services']);
          const exception = b.no_quotation_exception && (isManager) && noQuoteTypes.includes(o.opp_type);
          if (!acc[0] && !exception) miss.push('An accepted quotation version (BRULE-OPP-012). Services deals may use the no-quotation exception with manager approval.');
          if (!b.po_number && !acc[0]?.po_reference && !exception) miss.push('Customer PO / contract reference');
          if (!o.close_date) miss.push('Close date');
          if (miss.length) throw bad('Cannot close as Won', { checklist: miss });
          if (acc[0]) {
            extra.accepted_version_id = acc[0].id;
            // order value synchronises to the accepted quotation (BRULE-OPP-008) - amount stored in quotation currency
            extra.amount = acc[0].grand_total; extra.currency = acc[0].currency;
            extra.amount_base = await fx.toBase(acc[0].grand_total, acc[0].currency, null, c);
          }
          extra.po_number = b.po_number || (acc[0] && (await c.query('SELECT po_reference FROM quotation_versions WHERE id=$1', [acc[0].id])).rows[0].po_reference) || null;
          extra.po_date = b.po_date || new Date().toISOString().slice(0, 10);
          extra.status = 'Won'; extra.closed_at = new Date().toISOString(); extra.forecast_category = 'Closed'; extra.lessons_learned = b.lessons_learned || null;
        } else if (to.code === 'S12') {
          if (!b.loss_reason) throw bad('A loss reason is required (BRULE-OPP-013)');
          if (b.loss_reason === 'Competitor' && !b.loss_competitor) throw bad('Competitor name is required when the reason is "Competitor"');
          Object.assign(extra, { status: 'Lost', closed_at: new Date().toISOString(), loss_reason: b.loss_reason, loss_competitor: b.loss_competitor || null, lessons_learned: b.lessons_learned || null, forecast_category: 'Omitted' });
        } else if (to.code === 'S13') {
          if (!b.hold_reason || !b.review_date) throw bad('Hold reason and review date are required (BRULE-OPP-016)');
          const max = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
          if (b.review_date > max || b.review_date < new Date().toISOString().slice(0, 10)) throw bad('Review date must be within the next 90 days (BRULE-OPP-016)');
          Object.assign(extra, { status: 'On hold', hold_reason: b.hold_reason, review_date: b.review_date, previous_stage: o.stage, forecast_category: 'Omitted' });
        } else if (!overridden) {
          // ---- exit criteria of the stage being left apply to forward movement
          if (to.sort_order > cur.sort_order) {
            let miss = await exitChecklist(o, cur.code);
            if (miss.length && b.override && isManager) { if (!b.reason) throw bad('A reason is required to override stage criteria'); overridden = true; miss = []; }
            if (miss.length) throw bad(`Stage criteria not met to leave "${cur.name}" (BRULE-OPP-006)`, { checklist: miss, can_override: isManager });
          }
        }
        // forward moves that skip stages must still satisfy each skipped stage's criteria
        if (!overridden && !['S11', 'S12', 'S13'].includes(to.code) && to.sort_order > cur.sort_order + 1) {
          for (const s of sts.filter((x) => x.sort_order > cur.sort_order && x.sort_order < to.sort_order)) {
            const miss = await exitChecklist(o, s.code);
            if (miss.length) throw bad(`Criteria for "${s.name}" not met`, { checklist: miss });
          }
        }
        await applyStage(ctx, o, to, extra, c, { override: overridden, reason: b.reason || b.loss_reason || b.hold_reason });

        if (to.code === 'S11') {
          // WF11: handover package to ERP (INT-04), order task, account becomes Customer, notify
          await c.query(`UPDATE accounts SET account_type='Customer' WHERE id=$1 AND account_type<>'Customer'`, [o.account_id]);
          await c.query(`INSERT INTO integration_logs (integration_code, direction, entity, record_id, status, attempts, idempotency_key, payload) VALUES ('INT-04','Outbound','opportunities',$1,'Pending',0,$2,$3) ON CONFLICT (idempotency_key) DO NOTHING`,
            [o.id, `INT-04-opp-${o.id}-won`, JSON.stringify({ opportunity: o.number, account_id: o.account_id, amount: extra.amount ?? o.amount, currency: extra.currency ?? o.currency, po: extra.po_number })]);
          const tnum = await nextNumber('TSK', c);
          await c.query(`INSERT INTO tasks (number, owner_id, subject, description, priority, due_at, category, opportunity_id, related_entity, related_id, related_label, auto_generated, created_by, modified_by)
            VALUES ($1,$2,$3,$4,'High', now() + interval '2 days', 'Admin', $5, 'opportunities', $5, $6, true, $7, $7)`,
            [tnum, o.owner_id, `Order handover: ${o.name}`, 'Prepare handover package: accepted quotation, PO, delivery contacts and terms.', o.id, o.number, ctx.id]);
          await notifyRole('ROL-SOP', { type: 'order_handover', title: `Closed Won: ${o.name}`, body: `${o.number} - handover to ERP queued`, entity: 'opportunities', recordId: o.id }, c);
          await notify(o.owner_id, { type: 'closed_won', title: `Congratulations - ${o.name} closed won`, entity: 'opportunities', recordId: o.id }, c);
        }
        if (['S11'].includes(to.code) === false && ['S12'].includes(to.code)) await cancelOpenQuotations(ctx, o.id, 'Opportunity lost', c);
        return { ok: true, stage: to.code };
      });
    },
  },
  resume: {
    label: 'Resume from hold', perm: 'E',
    async run(ctx, o) {
      if (o.status !== 'On hold') throw bad('Opportunity is not on hold');
      const to = await stageOf(o.previous_stage || 'S01');
      await db.tx(async (c) => {
        await c.query(`UPDATE opportunities SET status='Open', hold_reason=NULL, review_date=NULL, stage=$2, probability=$3, forecast_category=$4, stage_entered_at=now(), modified_by=$5, modified_at=now(), version=version+1 WHERE id=$1`,
          [o.id, to.code, to.probability, to.forecast_category, ctx.id]);
        await c.query('INSERT INTO opportunity_stage_history (opportunity_id, from_stage, to_stage, changed_by, reason, probability) VALUES ($1,$2,$3,$4,$5,$6)', [o.id, 'S13', to.code, ctx.id, 'Resumed from hold', to.probability]);
        await audit(ctx, { event: 'resume', entity: 'opportunities', recordId: o.id, label: o.name }, c);
      });
    },
  },
  cancel: {
    label: 'Cancel opportunity', perm: 'E', prompt: 'reason',
    async run(ctx, o, b) {
      if (!b.reason) throw bad('A cancellation reason is required (BRULE-OPP-013)');
      if (['Won', 'Lost', 'Cancelled'].includes(o.status)) throw bad('Opportunity is already closed');
      const thr = await settings.get('cancel_approval_threshold', 100000);
      if ((o.amount_base || 0) > thr && !A.roleHas(ctx, ...MANAGER_ROLES)) throw forbidden('Cancelling an opportunity above the threshold needs Sales Manager approval');
      await db.tx(async (c) => {
        await c.query(`UPDATE opportunities SET status='Cancelled', cancel_reason=$2, probability=0, forecast_category='Omitted', closed_at=now(), modified_by=$3, modified_at=now(), version=version+1 WHERE id=$1`, [o.id, b.reason, ctx.id]);
        await c.query('INSERT INTO opportunity_stage_history (opportunity_id, from_stage, to_stage, changed_by, reason, probability) VALUES ($1,$2,$2,$3,$4,0)', [o.id, o.stage, ctx.id, `Cancelled: ${b.reason}`]);
        await cancelOpenQuotations(ctx, o.id, 'Opportunity cancelled', c);
        await audit(ctx, { event: 'cancel', entity: 'opportunities', recordId: o.id, label: o.name, detail: b.reason }, c);
      });
    },
  },
  reopen: {
    label: 'Reopen', perm: 'E', prompt: 'reason',
    async run(ctx, o, b) {
      if (!['Won', 'Lost', 'Cancelled'].includes(o.status)) throw bad('Opportunity is not closed');
      if (!b.reason) throw bad('A reopen reason is required');
      const win = await settings.get('reopen_window_days', 90);
      const days = (Date.now() - new Date(o.closed_at || o.modified_at).getTime()) / 86400000;
      if (!A.roleHas(ctx, 'ROL-SM', 'ROL-CM', 'ROL-SD', 'ROL-ADM')) throw forbidden('Reopening requires Sales Manager approval (BRULE-OPP-015)');
      if (days > win && !A.roleHas(ctx, 'ROL-CM', 'ROL-SD', 'ROL-ADM')) throw forbidden(`Closed more than ${win} days ago - Country Manager approval required (BRULE-OPP-015)`);
      const to = await stageOf(b.to || 'S09');
      await db.tx(async (c) => {
        await c.query(`UPDATE opportunities SET status='Open', stage=$2, probability=$3, forecast_category=$4, stage_entered_at=now(), closed_at=NULL, loss_reason=NULL, loss_competitor=NULL, cancel_reason=NULL, reopen_count=reopen_count+1, modified_by=$5, modified_at=now(), version=version+1 WHERE id=$1`,
          [o.id, to.code, to.probability, to.forecast_category, ctx.id]);
        await c.query('INSERT INTO opportunity_stage_history (opportunity_id, from_stage, to_stage, changed_by, reason, probability, override) VALUES ($1,$2,$3,$4,$5,$6,true)', [o.id, o.stage, to.code, ctx.id, `Reopened: ${b.reason}`, to.probability]);
        await audit(ctx, { event: 'reopen', entity: 'opportunities', recordId: o.id, label: o.name, detail: b.reason }, c);
      });
    },
  },
  set_probability: {
    label: 'Override probability', perm: 'E',
    async run(ctx, o, b) {
      const p = Number(b.probability);
      if (!(p >= 0 && p <= 100)) throw bad('Probability must be between 0 and 100');
      const st = await stageOf(o.stage);
      const range = await settings.get('probability_override_range', 15);
      const isManager = A.roleHas(ctx, ...MANAGER_ROLES);
      if (Math.abs(p - st.probability) > range) {
        if (!isManager) throw forbidden(`Owners may override the stage default (${st.probability}%) by at most ±${range} points (BRULE-OPP-007)`);
        if (!b.reason) throw bad('A reason is required to set a probability outside the allowed range');
      }
      await db.query(`UPDATE opportunities SET probability=$2, prob_overridden=$3, modified_by=$4, modified_at=now(), version=version+1 WHERE id=$1`, [o.id, p, p !== st.probability, ctx.id]);
      await audit(ctx, { event: 'probability_override', entity: 'opportunities', recordId: o.id, label: o.name, changes: { probability: [o.probability, p] }, detail: b.reason });
    },
  },
  set_forecast_category: {
    label: 'Set forecast category', perm: 'E',
    async run(ctx, o, b) {
      if (!['Pipeline', 'Best case', 'Commit', 'Omitted'].includes(b.category)) throw bad('Invalid category');
      if (['Won', 'Lost', 'Cancelled'].includes(o.status)) throw forbidden('Opportunity is closed');
      await db.query('UPDATE opportunities SET forecast_category=$2, modified_by=$3, modified_at=now(), version=version+1 WHERE id=$1', [o.id, b.category, ctx.id]);
      await audit(ctx, { event: 'update', entity: 'opportunities', recordId: o.id, label: o.name, changes: { forecast_category: [o.forecast_category, b.category] } });
    },
  },
  snooze_stall: {
    label: 'Snooze stalled alert', perm: 'E',
    async run(ctx, o, b) {
      if (!b.reason) throw bad('A reason is required to snooze (max 7 days)');
      const days = Math.min(parseInt(b.days || 7, 10), 7);
      await db.query(`UPDATE opportunities SET stalled_snooze_until = now() + ($2 || ' days')::interval WHERE id=$1`, [o.id, String(days)]);
      await audit(ctx, { event: 'snooze', entity: 'opportunities', recordId: o.id, label: o.name, detail: b.reason });
    },
  },
};

// ----------------------------------------------------------------- pipeline board
router.get('/pipeline', wrap(async (req, res) => {
  const ctx = req.ctx;
  if (!A.can(ctx, 'M08', 'V')) throw forbidden();
  const params = [];
  const sc = await A.scopeClause('opportunities', ctx, params, 'V', 't');
  const where = ["t.is_deleted=false", "t.status IN ('Open','On hold')"];
  if (sc) where.push(sc);
  if (req.query.owner_id) { params.push(req.query.owner_id); where.push(`t.owner_id=$${params.length}`); }
  if (req.query.country) { params.push(req.query.country); where.push(`t.country=$${params.length}`); }
  if (req.query.mine === '1') { params.push(ctx.id); where.push(`t.owner_id=$${params.length}`); }
  const { rows } = await db.query(
    `SELECT t.id, t.number, t.name, t.stage, t.status, t.amount, t.currency, t.amount_base, t.probability, t.close_date, t.owner_id, t.forecast_category, t.last_activity_at, t.created_at, t.close_date_changes, a.legal_name AS account_name, u.name AS owner_name
     FROM opportunities t JOIN accounts a ON a.id=t.account_id JOIN users u ON u.id=t.owner_id WHERE ${where.join(' AND ')} ORDER BY t.close_date LIMIT 1500`, params);
  const sts = (await stages()).filter((s) => !['S11', 'S12'].includes(s.code));
  for (const r of rows) { r.risk_flags = await riskFlags({ ...r, status: 'Open' }); r.weighted_amount = Math.round((r.amount_base || 0) * r.probability) / 100; }
  res.json({ stages: sts.map((s) => ({ code: s.code, name: s.name, probability: s.probability, items: rows.filter((r) => r.stage === s.code), total: rows.filter((r) => r.stage === s.code).reduce((a, r) => a + (r.amount_base || 0), 0) })) });
}));

// Opportunity 360 tabs helpers: related quotation summary
router.get('/opportunities/:id/summary', wrap(async (req, res) => {
  const o = await crud.loadOne(entities.opportunities, req.params.id, req.ctx);
  if (!o) throw require('../core/errors').notFound();
  const { rows: q } = await db.query(`SELECT q.id, q.number, q.status, q.is_primary, q.current_version_no, q.grand_total, q.currency FROM quotations q WHERE q.opportunity_id=$1 AND q.is_deleted=false ORDER BY q.id`, [o.id]);
  const { rows: d } = await db.query('SELECT id, number, status, vendor_id, protection_end FROM deal_registrations WHERE opportunity_id=$1 AND is_deleted=false', [o.id]);
  res.json({ quotations: q, deal_registrations: d });
}));

module.exports = { router, stages, clearStages, stageOf, exitChecklist, riskFlags, applyStage };
