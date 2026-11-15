'use strict';
// M13 / M14 - Versioned quotations, pricing & margin (BRULE-QUO-001..012, BRULE-PRC-*).
const express = require('express');
const PDFDocument = require('pdfkit');
const db = require('../db');
const A = require('../core/access');
const crud = require('../core/crud');
const hooks = require('../core/hooks');
const settings = require('../core/settings');
const fx = require('../core/fx');
const { audit } = require('../core/audit');
const { notify } = require('../core/notify');
const { nextNumber } = require('../core/numbering');
const { bad, forbidden, notFound, wrap, conflict } = require('../core/errors');
const { entities } = require('../entities');
const approvals = require('./approvals');

const router = express.Router();
entities.quotations.system = true;       // created/edited only through the quotation workflow endpoints

// --------------------------------------------------------------------- maths
const ZERO_DEC = new Set(['KHR', 'VND', 'JPY', 'KRW', 'IDR']);
const dpOf = (ccy) => (ZERO_DEC.has(ccy) ? 0 : 2);
const rnd = (n, dp) => { const f = 10 ** dp; return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f; };  // half-up

/** Calculates lines + header per BRULE-QUO-002. `lines` carry list_price, discount_pct, quantity, unit_cost(in cost currency) ... */
async function calculate(version, lines, c = db) {
  const ccy = version.currency; const dp = dpOf(ccy); const date = version.fx_date || new Date().toISOString().slice(0, 10);
  const out = [];
  for (const l of lines) {
    const qty = Number(l.quantity) || 0;
    const list = Number(l.list_price) || 0;
    const disc = Number(l.discount_pct) || 0;
    const unitDisc = list * disc / 100;
    const unsp = rnd(list - unitDisc, dp);
    const factor = l.term_months && l.billing_months ? Number(l.term_months) / Number(l.billing_months) : 1;
    const enp = rnd(unsp * qty * factor, dp);
    const costCcy = l.cost_currency || ccy;
    const rate = l.unit_cost != null && costCcy !== ccy ? await fx.rate(costCcy, ccy, date, c) : 1;
    const hasCost = l.unit_cost != null && l.unit_cost !== '';
    const unitCost = hasCost ? rnd(Number(l.unit_cost) * rate, 4) : null;
    const ec = hasCost ? rnd(unitCost * qty * factor, dp) : null;
    out.push({ ...l, quantity: qty, list_price: list, discount_pct: disc, unit_net: unsp, ext_net: enp, _unit_disc_total: unitDisc * qty * factor, ext_cost: ec, _factor: factor });
  }
  const inc = out.filter((l) => !l.optional || l.selected);
  let subtotal = inc.reduce((a, l) => a + l.ext_net, 0);
  // header discount: pro-rata over included lines, remainder to the largest line
  let headerDisc = 0;
  const hd = Number(version.header_discount_pct) || 0;
  if (hd > 0 && subtotal > 0) {
    headerDisc = rnd(subtotal * hd / 100, dp);
    let allocated = 0; let largest = inc[0];
    for (const l of inc) { const a = rnd(headerDisc * l.ext_net / subtotal, dp); l._hd = a; allocated += a; if (l.ext_net > largest.ext_net) largest = l; }
    largest._hd = rnd((largest._hd || 0) + (headerDisc - allocated), dp);
    for (const l of inc) l.ext_net = rnd(l.ext_net - (l._hd || 0), dp);
    subtotal = inc.reduce((a, l) => a + l.ext_net, 0);
  }
  let tax = 0; let cost = 0; let missingCost = false;
  for (const l of out) {
    const isInc = !l.optional || l.selected;
    l.tax_amount = isInc ? rnd(l.ext_net * (Number(l.tax_rate) || 0) / 100, dp) : 0;
    if (l.ext_cost == null) { l.line_gp = null; l.line_gm_pct = null; if (isInc) missingCost = true; }
    else { l.line_gp = rnd(l.ext_net - l.ext_cost, dp); l.line_gm_pct = l.ext_net > 0 ? (l.line_gp / l.ext_net) * 100 : null; }
    if (isInc) { tax += l.tax_amount; cost += l.ext_cost || 0; }
  }
  const gp = subtotal - cost;
  return {
    lines: out,
    totals: {
      subtotal: rnd(subtotal, dp), discount_total: rnd(inc.reduce((a, l) => a + l._unit_disc_total, 0) + headerDisc, dp), tax_total: rnd(tax, dp), grand_total: rnd(subtotal + tax, dp),
      total_cost: missingCost ? null : rnd(cost, dp), gross_profit: missingCost ? null : rnd(gp, dp), gm_pct: !missingCost && subtotal > 0 ? (gp / subtotal) * 100 : null, missing_cost: missingCost,
    },
  };
}

// ------------------------------------------------------------ price & cost lookup
async function lookupPricing(productId, ccy, qty, priceList = 'List', date = new Date().toISOString().slice(0, 10), c = db) {
  const { rows: p } = await c.query('SELECT * FROM products WHERE id=$1 AND is_deleted=false', [productId]);
  if (!p[0]) throw notFound('Product not found');
  const pr = p[0];
  let price = null;
  const { rows: pl } = await c.query(
    `SELECT price, currency FROM price_records WHERE product_id=$1 AND price_list=$2 AND is_deleted=false AND valid_from<=$3 AND (valid_to IS NULL OR valid_to>=$3) AND min_qty<=$4 ORDER BY (currency=$5) DESC, min_qty DESC, valid_from DESC LIMIT 1`,
    [productId, priceList, date, qty || 1, ccy]);
  if (pl[0]) price = pl[0].currency === ccy ? pl[0].price : pl[0].price * (await fx.rate(pl[0].currency, ccy, date, c));
  else price = pr.list_price * (pr.currency === ccy ? 1 : await fx.rate(pr.currency, ccy, date, c));
  const { rows: co } = await c.query(
    `SELECT * FROM cost_records WHERE product_id=$1 AND is_deleted=false AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>=$2) AND min_qty<=$3
     ORDER BY CASE cost_source WHEN 'Special bid' THEN 1 WHEN 'Vendor quote' THEN 2 WHEN 'Vendor price list' THEN 3 ELSE 4 END, valid_from DESC LIMIT 1`, [productId, date, qty || 1]);
  let cost = null;
  if (co[0]) cost = { unit_cost: co[0].cost, cost_currency: co[0].currency, cost_source: co[0].cost_source, cost_ref: co[0].vendor_ref, cost_valid_to: co[0].valid_to, vendor_quote_id: co[0].id };
  else if (pr.standard_cost != null) cost = { unit_cost: pr.standard_cost, cost_currency: pr.currency, cost_source: 'Standard', cost_ref: null, cost_valid_to: null };
  const { rows: tx } = pr.tax_code ? await c.query('SELECT rate FROM tax_codes WHERE code=$1 AND is_deleted=false', [pr.tax_code]) : { rows: [] };
  return { product: pr, list_price: rnd(price, dpOf(ccy)), cost, tax_code: pr.tax_code, tax_rate: tx[0] ? tx[0].rate : 0 };
}

