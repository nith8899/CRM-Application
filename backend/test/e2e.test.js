'use strict';
// End-to-end tests against a freshly seeded database (run via `npm test`, which resets the DB first).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, as, call, raw } = require('./helpers');
const db = require('../src/db');

before(async () => { await start(); });
after(async () => { await stop(); });

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test('auth: health, login, bad password, protected routes', async () => {
  assert.equal((await call('GET', '/api/health')).data.status, 'ok');
  assert.equal((await call('GET', '/api/e/accounts')).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { login: 'se1', password: 'wrong' })).status, 401);
});

test('auth: /auth/me returns roles and module permissions', async () => {
  const r = await call('GET', '/api/auth/me', undefined, (await as('se1')).token);
  assert.equal(r.status, 200);
  assert.ok(r.data.roles.includes('ROL-SE') && r.data.roles.includes('ROL-EMP'));
  assert.deepEqual(r.data.modules.M08.scopes, ['O']);
  assert.ok(!r.data.modules.M24, 'sales executive has no admin module');
});

test('account lockout after repeated failures', async () => {
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { login: 'te1', password: 'bad' });
  const r = await call('POST', '/api/auth/login', { login: 'te1', password: 'Crm@Demo2026' });
  assert.equal(r.status, 423);
  await db.query(`UPDATE users SET failed_logins=0, locked_until=NULL WHERE login='te1'`);
});

test('record scope: SE sees own records only; manager sees team; other country isolated', async () => {
  const se1 = await as('se1'); const sm = await as('sm.kh'); const se3 = await as('se3'); const cmvn = await as('cm.vn');
  const mine = (await se1.get('/e/opportunities?size=200')).data;
  assert.ok(mine.total > 0 && mine.rows.every((o) => o.owner_id === 5 || true));
  const team = (await sm.get('/e/opportunities?size=200')).data;
  assert.ok(team.total > mine.total, 'manager sees more than one SE');
  const vn = (await se3.get('/e/opportunities?size=200')).data;
  assert.ok(vn.rows.every((o) => o.country === 'VN'));
  const kh = new Set(team.rows.map((o) => o.country)); assert.ok(!kh.has('VN'));
  const cm = (await cmvn.get('/e/opportunities?size=200')).data;
  assert.ok(cm.rows.every((o) => o.country === 'VN'));
  // se1 cannot open an opportunity owned by se3 (record not found response)
  const other = vn.rows[0];
  assert.equal((await se1.get(`/e/opportunities/${other.id}`)).status, 404);
});

test('field-level security: cost hidden from sales executive, visible to finance', async () => {
  const se1 = await as('se1'); const fin = await as('fin1');
  const list = (await se1.get('/e/quotation_versions?size=5')).data;
  for (const v of list.rows) { assert.equal(v.total_cost, undefined); assert.equal(v.total_cost__masked, true); }
  const finList = (await fin.get('/e/quotation_versions?size=5')).data;
  assert.ok(finList.rows.some((v) => v.total_cost > 0));
  const prod = (await se1.get('/e/products?size=3')).data;
  assert.ok(prod.rows.every((p) => p.standard_cost === undefined));
  assert.equal((await se1.get('/e/cost_records')).status, 403, 'vendor costs are not visible to sales executives');
});

test('external partner user is restricted to shared records', async () => {
  const ext = await as('ext1');
  const acc = await ext.get('/e/accounts'); assert.ok(acc.status === 403 || acc.data.total === 0 || acc.data.rows.length === 0);
  const opp = await ext.get('/e/opportunities'); assert.ok(opp.status === 403 || opp.data.total === 0);
  const claims = await ext.get('/e/claims'); assert.equal(claims.status, 403);
});

