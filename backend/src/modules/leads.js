'use strict';
// M02 - Lead management: scoring, assignment, qualification (BANT-T), disqualification, conversion.
const express = require('express');
const db = require('../db');
const A = require('../core/access');
const hooks = require('../core/hooks');
const settings = require('../core/settings');
const fx = require('../core/fx');
const { audit } = require('../core/audit');
const { notify } = require('../core/notify');
const { nextNumber } = require('../core/numbering');
const { bad, forbidden } = require('../core/errors');
const { entities } = require('../entities');

const router = express.Router();
const BR = {
  budget: ['Unknown', 'None', 'Indicated', 'Confirmed'], authority: ['Unknown', 'User', 'Influencer', 'Decision maker', 'Economic buyer'],
  timeline: ['Unknown', '> 12 months', '6-12 months', '< 6 months', '< 3 months'], fit: ['Unknown', 'None', 'Partial', 'Full'],
};

/** Rule-based lead score 0-100 (BRULE-LEAD-006, FR-LEAD-005). */
function scoreLead(l) {
  let s = 0;
  s += [0, 0, 10, 20][BR.budget.indexOf(l.bant_budget)] || 0;
  s += [0, 2, 8, 12, 15][BR.authority.indexOf(l.bant_authority)] || 0;
  s += { Unclear: 0, Defined: 10, Urgent: 15 }[l.bant_need] || 0;
  s += [0, 0, 5, 10, 15][BR.timeline.indexOf(l.bant_timeline)] || 0;
  s += [0, 0, 8, 15][BR.fit.indexOf(l.bant_tech_fit)] || 0;
  s += { Referral: 10, 'Partner referral': 10, Event: 6, Webinar: 5, Website: 4, Campaign: 3 }[l.source] || 2;
  if (l.email && !/@(gmail|yahoo|hotmail|outlook)\./i.test(l.email)) s += 5;
  if (l.est_value > 50000) s += 5;
  return Math.max(0, Math.min(100, s));
}

hooks.register('leads', {
  validate(ctx, v) {
    const errs = [];
    if (!v.email && !v.phone) errs.push({ field: 'email', message: 'At least one contact method (email or phone) is required (BRULE-LEAD-001)' });
    return errs;
  },
  async beforeCreate(ctx, v, c) {
    v.score = scoreLead(v);
    // BRULE-LEAD-004: a lead matching an existing account goes to that account's owner (unless open territory)
    const { rows } = await c.query(`SELECT a.owner_id, a.open_territory, u.status FROM accounts a JOIN users u ON u.id=a.owner_id WHERE lower(a.legal_name)=lower($1) AND a.is_deleted=false LIMIT 1`, [v.company]);
    if (rows[0] && !rows[0].open_territory && rows[0].status === 'Active' && ctx.id === v.owner_id) { v.owner_id = rows[0].owner_id; v._autoAssigned = true; }
    v.assigned_at = new Date().toISOString();
    if (v.owner_id !== ctx.id) v.status = 'Pending acceptance';
  },
  async afterCreate(ctx, l, c) { if (l.owner_id !== ctx.id) await notify(l.owner_id, { type: 'lead_assigned', title: `New lead assigned: ${l.company}`, body: 'First response SLA applies (BRULE-LEAD-005)', entity: 'leads', recordId: l.id }, c); },
  beforeUpdate(ctx, v, existing) { v.score = scoreLead({ ...existing, ...v }); },
  async afterUpdate(ctx, l, old, c, changes) { if (changes.owner_id) { await c.query('UPDATE leads SET assigned_at=now() WHERE id=$1', [l.id]); await notify(l.owner_id, { type: 'lead_assigned', title: `Lead assigned: ${l.company}`, entity: 'leads', recordId: l.id }, c); } },
});

function bantGaps(l) {
  const gaps = [];
  if (BR.budget.indexOf(l.bant_budget) < BR.budget.indexOf('Indicated')) gaps.push('Budget must be at least "Indicated"');
  if (BR.authority.indexOf(l.bant_authority) < BR.authority.indexOf('Influencer')) gaps.push('Authority must be at least "Influencer"');
  if (l.bant_need === 'Unclear') gaps.push('Need must be defined');
  if (['Unknown', '> 12 months'].includes(l.bant_timeline)) gaps.push('Timeline must be within 12 months');
  if (BR.fit.indexOf(l.bant_tech_fit) < BR.fit.indexOf('Partial')) gaps.push('Technical fit must be at least "Partial"');
  return gaps;
}