router.get('/pricing/lookup', wrap(async (req, res) => {
  const ctx = req.ctx;
  if (!A.can(ctx, 'M13', 'V') && !A.can(ctx, 'M12', 'V')) throw forbidden();
  const r = await lookupPricing(Number(req.query.product_id), req.query.currency || 'USD', Number(req.query.qty) || 1, req.query.price_list || 'List');
  const canCost = A.fieldAccess(ctx, 'cost').view;
  res.json({ product_id: r.product.id, description: r.product.name, uom: r.product.uom, list_price: r.list_price, tax_code: r.tax_code, tax_rate: r.tax_rate, recurring: r.product.recurring,
    billing_months: r.product.recurring ? r.product.billing_months : null, term_months: r.product.recurring ? r.product.default_term_months : null,
    cost: canCost ? r.cost : (r.cost ? { cost_source: r.cost.cost_source } : null) });
}));

// ------------------------------------------------------------------- loaders
async function loadVersion(ctx, vid, action = 'V') {
  const { rows } = await db.query('SELECT v.*, q.opportunity_id, q.number AS q_number, q.owner_id AS q_owner, q.account_id, q.is_primary, q.country AS q_country FROM quotation_versions v JOIN quotations q ON q.id=v.quotation_id WHERE v.id=$1 AND q.is_deleted=false', [vid]);
  const v = rows[0]; if (!v) throw notFound('Quotation version not found');
  if (!A.can(ctx, 'M13', action)) throw forbidden();
  const q = await crud.loadOne(entities.quotations, v.quotation_id, ctx, action === 'V' ? 'V' : 'E');
  if (!q) throw (action === 'V' ? notFound('Quotation not found') : forbidden('You cannot modify this quotation'));
  return v;
}
async function linesOf(vid) { const { rows } = await db.query('SELECT * FROM quotation_lines WHERE version_id=$1 ORDER BY seq, id', [vid]); return rows; }

async function syncHeader(quotationId, c = db) {
  const { rows } = await c.query('SELECT * FROM quotation_versions WHERE quotation_id=$1 ORDER BY version_no DESC LIMIT 1', [quotationId]);
  const v = rows[0]; if (!v) return;
  await c.query('UPDATE quotations SET status=$2, current_version_no=$3, grand_total=$4, currency=$5, modified_at=now() WHERE id=$1', [quotationId, v.status, v.version_no, v.grand_total, v.currency]);
}

async function syncOpportunity(oppId, versionId, c = db) {
  const { rows } = await c.query(`SELECT v.*, q.is_primary FROM quotation_versions v JOIN quotations q ON q.id=v.quotation_id WHERE v.id=$1`, [versionId]);
  const v = rows[0];
  if (!v || !v.is_primary || !['Approved', 'Sent', 'Accepted'].includes(v.status)) return;
  const { rows: o } = await c.query('SELECT status FROM opportunities WHERE id=$1', [oppId]);
  if (!o[0] || ['Won', 'Lost', 'Cancelled'].includes(o[0].status)) return;
  const base = await fx.toBase(v.grand_total, v.currency, null, c);
  const costBase = v.total_cost != null ? await fx.toBase(v.total_cost, v.currency, null, c) : null;
  await c.query('UPDATE opportunities SET amount=$2, currency=$3, amount_base=$4, cost=$5, gross_profit=$6, modified_at=now() WHERE id=$1',
    [oppId, v.grand_total, v.currency, base, v.total_cost, costBase != null ? base - costBase : null]);
}