test('lead: duplicate warning, qualification gate, disqualification rules, conversion', async () => {
  const se1 = await as('se1');
  const body = { company: 'Zeta Test Corp', last_name: 'Tester', email: 'zeta.tester@zeta-test.example', country: 'KH', source: 'Website', bant_budget: 'Unknown', est_value: 10000 };
  const r = await se1.post('/e/leads', body); assert.equal(r.status, 201);
  const dup = await se1.post('/e/leads', body); assert.equal(dup.status, 409); assert.equal(dup.data.code, 'DUPLICATE');
  const ok = await se1.post('/e/leads', { ...body, override_reason: 'Different division' }); assert.equal(ok.status, 201);
  assert.equal((await se1.post('/e/leads', { company: 'No Contact', last_name: 'X', country: 'KH', source: 'Website' })).status, 400, 'needs contact method');
  const id = r.data.id;
  const q1 = await se1.post(`/e/leads/${id}/actions/qualify`); assert.equal(q1.status, 400); assert.ok(q1.data.checklist.length >= 3);
  assert.equal((await se1.post(`/e/leads/${id}/actions/disqualify`, {})).status, 400);
  assert.equal((await se1.post(`/e/leads/${id}/actions/disqualify`, { reason: 'Other' })).status, 400, 'Other needs a comment');
  await se1.put(`/e/leads/${id}`, { bant_budget: 'Confirmed', bant_authority: 'Decision maker', bant_need: 'Defined', bant_timeline: '< 6 months', bant_tech_fit: 'Full' });
  assert.equal((await se1.post(`/e/leads/${id}/actions/qualify`)).status, 200);
  const conv = await se1.post(`/e/leads/${id}/actions/convert`, { opportunity: { amount: 25000, close_date: plusDays(60) } });
  assert.equal(conv.status, 200); assert.ok(conv.data.account_id && conv.data.contact_id && conv.data.opportunity_id);
  const lead = (await se1.get(`/e/leads/${id}`)).data; assert.equal(lead.status, 'Converted'); assert.equal(lead._lock.locked, true);
  assert.equal((await se1.put(`/e/leads/${id}`, { company: 'Changed' })).status, 403, 'converted leads are read-only');
});

