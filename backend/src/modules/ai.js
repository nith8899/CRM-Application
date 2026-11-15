'use strict';
// M28 - AI-assisted CRM (rule-based, human-in-the-loop; BRULE-AI-001). No cost/margin is ever included.
const express = require('express');
const db = require('../db');
const A = require('../core/access');
const crud = require('../core/crud');
const { entities } = require('../entities');
const { forbidden, notFound, wrap } = require('../core/errors');
const { riskFlags, stageOf, exitChecklist } = require('./opportunities');

const router = express.Router();
const NOTICE = 'AI-assisted draft generated from CRM data using rules. Review before using - nothing is sent automatically.';
const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

async function loadOpp(ctx, id) {
  if (!A.can(ctx, 'M28', 'U') && !ctx.isAdmin) throw forbidden('AI assistance is not enabled for your role');
  const o = await crud.loadOne(entities.opportunities, id, ctx); if (!o) throw notFound(); return o;
}
router.get('/ai/opportunity/:id/summary', wrap(async (req, res) => {
  const o = await loadOpp(req.ctx, req.params.id);
  const { rows: a } = await db.query('SELECT legal_name FROM accounts WHERE id=$1', [o.account_id]);
  const { rows: st } = await db.query(`SELECT c.full_name, oc.buying_role FROM opportunity_contacts oc JOIN contacts c ON c.id=oc.contact_id WHERE oc.opportunity_id=$1 AND oc.is_deleted=false`, [o.id]);
  const { rows: acts } = await db.query(`SELECT activity_type, subject, activity_date, outcome FROM activities WHERE opportunity_id=$1 AND is_deleted=false ORDER BY activity_date DESC LIMIT 3`, [o.id]);
  const stage = await stageOf(o.stage); const flags = await riskFlags(o);
  const text = [`${o.name} (${o.number}) for ${a[0].legal_name} is a ${o.route.toLowerCase()} ${String(o.opp_type || '').toLowerCase()} deal worth ${o.currency} ${fmt(o.amount)}, currently at stage "${stage ? stage.name : o.stage}" with ${o.probability}% probability and expected close ${o.close_date}.`,
    st.length ? `Stakeholders: ${st.map((s) => `${s.full_name} (${s.buying_role})`).join(', ')}.` : 'No stakeholders recorded yet.',
    acts.length ? `Recent activity: ${acts.map((x) => `${x.activity_type} "${x.subject}" on ${String(x.activity_date).slice(0, 10)}${x.outcome ? ' (' + x.outcome + ')' : ''}`).join('; ')}.` : 'No activity logged yet.',
    flags.length ? `Risks: ${flags.map((f) => f.label).join('; ')}.` : 'No risk indicators raised.'].join(' ');
  await db.query('INSERT INTO ai_logs (user_id, feature, entity, record_id, output) VALUES ($1,$2,$3,$4,$5)', [req.ctx.id, 'opportunity_summary', 'opportunities', o.id, text]);
  res.json({ notice: NOTICE, text });
}));
router.get('/ai/opportunity/:id/next-actions', wrap(async (req, res) => {
  const o = await loadOpp(req.ctx, req.params.id);
  const out = []; const flags = await riskFlags(o);
  if (o.status !== 'Open') return res.json({ notice: NOTICE, actions: [] });
  const miss = await exitChecklist(o, o.stage);
  if (miss.length) out.push({ priority: 'high', action: `Complete stage criteria before moving on: ${miss.join('; ')}` });
  for (const f of flags) {
    if (f.code === 'stalled') out.push({ priority: 'high', action: 'Schedule a follow-up call or meeting - the deal has had no recent activity.' });
    if (f.code === 'overdue_close') out.push({ priority: 'high', action: 'Update the expected close date or close the opportunity.' });
    if (f.code === 'slippage') out.push({ priority: 'medium', action: 'Review the deal with your manager - the close date has slipped repeatedly.' });
    if (f.code === 'unknown_budget') out.push({ priority: 'medium', action: 'Confirm the customer budget.' });
  }
  const { rows: q } = await db.query(`SELECT 1 FROM quotations WHERE opportunity_id=$1 AND is_deleted=false`, [o.id]);
  if (!q.length && ['S07', 'S08'].includes(o.stage)) out.push({ priority: 'high', action: 'Create a quotation for this opportunity.' });
  res.json({ notice: NOTICE, actions: out.length ? out : [{ priority: 'low', action: 'No urgent actions - keep momentum with a stakeholder check-in.' }] });
}));
router.post('/ai/email-draft', wrap(async (req, res) => {
  const { opportunity_id, purpose = 'follow-up' } = req.body || {};
  const o = await loadOpp(req.ctx, opportunity_id);
  const { rows: a } = await db.query('SELECT legal_name FROM accounts WHERE id=$1', [o.account_id]);
  const text = `Subject: ${purpose === 'follow-up' ? 'Following up' : purpose} - ${o.name}\n\nDear [Name],\n\nThank you for your time regarding ${o.name} at ${a[0].legal_name}. I would like to follow up on our latest discussion and agree the next steps${o.close_date ? ` ahead of your target decision date of ${o.close_date}` : ''}.\n\nCould we schedule a short call this week?\n\nKind regards,\n${req.ctx.user.name}`;
  await db.query('INSERT INTO ai_logs (user_id, feature, entity, record_id, output) VALUES ($1,$2,$3,$4,$5)', [req.ctx.id, 'email_draft', 'opportunities', o.id, text]);
  res.json({ notice: NOTICE + ' Human send only.', text });
}));
module.exports = { router };