// ----------------------------------------------------------------- create
router.post('/quotations/create', wrap(async (req, res) => {
  const ctx = req.ctx; const b = req.body || {};
  if (!A.can(ctx, 'M13', 'C')) throw forbidden();
  const opp = await crud.loadOne(entities.opportunities, b.opportunity_id, ctx, 'V');
  if (!opp) throw notFound('Opportunity not found');
  if (['Won', 'Lost', 'Cancelled'].includes(opp.status)) throw bad('Cannot create quotations on a closed opportunity');
  const { rows: acc } = await db.query('SELECT id, country, status FROM accounts WHERE id=$1', [opp.account_id]);
  const country = opp.country || acc[0].country || 'XX';
  const ccy = b.currency || opp.currency || 'USD';
  const out = await db.tx(async (c) => {
    const number = await nextNumber(`Q-${country}`, c, 4);
    const { rows: ex } = await c.query('SELECT count(*)::int n FROM quotations WHERE opportunity_id=$1 AND is_deleted=false', [opp.id]);
    const { rows } = await c.query(`INSERT INTO quotations (number, owner_id, opportunity_id, account_id, addressee_contact_id, partner_id, option_label, is_primary, status, country, currency, current_version_no, turnaround_start, created_by, modified_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Draft',$9,$10,1,now(),$2,$2) RETURNING *`, [number, ctx.id, opp.id, opp.account_id, b.addressee_contact_id || null, b.partner_id || opp.primary_partner_id || null, b.option_label || null, ex[0].n === 0, country, ccy]);
    const q = rows[0];
    const date = new Date().toISOString().slice(0, 10);
    const validDays = await settings.get('quotation_validity_days', 30);
    const { rows: ve } = await c.query(`INSERT INTO quotation_versions (quotation_id, version_no, status, currency, fx_to_base, fx_date, price_list, valid_until, payment_terms, created_by, modified_by)
      VALUES ($1,1,'Draft',$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`, [q.id, ccy, await fx.rate(ccy, await settings.get('base_currency', 'USD'), date, c), date, b.price_list || 'List', new Date(Date.now() + validDays * 86400000).toISOString().slice(0, 10), '30 days net', ctx.id]);
    if (b.config_id) {   // BOM -> quotation lines (FR-SIZ)
      const { rows: bom } = await c.query('SELECT * FROM bom_lines WHERE config_id=$1 AND is_deleted=false ORDER BY id', [b.config_id]);
      let seq = 1;
      for (const bl of bom) {
        let l = { description: bl.description, quantity: bl.quantity, uom: bl.uom, optional: bl.optional, list_price: 0, section: bl.section };
        if (bl.product_id) { const p = await lookupPricing(bl.product_id, ccy, bl.quantity, 'List', date, c); l = { ...l, product_id: bl.product_id, list_price: p.list_price, tax_code: p.tax_code, tax_rate: p.tax_rate, ...(p.cost || {}), term_months: p.product.recurring ? p.product.default_term_months : null, billing_months: p.product.recurring ? p.product.billing_months : null }; }
        await c.query(`INSERT INTO quotation_lines (version_id, seq, section, product_id, description, quantity, uom, term_months, billing_months, list_price, discount_pct, cost_currency, unit_cost, cost_source, cost_ref, cost_valid_to, tax_code, tax_rate, optional, selected, vendor_quote_id, created_by, modified_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21)`,
          [ve[0].id, seq++, l.section, l.product_id || null, l.description, l.quantity, l.uom, l.term_months || null, l.billing_months || null, l.list_price, l.cost_currency || null, l.unit_cost ?? null, l.cost_source || null, l.cost_ref || null, l.cost_valid_to || null, l.tax_code || null, l.tax_rate || 0, !!l.optional, !l.optional, l.vendor_quote_id || null, ctx.id]);
      }
      await recalc(ve[0].id, c);
    }
    if (ex[0].n === 0) await c.query('UPDATE opportunities SET primary_quotation_id=$2 WHERE id=$1', [opp.id, q.id]);
    await audit(ctx, { event: 'create', entity: 'quotations', recordId: q.id, label: number }, c);
    return { id: q.id, version_id: ve[0].id, number };
  });
  res.status(201).json(out);
}));

async function recalc(vid, c = db) {
  const { rows: vr } = await c.query('SELECT * FROM quotation_versions WHERE id=$1', [vid]);
  const v = vr[0];
  const { rows: lines } = await c.query('SELECT * FROM quotation_lines WHERE version_id=$1 ORDER BY seq, id', [vid]);
  const r = await calculate(v, lines, c);
  for (const l of r.lines) await c.query('UPDATE quotation_lines SET unit_net=$2, ext_net=$3, ext_cost=$4, line_gp=$5, line_gm_pct=$6, tax_amount=$7 WHERE id=$1', [l.id, l.unit_net, l.ext_net, l.ext_cost, l.line_gp, l.line_gm_pct, l.tax_amount]);
  const t = r.totals;
  await c.query('UPDATE quotation_versions SET subtotal=$2, discount_total=$3, tax_total=$4, grand_total=$5, total_cost=$6, gross_profit=$7, gm_pct=$8, modified_at=now() WHERE id=$1', [vid, t.subtotal, t.discount_total, t.tax_total, t.grand_total, t.total_cost, t.gross_profit, t.gm_pct]);
  return r;
}

// -------------------------------------------------------------------- read
router.get('/quotations/:id/full', wrap(async (req, res) => {
  const ctx = req.ctx;
  const q = await crud.loadOne(entities.quotations, req.params.id, ctx);
  if (!q) throw notFound();
  const { rows: vs } = await db.query('SELECT * FROM quotation_versions WHERE quotation_id=$1 ORDER BY version_no DESC', [q.id]);
  const versions = vs.map((v) => A.maskRecord('quotation_versions', v, ctx));
  const cur = vs[0];
  const lines = (await linesOf(cur.id)).map((l) => A.maskRecord('quotation_lines', l, ctx));
  const { rows: op } = await db.query('SELECT id, number, name, stage, status, currency, country FROM opportunities WHERE id=$1', [q.opportunity_id]);
  const { rows: ac } = await db.query('SELECT id, legal_name, credit_blocked FROM accounts WHERE id=$1', [q.account_id]);
  let approval = null;
  if (cur.approval_request_id) { const { rows } = await db.query('SELECT id, number, status FROM approval_requests WHERE id=$1', [cur.approval_request_id]); approval = rows[0]; }
  const editable = cur.status === 'Draft' && A.can(ctx, 'M13', 'E') && !!(await crud.loadOne(entities.quotations, q.id, ctx, 'E'));
  res.json({
    quotation: q, opportunity: op[0], account: ac[0], versions, current: A.maskRecord('quotation_versions', cur, ctx), lines, approval,
    can: { edit: editable, submit: editable && A.can(ctx, 'M13', 'S'), revise: cur.status !== 'Draft' && A.can(ctx, 'M13', 'E'), send: cur.status === 'Approved' && A.can(ctx, 'M13', 'S'), accept: cur.status === 'Sent' && A.can(ctx, 'M13', 'E'),
      see_cost: A.fieldAccess(ctx, 'cost').view, edit_cost: A.fieldAccess(ctx, 'cost').edit, see_margin: A.fieldAccess(ctx, 'margin').view },
  });
}));
router.get('/quotation-versions/:vid', wrap(async (req, res) => {
  const v = await loadVersion(req.ctx, req.params.vid, 'V');
  const lines = (await linesOf(v.id)).map((l) => A.maskRecord('quotation_lines', l, req.ctx));
  res.json({ version: A.maskRecord('quotation_versions', v, req.ctx), lines });
}));