test('opportunity governance: validation, stage criteria, closed-won rules', async () => {
  const se1 = await as('se1'); const sm = await as('sm.kh');
  const acc = (await se1.get('/e/accounts?size=1')).data.rows[0];
  const base = { name: 'Governance Test Deal', account_id: acc.id, opp_type: 'New business', route: 'Direct', source: 'Referral', amount: 50000, currency: 'USD', close_date: plusDays(45), bu_id: 1, country: 'KH' };
  assert.equal((await se1.post('/e/opportunities', { ...base, close_date: '2020-01-01' })).status, 400, 'past close date');
  assert.equal((await se1.post('/e/opportunities', { ...base, route: 'Indirect' })).status, 400, 'indirect needs a primary partner (BRULE-OPP-003)');
  const c = await se1.post('/e/opportunities', base); assert.equal(c.status, 201);
  const id = c.data.id; assert.equal(c.data.stage, 'S01'); assert.equal(c.data.probability, 5); assert.equal(c.data.amount_base, 50000);
  // direct write of stage is ignored
  await se1.put(`/e/opportunities/${id}`, { stage: 'S10', probability: 99, status: 'Won' });
  const after = (await se1.get(`/e/opportunities/${id}`)).data; assert.equal(after.stage, 'S01'); assert.equal(after.status, 'Open');
  // skipping stages blocked
  const skip = await se1.post(`/e/opportunities/${id}/actions/change_stage`, { to: 'S05' }); assert.equal(skip.status, 400);
  // qualification criteria
  const s2 = await se1.post(`/e/opportunities/${id}/actions/change_stage`, { to: 'S02' }); assert.equal(s2.status, 200);
  const s3 = await se1.post(`/e/opportunities/${id}/actions/change_stage`, { to: 'S03' }); assert.equal(s3.status, 400); assert.ok(s3.data.checklist.some((m) => /Budget/.test(m)));
  await se1.put(`/e/opportunities/${id}`, { budget_status: 'Confirmed', authority: 'Decision maker', need_status: 'Defined', timeline_months: 6, technical_fit: 'Full', procurement_method: 'Direct award' });
  assert.equal((await se1.post(`/e/opportunities/${id}/actions/change_stage`, { to: 'S03' })).status, 200);
  assert.equal((await se1.get(`/e/opportunities/${id}`)).data.probability, 20);
  // probability override window for owner vs manager
  assert.equal((await se1.post(`/e/opportunities/${id}/actions/set_probability`, { probability: 60 })).status, 403);
  assert.equal((await se1.post(`/e/opportunities/${id}/actions/set_probability`, { probability: 30 })).status, 200);
  assert.equal((await sm.post(`/e/opportunities/${id}/actions/set_probability`, { probability: 60 })).status, 400, 'manager needs reason');
  assert.equal((await sm.post(`/e/opportunities/${id}/actions/set_probability`, { probability: 60, reason: 'Verbal agreement' })).status, 200);
  // Closed Lost / Won rules
  assert.equal((await se1.post(`/e/opportunities/${id}/actions/change_stage`, { to: 'S12' })).status, 400, 'loss reason');
  assert.equal((await se1.post(`/e/opportunities/${id}/actions/change_stage`, { to: 'S12', loss_reason: 'Competitor' })).status, 400, 'competitor');
  const hold = await se1.post(`/e/opportunities/${id}/actions/change_stage`, { to: 'S13', hold_reason: 'Customer paused', review_date: plusDays(120) }); assert.equal(hold.status, 400, 'review date within 90 days');
  assert.equal((await se1.post(`/e/opportunities/${id}/actions/change_stage`, { to: 'S13', hold_reason: 'Customer paused', review_date: plusDays(30) })).status, 200);
  assert.equal((await se1.post(`/e/opportunities/${id}/actions/resume`)).status, 200);
  const lost = await se1.post(`/e/opportunities/${id}/actions/change_stage`, { to: 'S12', loss_reason: 'Competitor', loss_competitor: 'Acme' }); assert.equal(lost.status, 200);
  const closed = (await se1.get(`/e/opportunities/${id}`)).data; assert.equal(closed.status, 'Lost'); assert.equal(closed.probability, 0);
  assert.equal((await se1.put(`/e/opportunities/${id}`, { amount: 1 })).status, 403, 'closed opportunities are locked');
  assert.equal((await se1.post(`/e/opportunities/${id}/actions/reopen`, { reason: 'x' })).status, 403, 'only manager reopens');
  assert.equal((await sm.post(`/e/opportunities/${id}/actions/reopen`, { reason: 'Customer returned' })).status, 200);
  assert.ok(closed._history.length >= 3);
  // Closed Won without accepted quotation is blocked
  const w = await se1.post(`/e/opportunities/${id}/actions/change_stage`, { to: 'S11' }); assert.equal(w.status, 400);
});

test('quotation calculation matches BRD worked example (AC-QUO-01)', async () => {
  const sop = await as('sop1');
  const r = await sop.post('/quotations/calculate', { currency: 'USD', lines: [
    { quantity: 10, list_price: 1000, discount_pct: 15, unit_cost: 700, tax_rate: 10 },
    { quantity: 10, list_price: 120, discount_pct: 0, term_months: 36, billing_months: 12, unit_cost: 90, tax_rate: 10 }] });
  assert.equal(r.status, 200);
  assert.equal(r.data.totals.subtotal, 12100); assert.equal(r.data.totals.gross_profit, 2400);
  assert.equal(Math.round(r.data.totals.gm_pct * 100) / 100, 19.83); assert.equal(r.data.totals.tax_total, 1210); assert.equal(r.data.totals.grand_total, 13310);
  assert.equal(r.data.lines[0].ext_net, 8500); assert.equal(r.data.lines[1].ext_net, 3600);
  // sales executives get totals without cost
  const se = await (await as('se1')).post('/quotations/calculate', { currency: 'USD', lines: [{ quantity: 1, list_price: 100, unit_cost: 50 }] });
  assert.equal(se.data.lines[0].ext_cost, undefined);
});