entities.leads.actions = {
  accept: { label: 'Accept lead', perm: 'E', async run(ctx, l) {
    if (l.status !== 'Pending acceptance') throw bad('Lead is not pending acceptance');
    await db.query(`UPDATE leads SET status='Working', first_response_at=COALESCE(first_response_at, now()) WHERE id=$1`, [l.id]); await audit(ctx, { event: 'lead_accepted', entity: 'leads', recordId: l.id, label: l.company });
  } },
  qualify: { label: 'Mark qualified', perm: 'E', async run(ctx, l, b) {
    if (['Converted', 'Disqualified'].includes(l.status)) throw bad(`Lead is ${l.status}`);
    const gaps = bantGaps(l);
    if (gaps.length) {
      if (b.override && A.roleHas(ctx, 'ROL-SM', 'ROL-SD', 'ROL-CM', 'ROL-ADM')) { if (!b.reason) throw bad('A reason is required to override'); await audit(ctx, { event: 'qualification_override', entity: 'leads', recordId: l.id, label: l.company, detail: `${b.reason} (${gaps.join('; ')})` }); }
      else throw bad('Qualification criteria not met (BRULE-LEAD-007)', { checklist: gaps, can_override: A.roleHas(ctx, 'ROL-SM', 'ROL-SD', 'ROL-CM', 'ROL-ADM') });
    }
    await db.query(`UPDATE leads SET status='Qualified', modified_by=$2, modified_at=now(), version=version+1 WHERE id=$1`, [l.id, ctx.id]);
    await audit(ctx, { event: 'lead_qualified', entity: 'leads', recordId: l.id, label: l.company });
  } },
  disqualify: { label: 'Disqualify', perm: 'E', async run(ctx, l, b) {
    if (['Converted'].includes(l.status)) throw bad('Converted leads are read-only');
    if (!b.reason) throw bad('A disqualification reason is required (BRULE-LEAD-009)');
    if (b.reason === 'Other' && !b.comment) throw bad('A comment is required when the reason is "Other"');
    await db.query(`UPDATE leads SET status='Disqualified', disqualify_reason=$2, disqualify_comment=$3, modified_by=$4, modified_at=now(), version=version+1 WHERE id=$1`, [l.id, b.reason, b.comment || null, ctx.id]);
    await audit(ctx, { event: 'lead_disqualified', entity: 'leads', recordId: l.id, label: l.company, detail: `${b.reason} ${b.comment || ''}` });
  } },
  reopen: { label: 'Re-open', perm: 'E', async run(ctx, l) { if (l.status !== 'Disqualified') throw bad('Only disqualified leads can be re-opened'); await db.query(`UPDATE leads SET status='Working' WHERE id=$1`, [l.id]); await audit(ctx, { event: 'lead_reopened', entity: 'leads', recordId: l.id, label: l.company }); } },
  convert: { label: 'Convert', perm: 'E', async run(ctx, l, b) {
    if (l.status === 'Converted') throw bad('Lead is already converted');
    if (l.status === 'Disqualified') throw bad('Disqualified leads cannot be converted. Re-open first.');
    if (l.status !== 'Qualified' && !b.skip_qualification) {
      const gaps = bantGaps(l);
      if (gaps.length) throw bad('Lead must be qualified before conversion (FR-LEAD-007)', { checklist: gaps });
    }
    return db.tx(async (c) => {
      let accountId = b.account_id ? Number(b.account_id) : null;
      if (accountId) {
        const { rows } = await c.query('SELECT id FROM accounts WHERE id=$1 AND is_deleted=false', [accountId]);
        if (!rows[0]) throw bad('Selected account not found');
      } else {
        const anum = await nextNumber('ACC', c);
        const { rows } = await c.query(`INSERT INTO accounts (number, owner_id, legal_name, country, account_type, status, industry, created_by, modified_by) VALUES ($1,$2,$3,$4,'Prospect','Active',$5,$2,$2) RETURNING id`, [anum, l.owner_id, l.company, l.country, l.industry]);
        accountId = rows[0].id;
        await audit(ctx, { event: 'create', entity: 'accounts', recordId: accountId, label: l.company, detail: `from lead ${l.number}` }, c);
      }
      const cnum = await nextNumber('CON', c);
      const full = [l.first_name, l.last_name].filter(Boolean).join(' ');
      const { rows: ct } = await c.query(`INSERT INTO contacts (number, owner_id, first_name, last_name, full_name, account_id, job_title, email, phone, status, consent_email, consent_date, created_by, modified_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Active',$10,$11,$2,$2) RETURNING id`, [cnum, l.owner_id, l.first_name, l.last_name, full, accountId, l.title, l.email, l.phone, l.consent_marketing, l.consent_marketing ? new Date().toISOString().slice(0, 10) : null]);
      let oppId = null;
      if (b.create_opportunity !== false) {
        const o = b.opportunity || {};
        const onum = await nextNumber('OPP', c);
        const { rows: bu } = await c.query('SELECT bu_id FROM users WHERE id=$1', [l.owner_id]);
        const { rows: b0 } = await c.query('SELECT id FROM business_units WHERE is_deleted=false ORDER BY id LIMIT 1');
        const amount = Number(o.amount || l.est_value || 0); const ccy = o.currency || l.currency || 'USD';
        const close = o.close_date || new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
        const st = (await c.query(`SELECT probability, forecast_category FROM stage_definitions WHERE code='S01' AND is_deleted=false LIMIT 1`)).rows[0] || { probability: 5, forecast_category: 'Pipeline' };
        const { rows } = await c.query(`INSERT INTO opportunities (number, owner_id, name, account_id, opp_type, route, source, stage, status, probability, forecast_category, amount, currency, amount_base, close_date, bu_id, country, lead_id, campaign_id, primary_partner_id, stage_entered_at, last_activity_at, budget_status, authority, need_status, technical_fit, created_by, modified_by)
          VALUES ($1,$2,$3,$4,'New business',$5,$6,'S01','Open',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now(),now(),$18,$19,$20,$21,$2,$2) RETURNING id`,
          [onum, l.owner_id, o.name || `${l.company} - ${(l.interest || 'new opportunity').slice(0, 60)}`, accountId, l.partner_id ? 'Indirect' : 'Direct', l.source, st.probability, st.forecast_category, amount, ccy, await fx.toBase(amount, ccy, null, c), close,
            (bu[0] && bu[0].bu_id) || (b0[0] && b0[0].id), l.country, l.id, l.campaign_id, l.partner_id,
            l.bant_budget === 'None' ? 'None' : l.bant_budget, l.bant_authority, l.bant_need, l.bant_tech_fit]);
        oppId = rows[0].id;
        await c.query('INSERT INTO opportunity_stage_history (opportunity_id, to_stage, changed_by, probability, reason) VALUES ($1,$2,$3,$4,$5)', [oppId, 'S01', ctx.id, st.probability, `Converted from ${l.number}`]);
        await c.query(`INSERT INTO opportunity_contacts (opportunity_id, contact_id, buying_role, created_by, modified_by) VALUES ($1,$2,$3,$4,$4)`, [oppId, ct[0].id, ['Decision maker', 'Economic buyer'].includes(l.bant_authority) ? 'Decision maker' : 'Influencer', ctx.id]);
        await audit(ctx, { event: 'create', entity: 'opportunities', recordId: oppId, label: o.name || l.company, detail: `from lead ${l.number}` }, c);
      }
      await c.query(`UPDATE leads SET status='Converted', converted_account_id=$2, converted_contact_id=$3, converted_opportunity_id=$4, modified_by=$5, modified_at=now(), version=version+1 WHERE id=$1`, [l.id, accountId, ct[0].id, oppId, ctx.id]);
      await audit(ctx, { event: 'lead_converted', entity: 'leads', recordId: l.id, label: l.company, detail: `account ${accountId}, contact ${ct[0].id}, opportunity ${oppId}` }, c);
      return { account_id: accountId, contact_id: ct[0].id, opportunity_id: oppId };
    });
  } },
};

module.exports = { router, scoreLead, bantGaps };