router.put('/quotations/:id/header', wrap(async (req, res) => {
  const ctx = req.ctx; const b = req.body || {};
  const q = await crud.loadOne(entities.quotations, req.params.id, ctx, 'E');
  if (!q || !A.can(ctx, 'M13', 'E')) throw forbidden();
  await db.query('UPDATE quotations SET option_label=COALESCE($2,option_label), addressee_contact_id=COALESCE($3,addressee_contact_id), partner_id=COALESCE($4,partner_id), modified_by=$5, modified_at=now(), version=version+1 WHERE id=$1', [q.id, b.option_label ?? null, b.addressee_contact_id ?? null, b.partner_id ?? null, ctx.id]);
  res.json({ ok: true });
}));

// ------------------------------------------------------------- save draft
const LINE_BASE = ['section', 'product_id', 'description', 'quantity', 'uom', 'term_months', 'billing_months', 'list_price', 'discount_pct', 'tax_code', 'tax_rate', 'optional', 'selected', 'alt_group', 'zero_price_reason'];
const LINE_COST = ['unit_cost', 'cost_currency', 'cost_source', 'cost_ref', 'cost_valid_to', 'vendor_quote_id'];

router.put('/quotation-versions/:vid', wrap(async (req, res) => {
  const ctx = req.ctx; const b = req.body || {};
  const v = await loadVersion(ctx, req.params.vid, 'E');
  if (v.status !== 'Draft') throw forbidden('Issued versions cannot be modified. Create a revision. (BRULE-QUO-005)');
  if (b.version != null && Number(b.version) !== undefined && b.updated_at && new Date(b.updated_at).getTime() !== new Date(v.modified_at).getTime()) throw conflict('This quotation was changed by another user. Reload and try again.', { code: 'STALE' });
  const canCost = A.fieldAccess(ctx, 'cost').edit;
  const result = await db.tx(async (c) => {
    const hdr = {};
    for (const k of ['valid_until', 'payment_terms', 'delivery_terms', 'customer_notes', 'header_discount_pct', 'price_list', 'internal_notes']) if (k in b) hdr[k] = b[k] === '' ? null : b[k];
    if (b.currency && b.currency !== v.currency) { hdr.currency = b.currency; hdr.fx_to_base = await fx.rate(b.currency, await settings.get('base_currency', 'USD'), null, c); }
    if (hdr.header_discount_pct != null && (Number(hdr.header_discount_pct) < 0 || Number(hdr.header_discount_pct) > 100)) throw bad('Header discount must be between 0 and 100');
    if (hdr.valid_until && hdr.valid_until < new Date().toISOString().slice(0, 10)) throw bad('Validity date cannot be in the past (BRULE-QUO-006)');
    const keys = Object.keys(hdr);
    if (keys.length) await c.query(`UPDATE quotation_versions SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')}, modified_by=${ctx.id}, modified_at=now() WHERE id=$1`, [v.id, ...keys.map((k) => hdr[k])]);
    if (Array.isArray(b.lines)) {
      const ccy = hdr.currency || v.currency; const plist = hdr.price_list || v.price_list;
      const { rows: old } = await c.query('SELECT * FROM quotation_lines WHERE version_id=$1', [v.id]);
      const oldById = Object.fromEntries(old.map((o) => [o.id, o]));
      await c.query('DELETE FROM quotation_lines WHERE version_id=$1', [v.id]);
      let seq = 0;
      for (const l of b.lines) {
        seq++;
        const row = {};
        for (const k of LINE_BASE) row[k] = l[k] === '' ? null : l[k];
        if (!row.description && !row.product_id) throw bad(`Line ${seq}: description or product is required`);
        const prev = l.id ? oldById[l.id] : null;
        if (row.product_id && (row.list_price == null || row.list_price === '')) {
          const p = await lookupPricing(row.product_id, ccy, row.quantity || 1, plist, null, c);
          row.list_price = p.list_price; row.description = row.description || p.product.name; row.tax_code = row.tax_code ?? p.tax_code; row.tax_rate = row.tax_rate ?? p.tax_rate; row.uom = row.uom || p.product.uom;
          if (p.product.recurring) { row.term_months = row.term_months || p.product.default_term_months; row.billing_months = row.billing_months || p.product.billing_months; }
        }
        // costs: editable only by authorised roles; otherwise preserved / looked up from the catalogue (BRD 7.6)
        let cost = {};
        if (canCost && 'unit_cost' in l) for (const k of LINE_COST) cost[k] = l[k] === '' ? null : l[k];
        else if (prev && prev.product_id === row.product_id) for (const k of LINE_COST) cost[k] = prev[k];
        else if (row.product_id) { const p = await lookupPricing(row.product_id, ccy, row.quantity || 1, plist, null, c); cost = p.cost || {}; }
        if (row.quantity == null || !(Number(row.quantity) > 0)) throw bad(`Line ${seq}: quantity must be greater than zero`);
        if (row.list_price == null || Number(row.list_price) < 0) throw bad(`Line ${seq}: price must be zero or positive`);
        if (row.discount_pct != null && (Number(row.discount_pct) < 0 || Number(row.discount_pct) > 100)) throw bad(`Line ${seq}: discount must be between 0 and 100`);
        const sel = row.optional ? !!row.selected : true;
        await c.query(`INSERT INTO quotation_lines (version_id, seq, section, product_id, description, quantity, uom, term_months, billing_months, list_price, discount_pct, tax_code, tax_rate, optional, selected, alt_group, zero_price_reason,
            cost_currency, unit_cost, cost_source, cost_ref, cost_valid_to, vendor_quote_id, created_by, modified_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$24)`,
          [v.id, seq, row.section, row.product_id, row.description, row.quantity, row.uom, row.term_months, row.billing_months, row.list_price, row.discount_pct || 0, row.tax_code, row.tax_rate || 0, !!row.optional, sel, row.alt_group, row.zero_price_reason,
            cost.cost_currency || null, cost.unit_cost ?? null, cost.cost_source || null, cost.cost_ref || null, cost.cost_valid_to || null, cost.vendor_quote_id || null, ctx.id]);
      }
    }
    const r = await recalc(v.id, c);
    await syncHeader(v.quotation_id, c);
    await audit(ctx, { event: 'update', entity: 'quotation_versions', recordId: v.id, label: `${v.q_number} v${v.version_no}`, detail: 'draft saved' }, c);
    return r;
  });
  const lines = (await linesOf(v.id)).map((l) => A.maskRecord('quotation_lines', l, ctx));
  const { rows } = await db.query('SELECT * FROM quotation_versions WHERE id=$1', [v.id]);
  res.json({ version: A.maskRecord('quotation_versions', rows[0], ctx), lines, totals: A.fieldAccess(ctx, 'margin').view ? result.totals : { subtotal: result.totals.subtotal, tax_total: result.totals.tax_total, grand_total: result.totals.grand_total, discount_total: result.totals.discount_total } });
}));