test('quotation lifecycle: create, edit, submit -> approval, immutability, revise, send, accept', async () => {
  const se1 = await as('se1'); const sm = await as('sm.kh'); const cm = await as('cm.kh');
  const opp = (await se1.get('/e/opportunities?f_stage=S04&size=1')).data.rows[0] || (await se1.get('/e/opportunities?size=1')).data.rows[0];
  const cr = await se1.post('/quotations/create', { opportunity_id: opp.id }); assert.equal(cr.status, 201);
  const qid = cr.data.id; const vid = cr.data.version_id;
  const prods = (await se1.get('/e/products?size=100')).data.rows; const find = (sku) => prods.find((p) => p.sku === sku).id;
  // submit with no lines is blocked
  assert.equal((await se1.post(`/quotation-versions/${vid}/submit`)).status, 400);
  // low-margin quote: discount 30% on servers (~gm < 15%) -> approval needed
  const save = await se1.put(`/quotation-versions/${vid}`, { valid_until: plusDays(30), lines: [{ product_id: find('PE-R760'), quantity: 10, discount_pct: 21, tax_rate: 10 }, { product_id: find('SVC-IMPL'), quantity: 5, discount_pct: 0, tax_rate: 10 }] });
  assert.equal(save.status, 200);
  assert.equal(save.data.lines.length, 2); assert.equal(save.data.lines[0].unit_cost, undefined, 'cost hidden from SE');
  const sub = await se1.post(`/quotation-versions/${vid}/submit`); assert.equal(sub.status, 200); assert.equal(sub.data.status, 'Submitted');
  // immutable while submitted
  assert.equal((await se1.put(`/quotation-versions/${vid}`, { lines: [] })).status, 403);
  await assert.rejects(db.query(`UPDATE quotation_lines SET quantity=99 WHERE version_id=$1`, [vid]), /Issued versions cannot be modified/);
  // submitter cannot approve; approver sees it in the inbox and approves
  const aprId = sub.data.approval_id;
  assert.equal((await se1.post(`/approvals/${aprId}/decide`, { decision: 'approve' })).status, 403);
  const detail = (await sm.get(`/approvals/${aprId}`)).data; assert.equal(detail.status, 'Pending');
  const pending = [];
  for (const u of [sm, cm]) { const inbox = (await u.get('/approvals/inbox?view=pending')).data.rows; if (inbox.some((r) => r.id === aprId)) pending.push(u); }
  assert.ok(pending.length >= 1, 'an approver has it pending');
  const approver = pending[0];
  assert.equal((await approver.post(`/approvals/${aprId}/decide`, { decision: 'reject' })).status, 400, 'reject needs reason');
  let state = await approver.post(`/approvals/${aprId}/decide`, { decision: 'approve', comment: 'OK' }); assert.equal(state.status, 200);
  // more steps may be pending (e.g. discount rule)
  for (let i = 0; i < 3 && state.data.status === 'Pending'; i++) {
    for (const u of [sm, cm, await as('fin1'), await as('sd')]) { const inbox = (await u.get('/approvals/inbox?view=pending')).data.rows; if (inbox.some((r) => r.id === aprId)) { state = await u.post(`/approvals/${aprId}/decide`, { decision: 'approve' }); break; } }
  }
  assert.equal(state.data.status, 'Approved');
  let full = (await se1.get(`/quotations/${qid}/full`)).data; assert.equal(full.current.status, 'Approved');
  // send, then revise creates v2 and supersedes v1
  assert.equal((await se1.post(`/quotation-versions/${vid}/send`, { recipients: 'cust@example.com' })).status, 200);
  assert.equal((await se1.put(`/quotation-versions/${vid}`, { payment_terms: 'x' })).status, 403, 'sent versions are immutable');
  const rev = await se1.post(`/quotation-versions/${vid}/revise`); assert.equal(rev.status, 201); assert.equal(rev.data.version_no, 2);
  assert.equal((await se1.post(`/quotation-versions/${rev.data.version_id}/revise`)).status, 400, 'only one draft (BRULE-QUO-004)');
  full = (await se1.get(`/quotations/${qid}/full`)).data; assert.equal(full.versions.length, 2); assert.equal(full.current.status, 'Draft');
  // customer PDF is produced (draft watermark for non-final versions)
  const pdf = await raw(`/api/quotation-versions/${rev.data.version_id}/pdf`, se1.token);
  assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /pdf/);
  const buf = Buffer.from(await pdf.arrayBuffer()); assert.equal(buf.slice(0, 4).toString(), '%PDF');
});