// ------------------------------------------------------------------ submit
const STD_TERMS = ['30 days net', '14 days net', '7 days net', 'Cash on delivery', 'Advance payment'];
router.post('/quotation-versions/:vid/submit', wrap(async (req, res) => {
  const ctx = req.ctx;
  if (!A.can(ctx, 'M13', 'S')) throw forbidden();
  const v = await loadVersion(ctx, req.params.vid, 'E');
  if (v.status !== 'Draft') throw bad(`Version is ${v.status}`);
  const lines = await linesOf(v.id);
  const issues = [];
  const included = lines.filter((l) => !l.optional || l.selected);
  if (!included.length) issues.push('The quotation needs at least one included line (BRULE-QUO-003)');
  for (const l of included) {
    if (!(l.quantity > 0)) issues.push(`Line ${l.seq}: quantity must be > 0`);
    if (l.list_price == null || l.list_price < 0) issues.push(`Line ${l.seq}: price must be ≥ 0`);
    if (l.unit_cost == null || !l.cost_source) issues.push(`Line ${l.seq} "${l.description}": cost and cost source are required`);
    if (Number(l.ext_net) === 0 && !l.zero_price_reason) issues.push(`Line ${l.seq}: a zero-price line needs a reason (e.g. free of charge)`);
  }
  const groups = {};
  for (const l of lines) if (l.alt_group && (!l.optional || l.selected)) groups[l.alt_group] = (groups[l.alt_group] || 0) + 1;
  for (const [g, n] of Object.entries(groups)) if (n > 1) issues.push(`Alternative group "${g}" has more than one selected line`);
  if (!v.valid_until || v.valid_until < new Date().toISOString().slice(0, 10)) issues.push('Validity date must be today or later (BRULE-QUO-006)');
  const { rows: ac } = await db.query('SELECT credit_blocked, status FROM accounts WHERE id=$1', [v.account_id]);
  if (ac[0] && ac[0].status === 'Blocked') issues.push('The customer account is blocked (BRULE-QUO-009)');
  if (issues.length) throw bad('Quotation cannot be submitted', { checklist: issues });

  const cr = await db.tx(async (c) => {
    const r = await recalc(v.id, c);
    const t = r.totals;
    const earliest = included.map((l) => l.cost_valid_to).filter(Boolean).sort()[0] || null;
    const maxDisc = Math.max(0, ...included.map((l) => Number(l.discount_pct) || 0), Number(v.header_discount_pct) || 0);
    const amountBase = await fx.toBase(t.grand_total, v.currency, null, c);
    const snapshot = { gm_pct: t.gm_pct == null ? null : Math.round(t.gm_pct * 100) / 100, total_cost: t.total_cost, gross_profit: t.gross_profit, grand_total: t.grand_total, amount_base: amountBase, max_discount_pct: maxDisc,
      payment_terms_nonstandard: !STD_TERMS.includes(v.payment_terms || ''), validity_beyond_cost: !!(earliest && v.valid_until > earliest), cost_expired: !!(earliest && earliest < new Date().toISOString().slice(0, 10)), currency: v.currency, country: v.q_country };
    const ev = await approvals.evaluate('quotation', snapshot, c);
    await c.query('UPDATE quotation_versions SET approval_required=$2, trigger_snapshot=$3, submitted_at=now(), earliest_cost_valid_to=$4, cost_expired=$5, modified_by=$6 WHERE id=$1', [v.id, ev.required, JSON.stringify(snapshot), earliest, snapshot.cost_expired, ctx.id]);
    if (!ev.required) {
      await c.query(`UPDATE quotation_versions SET status='Approved', approved_at=now() WHERE id=$1`, [v.id]);
      await audit(ctx, { event: 'auto_approved', entity: 'quotation_versions', recordId: v.id, label: `${v.q_number} v${v.version_no}`, detail: 'No approval rule triggered' }, c);
      await syncHeader(v.quotation_id, c); await syncOpportunity(v.opportunity_id, v.id, c);
      return { status: 'Approved', auto: true };
    }
    const sub = await approvals.submit(ctx, { type: 'quotation', entity: 'quotation_versions', recordId: v.id, label: `${v.q_number} v${v.version_no}`, amount: t.grand_total, currency: v.currency, snapshot, evaluation: ev, comment: req.body && req.body.comment }, c);
    await c.query(`UPDATE quotation_versions SET status='Submitted', approval_request_id=$2 WHERE id=$1`, [v.id, sub.request.id]);
    await syncHeader(v.quotation_id, c);
    return { status: 'Submitted', approval: sub.request.number, approval_id: sub.request.id, rules: A.fieldAccess(ctx, 'margin').view ? ev.rules : undefined };
  });
  res.json(cr);
}));

approvals.registerHandler('quotation', {
  async onApproved(ctx, req, info, c) {
    const { rows } = await c.query(`UPDATE quotation_versions SET status='Approved', approved_at=now() WHERE id=$1 RETURNING quotation_id, version_no`, [req.record_id]);
    await syncHeader(rows[0].quotation_id, c);
    const { rows: q } = await c.query('SELECT opportunity_id FROM quotations WHERE id=$1', [rows[0].quotation_id]);
    await syncOpportunity(q[0].opportunity_id, req.record_id, c);
  },
  async onRejected(ctx, req, info, c) { const { rows } = await c.query(`UPDATE quotation_versions SET status='Rejected', cancel_reason=$2 WHERE id=$1 RETURNING quotation_id`, [req.record_id, info.reason]); await syncHeader(rows[0].quotation_id, c); },
  async onReturned(ctx, req, info, c) { const { rows } = await c.query(`UPDATE quotation_versions SET status='Draft' WHERE id=$1 RETURNING quotation_id`, [req.record_id]); await syncHeader(rows[0].quotation_id, c); },
  async onWithdrawn(ctx, req, info, c) { const { rows } = await c.query(`UPDATE quotation_versions SET status='Draft' WHERE id=$1 RETURNING quotation_id`, [req.record_id]); await syncHeader(rows[0].quotation_id, c); },
});

// ------------------------------------------------------------ lifecycle actions
router.post('/quotation-versions/:vid/revise', wrap(async (req, res) => {
  const ctx = req.ctx;
  const v = await loadVersion(ctx, req.params.vid, 'E');
  const { rows: latest } = await db.query('SELECT * FROM quotation_versions WHERE quotation_id=$1 ORDER BY version_no DESC LIMIT 1', [v.quotation_id]);
  if (latest[0].status === 'Draft') throw bad('A draft version already exists (BRULE-QUO-004)');
  if (v.id !== latest[0].id) throw bad('Only the latest version can be revised');
  const out = await db.tx(async (c) => {
    const n = v.version_no + 1;
    const { rows } = await c.query(`INSERT INTO quotation_versions (quotation_id, version_no, status, currency, fx_to_base, fx_date, price_list, valid_until, payment_terms, delivery_terms, customer_notes, internal_notes, header_discount_pct, created_by, modified_by)
      SELECT quotation_id, $2, 'Draft', currency, fx_to_base, current_date, price_list, GREATEST(valid_until, current_date + 7), payment_terms, delivery_terms, customer_notes, internal_notes, header_discount_pct, $3, $3 FROM quotation_versions WHERE id=$1 RETURNING id`, [v.id, n, ctx.id]);
    await c.query(`INSERT INTO quotation_lines (version_id, seq, section, product_id, description, quantity, uom, term_months, billing_months, list_price, discount_pct, unit_net, ext_net, cost_currency, unit_cost, cost_source, cost_ref, cost_valid_to, ext_cost, line_gp, line_gm_pct, tax_code, tax_rate, tax_amount, optional, selected, alt_group, vendor_quote_id, created_by, modified_by)
      SELECT $2, seq, section, product_id, description, quantity, uom, term_months, billing_months, list_price, discount_pct, unit_net, ext_net, cost_currency, unit_cost, cost_source, cost_ref, cost_valid_to, ext_cost, line_gp, line_gm_pct, tax_code, tax_rate, tax_amount, optional, selected, alt_group, vendor_quote_id, $3, $3 FROM quotation_lines WHERE version_id=$1`, [v.id, rows[0].id, ctx.id]);
    if (['Submitted'].includes(v.status)) { await approvals.invalidateFor('quotation_versions', v.id, 'Superseded by a revision', c); }
    if (v.status !== 'Accepted') await c.query(`UPDATE quotation_versions SET status='Superseded' WHERE id=$1 AND status NOT IN ('Rejected','Cancelled','Expired')`, [v.id]);
    await recalc(rows[0].id, c);
    await syncHeader(v.quotation_id, c);
    await audit(ctx, { event: 'revise', entity: 'quotations', recordId: v.quotation_id, label: v.q_number, detail: `v${v.version_no} -> v${n}` }, c);
    return { version_id: rows[0].id, version_no: n };
  });
  res.status(201).json(out);
}));

router.post('/quotation-versions/:vid/send', wrap(async (req, res) => {
  const ctx = req.ctx;
  if (!A.can(ctx, 'M13', 'S')) throw forbidden();
  const v = await loadVersion(ctx, req.params.vid, 'E');
  if (v.status !== 'Approved') throw bad('Only an approved version can be issued (BRULE-QUO-009)');
  if (v.valid_until < new Date().toISOString().slice(0, 10)) throw bad('The quotation has expired. Extend validity or create a revision.');
  const { rows: ac } = await db.query('SELECT status, credit_blocked FROM accounts WHERE id=$1', [v.account_id]);
  if (ac[0] && (ac[0].status === 'Blocked' || ac[0].credit_blocked) && !A.roleHas(ctx, 'ROL-FIN', 'ROL-ADM')) throw forbidden('The customer is credit-blocked. Finance must release the quotation (BRULE-QUO-009).');
  await db.tx(async (c) => {
    await c.query(`UPDATE quotation_versions SET status='Sent', sent_at=now(), issue_date=current_date WHERE id=$1`, [v.id]);
    await syncHeader(v.quotation_id, c);
    await syncOpportunity(v.opportunity_id, v.id, c);
    await c.query(`INSERT INTO integration_logs (integration_code, direction, entity, record_id, status, attempts, idempotency_key, payload) VALUES ('INT-01','Outbound','quotation_versions',$1,'Pending',0,$2,$3) ON CONFLICT (idempotency_key) DO NOTHING`,
      [v.id, `INT-01-qv-${v.id}-sent`, JSON.stringify({ to: req.body && req.body.recipients, message: req.body && req.body.message })]);
    await audit(ctx, { event: 'quotation_sent', entity: 'quotation_versions', recordId: v.id, label: `${v.q_number} v${v.version_no}`, detail: (req.body && req.body.recipients) || '' }, c);
  });
  res.json({ ok: true, status: 'Sent' });
}));