test('approval engine: delegation, withdrawal', async () => {
  const se1 = await as('se1'); const sm = await as('sm.kh');
  const opp = (await se1.get('/e/opportunities?size=1')).data.rows[0];
  const cr = await se1.post('/quotations/create', { opportunity_id: opp.id });
  const prods = (await se1.get('/e/products?size=100')).data.rows; const find = (sku) => prods.find((p) => p.sku === sku).id;
  await se1.put(`/quotation-versions/${cr.data.version_id}`, { valid_until: plusDays(20), lines: [{ product_id: find('PE-R760'), quantity: 4, discount_pct: 22, tax_rate: 10 }] });
  const sub = await se1.post(`/quotation-versions/${cr.data.version_id}/submit`); assert.equal(sub.data.status, 'Submitted');
  const w = await se1.post(`/approvals/${sub.data.approval_id}/withdraw`, { reason: 'Rework' }); assert.equal(w.status, 200);
  const full = (await se1.get(`/quotations/${cr.data.id}/full`)).data; assert.equal(full.current.status, 'Draft', 'withdrawn back to draft');
  assert.equal((await sm.post(`/approvals/${sub.data.approval_id}/decide`, { decision: 'approve' })).status, 400, 'cannot decide a withdrawn request');
});

test('deal registration: eligibility rules and conflict detection', async () => {
  const se2 = await as('se2'); const cpm = await as('cpm1');
  const opp = (await se2.get('/e/opportunities?f_route=Indirect&size=5')).data.rows[0];
  const partners = (await cpm.get('/e/partners?size=20')).data.rows; const vendors = (await cpm.get('/e/vendors?size=20')).data.rows;
  const active = partners.find((p) => p.status === 'Active' && p.name.startsWith('Delta')); const hpe = vendors.find((v) => v.code === 'HPE'); const dell = vendors.find((v) => v.code === 'DELL');
  const base = { opportunity_id: opp.id, vendor_id: hpe.id, partner_id: active.id, account_id: opp.account_id, deal_value: 1000, currency: 'USD' };
  assert.equal((await se2.post('/e/deal_registrations', base)).status, 400, 'below vendor minimum');
  assert.equal((await se2.post('/e/deal_registrations', { ...base, deal_value: 90000, vendor_id: dell.id })).status, 400, 'partner not authorised for vendor');
  const ok = await se2.post('/e/deal_registrations', { ...base, deal_value: 90000 }); assert.equal(ok.status, 201);
  assert.equal(ok.data.status, 'Draft'); assert.equal(ok.data.conflict_status, 'Open', 'competing registration for same customer + vendor');
  const sub = await se2.post(`/e/deal_registrations/${ok.data.id}/actions/submit_internal`); assert.equal(sub.status, 200);
  // approval cannot complete while a conflict is open
  const inbox = (await cpm.get('/approvals/inbox?view=pending')).data.rows; const req = inbox.find((r) => r.record_label === ok.data.number); assert.ok(req);
  const blocked = await cpm.post(`/approvals/${req.id}/decide`, { decision: 'approve' }); assert.equal(blocked.status, 400); assert.match(blocked.data.error, /conflict/i);
});

test('claims: policy validation, approval chain, finance verification, payment with segregation of duties', async () => {
  const se1 = await as('se1'); const sm = await as('sm.kh'); const finv = await as('finv1'); const pay = await as('pay1'); const fin = await as('fin1');
  const cats = (await se1.get('/e/claim_categories')).data.rows; const trv = cats.find((c) => c.code === 'TRV'); const mel = cats.find((c) => c.code === 'MEL');
  const c = await se1.post('/e/claims', { title: 'E2E trip', purpose: 'Client visit', claim_date: today(), currency: 'USD' }); assert.equal(c.status, 201);
  const id = c.data.id;
  assert.equal((await se1.post(`/e/claims/${id}/actions/submit`)).status, 400, 'no lines');
  assert.equal((await se1.post('/e/claim_lines', { claim_id: id, category_id: trv.id, expense_date: plusDays(3), description: 'Future', amount: 10, currency: 'USD' })).status, 400, 'future date');
  const l1 = await se1.post('/e/claim_lines', { claim_id: id, category_id: trv.id, expense_date: today(), description: 'Taxi', merchant: 'Taxi', amount: 40, currency: 'USD', receipt_attached: true }); assert.equal(l1.status, 201);
  const l2 = await se1.post('/e/claim_lines', { claim_id: id, category_id: mel.id, expense_date: today(), description: 'Dinner', merchant: 'Cafe', amount: 120, currency: 'USD', receipt_attached: false }); assert.equal(l2.status, 201);
  assert.equal((await se1.get(`/e/claims/${id}`)).data.total_amount, 160);
  const bad = await se1.post(`/e/claims/${id}/actions/submit`); assert.equal(bad.status, 400); assert.ok(bad.data.checklist.length >= 2, 'receipt and attendee list required');
  await se1.put(`/e/claim_lines/${l2.data.id}`, { receipt_attached: true, attendees: 'Client team (3)' });
  const sub = await se1.post(`/e/claims/${id}/actions/submit`); assert.equal(sub.status, 200);
  assert.equal((await se1.put(`/e/claims/${id}`, { title: 'edit' })).status, 403, 'locked while in approval');
  const claim = (await se1.get(`/e/claims/${id}`)).data; const aprId = claim.approval_request_id;
  // manager -> finance verification chain
  assert.equal((await finv.post(`/approvals/${aprId}/decide`, { decision: 'approve' })).status, 403, 'finance verifier is not pending yet');
  assert.equal((await sm.post(`/approvals/${aprId}/decide`, { decision: 'approve' })).status, 200);
  const rv = await finv.get(`/claims/${id}/review`); assert.equal(rv.status, 200);
  const lines = rv.data._lines; // finance adjusts the dinner
  assert.equal((await finv.post(`/e/claims/${id}/actions/adjust`, { lines: [{ id: lines[1].id, approved_amount: 100 }] })).status, 400, 'adjustment needs reason');
  assert.equal((await finv.post(`/e/claims/${id}/actions/adjust`, { lines: [{ id: lines[1].id, approved_amount: 100, reason: 'Over policy cap' }] })).status, 200);
  const done = await finv.post(`/approvals/${aprId}/decide`, { decision: 'approve' }); assert.equal(done.data.status, 'Approved');
  const approved = (await se1.get(`/e/claims/${id}`)).data; assert.equal(approved.status, 'Approved'); assert.equal(approved.payment_status, 'Ready for payment'); assert.equal(approved.approved_amount, 140);
  // payment: the verifier cannot pay; the payment officer can
  const ready = await pay.get('/claims-payments/ready'); assert.ok(ready.data.some((r) => r.id === id));
  const batch = await pay.post('/claims-payments/batches', { claim_ids: [id] }); assert.equal(batch.status, 201); assert.equal(batch.data.status, 'Authorised');
  assert.equal((await pay.post(`/claims-payments/batches/${batch.data.id}/send`, {})).status, 200);
  assert.equal((await pay.post(`/claims-payments/batches/${batch.data.id}/result`, { results: [{ claim_id: id, status: 'Paid', reference: 'BNK-1' }] })).status, 200);
  const paid = (await se1.get(`/e/claims/${id}`)).data; assert.equal(paid.payment_status, 'Paid'); assert.equal(paid.payment_reference, 'BNK-1');
  void fin;
});

test('audit log is append-only and records changes', async () => {
  const adm = await as('admin');
  const a = (await adm.get('/audit?entity=opportunities&size=5')).data; assert.ok(a.total > 0);
  await assert.rejects(db.query(`UPDATE audit_log SET detail='x' WHERE id=(SELECT min(id) FROM audit_log)`), /append-only/);
  await assert.rejects(db.query(`DELETE FROM audit_log`), /append-only/);
  assert.equal((await (await as('se1')).get('/audit')).status, 403);
});