router.post('/quotation-versions/:vid/accept', wrap(async (req, res) => {
  const ctx = req.ctx; const b = req.body || {};
  const v = await loadVersion(ctx, req.params.vid, 'E');
  if (v.status !== 'Sent') throw bad('Only a sent version can be accepted');
  if (!b.po_reference) throw bad('Customer PO / acceptance reference is required');
  const { rows } = await db.query(`SELECT 1 FROM quotation_versions v JOIN quotations q ON q.id=v.quotation_id WHERE q.opportunity_id=$1 AND v.status='Accepted' AND v.id<>$2`, [v.opportunity_id, v.id]);
  if (rows.length) throw conflict('Another version is already accepted for this opportunity. Cancel it first with a reason (BRULE-QUO-010).');
  await db.tx(async (c) => {
    await c.query(`UPDATE quotation_versions SET status='Accepted', accepted_at=now(), po_reference=$2, po_date=$3 WHERE id=$1`, [v.id, b.po_reference, b.po_date || new Date().toISOString().slice(0, 10)]);
    await syncHeader(v.quotation_id, c);
    await c.query('UPDATE opportunities SET po_number=COALESCE(po_number,$2), po_date=COALESCE(po_date,$3) WHERE id=$1', [v.opportunity_id, b.po_reference, b.po_date || new Date().toISOString().slice(0, 10)]);
    await audit(ctx, { event: 'quotation_accepted', entity: 'quotation_versions', recordId: v.id, label: `${v.q_number} v${v.version_no}`, detail: b.po_reference }, c);
  });
  res.json({ ok: true });
}));
router.post('/quotation-versions/:vid/decline', wrap(async (req, res) => {
  const v = await loadVersion(req.ctx, req.params.vid, 'E');
  if (!['Sent', 'Approved'].includes(v.status)) throw bad('Only approved or sent versions can be declined');
  if (!req.body.reason) throw bad('A reason is required');
  await db.tx(async (c) => { await c.query(`UPDATE quotation_versions SET status='Cancelled', cancel_reason=$2 WHERE id=$1`, [v.id, req.body.reason]); await syncHeader(v.quotation_id, c); await audit(req.ctx, { event: 'quotation_declined', entity: 'quotation_versions', recordId: v.id, label: `${v.q_number} v${v.version_no}`, detail: req.body.reason }, c); });
  res.json({ ok: true });
}));
router.post('/quotation-versions/:vid/extend', wrap(async (req, res) => {
  const ctx = req.ctx;
  const v = await loadVersion(ctx, req.params.vid, 'E');
  const nv = req.body.valid_until; if (!nv || nv <= v.valid_until) throw bad('New validity must be later than the current validity');
  if (!['Approved', 'Sent', 'Expired'].includes(v.status)) throw bad('Only approved/sent/expired versions can be extended');
  const days = (new Date(nv) - new Date(v.valid_until)) / 86400000;
  const maxExt = await settings.get('quotation_extension_days', 30);
  const costOk = !v.earliest_cost_valid_to || v.earliest_cost_valid_to >= nv;
  if ((days > maxExt || !costOk) && !A.roleHas(ctx, 'ROL-FIN', 'ROL-SM', 'ROL-CM', 'ROL-ADM')) throw forbidden(`Extending beyond ${maxExt} days or beyond cost validity needs Finance / manager approval (BRULE-QUO-011)`);
  await db.tx(async (c) => {
    await c.query(`UPDATE quotation_versions SET valid_until=$2, status=CASE WHEN status='Expired' THEN 'Sent' ELSE status END WHERE id=$1`, [v.id, nv]);
    await syncHeader(v.quotation_id, c);
    await audit(ctx, { event: 'quotation_extended', entity: 'quotation_versions', recordId: v.id, label: `${v.q_number} v${v.version_no}`, changes: { valid_until: [v.valid_until, nv] }, detail: req.body.reason }, c);
  });
  res.json({ ok: true });
}));
router.post('/quotations/:id/set-primary', wrap(async (req, res) => {
  const ctx = req.ctx;
  const q = await crud.loadOne(entities.quotations, req.params.id, ctx, 'E');
  if (!q || !A.can(ctx, 'M13', 'E')) throw forbidden();
  await db.tx(async (c) => {
    await c.query('UPDATE quotations SET is_primary=(id=$1) WHERE opportunity_id=$2', [q.id, q.opportunity_id]);
    await c.query('UPDATE opportunities SET primary_quotation_id=$1 WHERE id=$2', [q.id, q.opportunity_id]);
    const { rows } = await c.query(`SELECT id FROM quotation_versions WHERE quotation_id=$1 AND status IN ('Approved','Sent','Accepted') ORDER BY version_no DESC LIMIT 1`, [q.id]);
    if (rows[0]) await syncOpportunity(q.opportunity_id, rows[0].id, c);
    await audit(ctx, { event: 'set_primary', entity: 'quotations', recordId: q.id, label: q.number }, c);
  });
  res.json({ ok: true });
}));
router.delete('/quotations/:id', wrap(async (req, res) => {
  const q = await crud.loadOne(entities.quotations, req.params.id, req.ctx, 'D');
  if (!q || !A.can(req.ctx, 'M13', 'D')) throw forbidden();
  const { rows } = await db.query(`SELECT 1 FROM quotation_versions WHERE quotation_id=$1 AND status NOT IN ('Draft','Cancelled','Rejected')`, [q.id]);
  if (rows.length) throw forbidden('Quotations that went through approval cannot be deleted; cancel them instead (numbers are never reused)');
  await db.query(`UPDATE quotations SET is_deleted=true, deleted_at=now(), deleted_by=$2, status='Cancelled' WHERE id=$1`, [q.id, req.ctx.id]);
  await audit(req.ctx, { event: 'delete', entity: 'quotations', recordId: q.id, label: q.number });
  res.json({ ok: true });
}));