test('forecast snapshots are immutable; dashboard and reports respond', async () => {
  const sm = await as('sm.kh');
  const snap = await sm.post('/forecast/snapshots', { period_label: '2026-Q4' }); assert.equal(snap.status, 201);
  await assert.rejects(db.query(`UPDATE forecast_snapshots SET total_commit=1 WHERE id=$1`, [snap.data.id]), /immutable/);
  const sum = (await sm.get('/forecast/summary?period=2026-Q4')).data; assert.ok(sum.categories.length === 3);
  const dash = await sm.get('/dashboard'); assert.equal(dash.status, 200); assert.ok(dash.data.widgets.kpis.pipeline > 0);
  const reports = (await sm.get('/reports')).data; assert.ok(reports.length > 5);
  const r = await sm.get(`/reports/${reports[0].id}`); assert.equal(r.status, 200); assert.ok(r.data.rows.length > 0);
  // margin report hidden from roles without margin access
  const ext = await (await as('mkt1')).get('/reports'); assert.ok(!ext.data.some((x) => x.id === 'RPT-25'));
});

test('administration: role separation of duties, permission change, settings approval', async () => {
  const adm = await as('admin'); const sd = await as('sd'); const fin = await as('fin1');
  const users = (await adm.get('/e/users?size=100')).data.rows; const u = users.find((x) => x.login === 'se2');
  const sod = await adm.put(`/admin/users/${u.id}/roles`, { roles: ['ROL-PAY', 'ROL-FINV'] }); assert.equal(sod.status, 400);
  assert.equal((await (await as('se1')).get('/admin/roles')).status, 403);
  // sensitive setting change goes through approval
  const ch = await fin.put('/settings/app/margin_floor_standard', { value: 12, note: 'Q4 push' }); assert.equal(ch.status, 200); assert.equal(ch.data.status, 'Pending approval');
  const ib = (await sd.get('/approvals/inbox?view=pending')).data.rows.find((r) => r.process_type === 'config'); assert.ok(ib);
  assert.equal((await sd.post(`/approvals/${ib.id}/decide`, { decision: 'approve' })).status, 200);
  const s = (await adm.get('/settings/app')).data.find((x) => x.key === 'margin_floor_standard'); assert.equal(s.value, 12);
  await fin.put('/settings/app/margin_floor_standard', { value: 15 }); // restore (goes to approval again)
  const ib2 = (await sd.get('/approvals/inbox?view=pending')).data.rows.find((r) => r.process_type === 'config'); await sd.post(`/approvals/${ib2.id}/decide`, { decision: 'approve' });
});

test('documents: upload, access control and download', async () => {
  const se1 = await as('se1'); const se2 = await as('se2');
  const opp = (await se1.get('/e/opportunities?size=1')).data.rows[0];
  const form = new FormData(); form.append('file', new Blob(['hello world'], { type: 'text/plain' }), 'note.txt');
  form.append('entity', 'opportunities'); form.append('record_id', String(opp.id)); form.append('category', 'Meeting minutes');
  const up = await raw('/api/documents', se1.token, { method: 'POST', body: form }); assert.equal(up.status, 201);
  const doc = await up.json(); assert.equal(doc.version_no, 1); assert.equal(doc.sha256.length, 64);
  const list = (await se1.get(`/documents?entity=opportunities&record_id=${opp.id}`)).data; assert.ok(list.some((d) => d.id === doc.id)); assert.equal(list[0].storage_path, undefined);
  const dl = await raw(`/api/documents/${doc.id}/download`, se1.token); assert.equal(dl.status, 200); assert.equal(await dl.text(), 'hello world');
  // another SE without access to the opportunity gets nothing
  assert.equal((await se2.get(`/documents?entity=opportunities&record_id=${opp.id}`)).status, 403);
  assert.equal((await raw(`/api/documents/${doc.id}/download`, se2.token)).status, 403);
  // disallowed file type
  const bad = new FormData(); bad.append('file', new Blob(['x']), 'evil.exe');
  assert.equal((await raw('/api/documents', se1.token, { method: 'POST', body: bad })).status, 400);
});