// -------------------------------------------------------------------- PDF
router.get('/quotation-versions/:vid/pdf', wrap(async (req, res) => {
  const ctx = req.ctx;
  const v = await loadVersion(ctx, req.params.vid, 'V');
  const lines = (await linesOf(v.id)).filter((l) => !l.optional || l.selected);
  const { rows: ac } = await db.query('SELECT a.legal_name, a.address, a.city, a.country FROM accounts a WHERE a.id=$1', [v.account_id]);
  const { rows: ow } = await db.query('SELECT name, email, phone FROM users WHERE id=$1', [v.q_owner]);
  const company = await settings.get('company_name', 'Enterprise CRM Distribution Co.');
  const final = ['Approved', 'Sent', 'Accepted'].includes(v.status);
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${v.q_number}-v${v.version_no}.pdf"`);
  doc.pipe(res);
  const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: dpOf(v.currency), maximumFractionDigits: dpOf(v.currency) });
  doc.fontSize(18).fillColor('#0f2a4a').text(company, { continued: false });
  doc.fontSize(10).fillColor('#555').text('QUOTATION', { align: 'right' }).moveUp();
  doc.moveDown(1.5);
  doc.fontSize(11).fillColor('#000').text(`Quotation No: ${v.q_number}  (Version ${v.version_no})`);
  doc.text(`Date: ${v.issue_date || new Date().toISOString().slice(0, 10)}     Valid until: ${v.valid_until || '-'}`);
  doc.moveDown(0.5);
  doc.text(`To: ${ac[0] ? ac[0].legal_name : ''}`); if (ac[0] && ac[0].address) doc.text(`${ac[0].address}${ac[0].city ? ', ' + ac[0].city : ''}`);
  doc.text(`Prepared by: ${ow[0] ? ow[0].name : ''}${ow[0] && ow[0].email ? ' <' + ow[0].email + '>' : ''}`);
  doc.moveDown();
  const x = [48, 80, 290, 335, 405, 480]; let y = doc.y;
  doc.fontSize(9).fillColor('#fff').rect(48, y - 2, 499, 16).fill('#0f2a4a').fillColor('#fff');
  ['#', 'Description', 'Qty', 'Unit price', 'Total', ''].forEach((h, i) => { if (h) doc.text(h, x[i] + 2, y + 1, { width: i === 1 ? 200 : 70, align: i >= 2 ? 'right' : 'left' }); });
  y += 20; doc.fillColor('#000');
  for (const l of lines) {
    if (y > 700) { doc.addPage(); y = 60; }
    doc.fontSize(9).text(String(l.seq), x[0] + 2, y, { width: 28 });
    doc.text(l.description + (l.term_months ? ` (${l.term_months} months)` : ''), x[1] + 2, y, { width: 205 });
    const h = doc.heightOfString(l.description, { width: 205 });
    doc.text(String(l.quantity), x[2] + 2, y, { width: 40, align: 'right' }).text(money(l.unit_net), x[3] + 2, y, { width: 65, align: 'right' }).text(money(l.ext_net), x[4] + 2, y, { width: 70, align: 'right' });
    y += Math.max(14, h + 4);
  }
  doc.moveTo(48, y).lineTo(547, y).strokeColor('#ccc').stroke(); y += 8;
  const tot = (label, val, bold) => { doc.fontSize(bold ? 11 : 9).font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, 340, y, { width: 100, align: 'right' }).text(`${v.currency} ${money(val)}`, 445, y, { width: 100, align: 'right' }); y += bold ? 18 : 14; };
  tot('Subtotal', v.subtotal); if (v.discount_total) tot('Discount applied', v.discount_total); tot('Tax', v.tax_total); tot('Total', v.grand_total, true);
  doc.font('Helvetica').fontSize(9).moveDown(2);
  doc.text(`Payment terms: ${v.payment_terms || '-'}`, 48, y + 16); if (v.delivery_terms) doc.text(`Delivery terms: ${v.delivery_terms}`);
  if (v.customer_notes) { doc.moveDown(); doc.text(v.customer_notes); }
  if (!final) {     // BRULE-QUO-008: non-final PDFs are watermarked
    doc.save(); doc.rotate(-35, { origin: [300, 420] }); doc.fontSize(110).fillColor('#e03131').opacity(0.14).text('DRAFT', 110, 360); doc.restore(); doc.opacity(1);
  }
  doc.end();
  await audit(ctx, { event: 'pdf_generated', entity: 'quotation_versions', recordId: v.id, label: `${v.q_number} v${v.version_no}`, detail: final ? 'final' : 'draft watermark' });
}));

// -------------------------------------------------------------- line preview
router.post('/quotations/calculate', wrap(async (req, res) => {
  // pure calculation helper for the editor (no persistence); uses the same engine as the server
  const { currency = 'USD', header_discount_pct = 0, lines = [] } = req.body || {};
  const canCost = A.fieldAccess(req.ctx, 'cost').view;
  const r = await calculate({ currency, header_discount_pct }, lines);
  const showM = A.fieldAccess(req.ctx, 'margin').view;
  res.json({ lines: r.lines.map((l) => ({ unit_net: l.unit_net, ext_net: l.ext_net, tax_amount: l.tax_amount, ...(canCost ? { ext_cost: l.ext_cost } : {}), ...(showM ? { line_gp: l.line_gp, line_gm_pct: l.line_gm_pct } : {}) })),
    totals: showM ? r.totals : { subtotal: r.totals.subtotal, discount_total: r.totals.discount_total, tax_total: r.totals.tax_total, grand_total: r.totals.grand_total } });
}));

module.exports = { router, calculate, recalc, syncHeader, lookupPricing };
