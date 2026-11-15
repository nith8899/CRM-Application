import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, openAuthed } from '../api';
import { useToast } from '../state';
import { Alert, Badge, Card, ErrorBox, Modal, PageHead, Spinner } from '../components/ui';
import { Lookup } from '../components/fields';
import { fmtDate, fmtMoney, fmtPct, today } from '../util';

const emptyLine = () => ({ _k: Math.random().toString(36).slice(2), product_id: null, product_label: '', description: '', quantity: 1, uom: 'Each', list_price: 0, discount_pct: 0, tax_rate: 0, optional: false, selected: true });
const num = (v) => (v === '' || v == null ? 0 : Number(v));

export default function QuotationEditor() {
  const { id } = useParams(); const toast = useToast();
  const [data, setData] = useState(null); const [err, setErr] = useState(null); const [hdr, setHdr] = useState({}); const [lines, setLines] = useState([]); const [calc, setCalc] = useState(null);
  const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false); const [dlg, setDlg] = useState(null); const [actErr, setActErr] = useState(null); const [viewing, setViewing] = useState(null); const [old, setOld] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/quotations/${id}/full`);
      setData(d); setErr(null); setViewing(null); setOld(null);
      const v = d.current;
      setHdr({ currency: v.currency, valid_until: v.valid_until, payment_terms: v.payment_terms, delivery_terms: v.delivery_terms, price_list: v.price_list, header_discount_pct: v.header_discount_pct, customer_notes: v.customer_notes, internal_notes: v.internal_notes });
      setLines(d.lines.map((l) => ({ ...l, _k: `l${l.id}`, product_label: '' })));
      setDirty(false);
    } catch (e) { setErr(e); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const can = data?.can || {}; const editable = can.edit && !viewing;
  const show = viewing && old ? old : null;
  const cur = data?.current;
  const dispLines = show ? show.lines : lines;
  const dispVer = show ? show.version : cur;

  // live calculation through the same server engine
  const t = useRef(null);
  useEffect(() => {
    if (!data || !editable) return;
    clearTimeout(t.current);
    t.current = setTimeout(() => {
      api.post('/quotations/calculate', { currency: hdr.currency, header_discount_pct: num(hdr.header_discount_pct), lines: lines.map((l) => ({ quantity: num(l.quantity), list_price: num(l.list_price), discount_pct: num(l.discount_pct), term_months: l.term_months || null, billing_months: l.billing_months || null, unit_cost: l.unit_cost ?? null, cost_currency: l.cost_currency, tax_rate: num(l.tax_rate), optional: l.optional, selected: l.selected })) }).then(setCalc).catch(() => {});
    }, 350);
    return () => clearTimeout(t.current);
  }, [lines, hdr.currency, hdr.header_discount_pct, data, editable]);

  const setLine = (k, patch) => { setLines((ls) => ls.map((l) => (l._k === k ? { ...l, ...patch } : l))); setDirty(true); };
  const pickProduct = async (k, pid, label, qty) => {
    if (!pid) { setLine(k, { product_id: null, product_label: '' }); return; }
    try {
      const r = await api.get(`/pricing/lookup?product_id=${pid}&currency=${hdr.currency}&qty=${qty || 1}&price_list=${hdr.price_list || 'List'}`);
      setLine(k, { product_id: pid, product_label: label, description: r.description, uom: r.uom, list_price: r.list_price, tax_code: r.tax_code, tax_rate: r.tax_rate, term_months: r.term_months, billing_months: r.billing_months, ...(r.cost && r.cost.unit_cost != null ? { unit_cost: r.cost.unit_cost, cost_currency: r.cost.cost_currency, cost_source: r.cost.cost_source, cost_ref: r.cost.cost_ref, cost_valid_to: r.cost.cost_valid_to, vendor_quote_id: r.cost.vendor_quote_id } : {}) });
    } catch (e) { toast(e.message, 'error'); }
  };
  const payloadLines = () => lines.map((l) => { const o = { id: l.id, section: l.section, product_id: l.product_id, description: l.description, quantity: num(l.quantity), uom: l.uom, term_months: l.term_months || null, billing_months: l.billing_months || null, list_price: num(l.list_price), discount_pct: num(l.discount_pct), tax_code: l.tax_code, tax_rate: num(l.tax_rate), optional: !!l.optional, selected: !!l.selected, alt_group: l.alt_group, zero_price_reason: l.zero_price_reason };
    if (can.edit_cost) Object.assign(o, { unit_cost: l.unit_cost, cost_currency: l.cost_currency, cost_source: l.cost_source, cost_ref: l.cost_ref, cost_valid_to: l.cost_valid_to, vendor_quote_id: l.vendor_quotes_id || l.vendor_quote_id });
    return o; });
  const save = async (quiet) => {
    setBusy(true); setActErr(null);
    try { await api.put(`/quotation-versions/${cur.id}`, { ...hdr, header_discount_pct: num(hdr.header_discount_pct), lines: payloadLines() }); if (!quiet) toast('Draft saved', 'success'); await load(); return true; }
    catch (e) { setActErr(e); return false; } finally { setBusy(false); }
  };
  const run = async (fn, okMsg) => { setBusy(true); setActErr(null); try { const r = await fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'success'); await load(); return r; } catch (e) { setActErr(e); } finally { setBusy(false); } };
  const submit = async () => { if (dirty && !(await save(true))) return; await run(() => api.post(`/quotation-versions/${cur.id}/submit`), (r) => (r.auto ? 'Approved automatically — no approval rule triggered' : `Submitted for approval (${r.approval})`)); };
  const viewVersion = async (v) => { if (v.id === cur.id) { setViewing(null); setOld(null); return; } setViewing(v.id); setOld(await api.get(`/quotation-versions/${v.id}`)); };

  if (err) return <ErrorBox error={err} />; if (!data) return <Spinner />;
  const q = data.quotation; const totals = calc?.totals || { subtotal: cur.subtotal, discount_total: cur.discount_total, tax_total: cur.tax_total, grand_total: cur.grand_total, total_cost: cur.total_cost, gross_profit: cur.gross_profit, gm_pct: cur.gm_pct };
  const shown = editable ? totals : (dispVer);
  const calcLine = (i) => (editable && calc ? calc.lines[i] : null);
  const ccy = (dispVer.currency) || hdr.currency;
  const gmWarn = can.see_margin && shown.gm_pct != null && shown.gm_pct < 15;

  return (
    <>
      <PageHead title={<>{q.number} <Badge v={dispVer.status} /> {q.is_primary && <Badge v="Active">primary</Badge>}</>} sub={<>Version {dispVer.version_no} · <Link to={`/opportunities/${data.opportunity.id}`}>{data.opportunity.number} {data.opportunity.name}</Link> · <Link to={`/accounts/${data.account.id}`}>{data.account.legal_name}</Link></>}>
        <button className="btn" onClick={() => openAuthed(`/quotation-versions/${dispVer.id}/pdf`).catch((e) => toast(e.message, 'error'))}>PDF preview</button>
        {!q.is_primary && <button className="btn" onClick={() => run(() => api.post(`/quotations/${q.id}/set-primary`), 'Set as primary quotation')}>Set primary</button>}
        {editable && <button className="btn" disabled={busy || !dirty} onClick={() => save()}>Save draft</button>}
        {editable && can.submit && <button className="btn primary" disabled={busy} onClick={submit}>Submit for approval</button>}
        {can.revise && !viewing && <button className="btn" disabled={busy} onClick={() => run(() => api.post(`/quotation-versions/${cur.id}/revise`), 'New draft version created')}>Revise (new version)</button>}
        {can.send && !viewing && <button className="btn primary" onClick={() => setDlg('send')}>Issue to customer</button>}
        {can.accept && !viewing && <><button className="btn good" onClick={() => setDlg('accept')}>Record acceptance</button><button className="btn danger" onClick={() => setDlg('decline')}>Declined</button></>}
        {['Approved', 'Sent', 'Expired'].includes(cur.status) && can.revise && !viewing && <button className="btn" onClick={() => setDlg('extend')}>Extend validity</button>}
      </PageHead>
      {viewing && <Alert kind="info">Viewing historical version {dispVer.version_no} (read-only). <a href="#" onClick={(e) => { e.preventDefault(); setViewing(null); setOld(null); }}>Back to current version</a></Alert>}
      {data.approval && <Alert kind={data.approval.status === 'Pending' ? 'warn' : data.approval.status.startsWith('Approved') ? 'good' : 'bad'}>Approval <Link to={`/approvals/${data.approval.id}`}>{data.approval.number}</Link>: <b>{data.approval.status}</b>{cur.status === 'Draft' && data.approval.status === 'Returned' ? ' — returned for changes' : ''}</Alert>}
      <ErrorBox error={actErr} />
      {!editable && cur.status === 'Approved' && !viewing && <Alert kind="good">Approved version — immutable. Issue it to the customer, or create a revision to change it.</Alert>}
      {!editable && ['Submitted'].includes(cur.status) && !viewing && <Alert kind="warn">Awaiting approval. The version is locked while it is under review (BRULE-QUO-005).</Alert>}

      <div className="editor-grid">
        <div className="stack">
          <Card title="Terms">
            <div className="form-grid">
              <label className="f">Currency<select disabled={!editable} value={editable ? hdr.currency : dispVer.currency} onChange={(e) => { setHdr({ ...hdr, currency: e.target.value }); setDirty(true); }}>{['USD', 'KHR', 'VND', 'THB', 'SGD', 'EUR', 'JPY', 'MYR'].map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="f">Valid until<input type="date" disabled={!editable} min={today()} value={(editable ? hdr.valid_until : dispVer.valid_until) || ''} onChange={(e) => { setHdr({ ...hdr, valid_until: e.target.value }); setDirty(true); }} /></label>
              <label className="f">Price list<select disabled={!editable} value={(editable ? hdr.price_list : dispVer.price_list) || 'List'} onChange={(e) => { setHdr({ ...hdr, price_list: e.target.value }); setDirty(true); }}>{['List', 'Partner', 'Special', 'Government'].map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="f">Payment terms<input type="text" list="pt" disabled={!editable} value={(editable ? hdr.payment_terms : dispVer.payment_terms) || ''} onChange={(e) => { setHdr({ ...hdr, payment_terms: e.target.value }); setDirty(true); }} /><datalist id="pt">{['30 days net', '14 days net', '7 days net', 'Cash on delivery', 'Advance payment'].map((x) => <option key={x} value={x} />)}</datalist></label>
              <label className="f">Delivery terms<input type="text" disabled={!editable} value={(editable ? hdr.delivery_terms : dispVer.delivery_terms) || ''} onChange={(e) => { setHdr({ ...hdr, delivery_terms: e.target.value }); setDirty(true); }} /></label>
              <label className="f">Header discount %<input type="number" min="0" max="100" step="0.1" disabled={!editable} value={(editable ? hdr.header_discount_pct : dispVer.header_discount_pct) ?? 0} onChange={(e) => { setHdr({ ...hdr, header_discount_pct: e.target.value }); setDirty(true); }} /></label>
              <label className="f full">Notes shown to the customer<textarea disabled={!editable} value={(editable ? hdr.customer_notes : dispVer.customer_notes) || ''} onChange={(e) => { setHdr({ ...hdr, customer_notes: e.target.value }); setDirty(true); }} /></label>
            </div>
          </Card>

          <Card title={`Line items (${dispLines.length})`} actions={editable && <button className="btn sm primary" onClick={() => { setLines([...lines, emptyLine()]); setDirty(true); }}>+ Add line</button>}>
            <div className="table-wrap">
              <table className="t dense">
                <thead><tr><th>#</th><th style={{ minWidth: 220 }}>Product / description</th><th className="num">Qty</th><th className="num" title="Term / billing period (months) for recurring items">Term/Bill</th><th className="num">List price</th><th className="num">Disc %</th><th className="num">Net unit</th><th className="num">Extended</th>
                  {can.see_cost && <th className="num">Unit cost</th>}{can.see_margin && <><th className="num">GP</th><th className="num">GM %</th></>}<th className="num">Tax %</th><th title="Optional line">Opt</th>{editable && <th />}</tr></thead>
                <tbody>
                  {dispLines.map((l, i) => { const c = calcLine(i); return (
                    <tr key={l._k || l.id} style={l.optional && !l.selected ? { opacity: 0.55 } : undefined}>
                      <td>{i + 1}</td>
                      <td className="desc">{editable ? <><Lookup entity="products" value={l.product_id} label={l.product_label} placeholder="Pick a product…" onChange={(v, lb) => pickProduct(l._k, v, lb, l.quantity)} /><input type="text" aria-label="Description" value={l.description || ''} onChange={(e) => setLine(l._k, { description: e.target.value })} style={{ marginTop: 4 }} placeholder="Description" />
                        {num(l.list_price) * (1 - num(l.discount_pct) / 100) === 0 && <input type="text" aria-label="Zero-price reason" placeholder="Reason for zero-price line" value={l.zero_price_reason || ''} onChange={(e) => setLine(l._k, { zero_price_reason: e.target.value })} style={{ marginTop: 4 }} />}</> : l.description}</td>
                      <td className="num">{editable ? <input type="number" min="0" step="any" aria-label="Quantity" value={l.quantity} onChange={(e) => setLine(l._k, { quantity: e.target.value })} style={{ width: 70 }} /> : l.quantity}</td>
                      <td className="num">{l.term_months ? `${l.term_months}/${l.billing_months}` : '—'}</td>
                      <td className="num">{editable ? <input type="number" min="0" step="any" aria-label="List price" value={l.list_price} onChange={(e) => setLine(l._k, { list_price: e.target.value })} style={{ width: 95 }} /> : fmtMoney(l.list_price)}</td>
                      <td className="num">{editable ? <input type="number" min="0" max="100" step="0.5" aria-label="Discount %" value={l.discount_pct} onChange={(e) => setLine(l._k, { discount_pct: e.target.value })} style={{ width: 64 }} /> : l.discount_pct}</td>
                      <td className="num mono">{fmtMoney(c ? c.unit_net : l.unit_net)}</td>
                      <td className="num mono"><b>{fmtMoney(c ? c.ext_net : l.ext_net)}</b></td>
                      {can.see_cost && <td className="num mono">{l.unit_cost != null ? <span title={`${l.cost_source || ''} ${l.cost_ref || ''}`}>{fmtMoney(l.unit_cost)}</span> : <span className="err">missing</span>}</td>}
                      {can.see_margin && <><td className="num mono">{fmtMoney(c?.line_gp ?? l.line_gp)}</td><td className="num mono">{fmtPct(c?.line_gm_pct ?? l.line_gm_pct)}</td></>}
                      <td className="num">{l.tax_rate}</td>
                      <td>{editable ? <input type="checkbox" aria-label="Optional" checked={!!l.optional} onChange={(e) => setLine(l._k, { optional: e.target.checked, selected: !e.target.checked })} /> : l.optional ? 'opt' : ''}</td>
                      {editable && <td><button className="btn sm ghost danger" aria-label="Remove line" onClick={() => { setLines(lines.filter((x) => x._k !== l._k)); setDirty(true); }}>✕</button></td>}
                    </tr>); })}
                </tbody>
              </table>
              {dispLines.length === 0 && <div className="empty">No lines yet. Add products to build the quotation.</div>}
            </div>
            {editable && lines.some((l) => l.unit_cost == null && l.product_id) && can.see_cost && <Alert kind="warn">Some lines have no cost. Costs are required before submission (BRULE-QUO-003).</Alert>}
          </Card>
        </div>

        <div className="stack sticky" style={{ position: 'sticky', top: 70 }}>
          <Card title="Totals">
            <table className="t" style={{ width: '100%' }}><tbody>
              <tr><td>Subtotal</td><td className="num mono">{fmtMoney(shown.subtotal, ccy)}</td></tr>
              {shown.discount_total > 0 && <tr><td>Discounts given</td><td className="num mono">{fmtMoney(shown.discount_total, ccy)}</td></tr>}
              <tr><td>Tax</td><td className="num mono">{fmtMoney(shown.tax_total, ccy)}</td></tr>
              <tr><td><b>Total</b></td><td className="num mono"><b style={{ fontSize: 17 }}>{fmtMoney(shown.grand_total, ccy)}</b></td></tr>
              {can.see_cost && <tr><td className="muted">Total cost</td><td className="num mono muted">{fmtMoney(shown.total_cost)}</td></tr>}
              {can.see_margin && <><tr><td className="muted">Gross profit</td><td className="num mono">{fmtMoney(shown.gross_profit)}</td></tr><tr><td className="muted">Margin</td><td className="num mono"><Badge v={gmWarn ? 'Pending' : 'Active'}>{shown.gm_pct == null ? 'n/a' : fmtPct(shown.gm_pct)}</Badge></td></tr></>}
            </tbody></table>
            {gmWarn && <Alert kind="warn">Margin is below the standard floor — approval will be required on submission.</Alert>}
            {!can.see_margin && <div className="help" style={{ marginTop: 8 }}>Margin details are restricted. Approval requirements are shown on submission.</div>}
          </Card>
          <Card title="Versions">
            <ul className="timeline">{data.versions.map((v) => <li key={v.id}><a href="#" onClick={(e) => { e.preventDefault(); viewVersion(v); }} style={{ fontWeight: (viewing || cur.id) === v.id ? 700 : 400 }}>v{v.version_no}</a> <Badge v={v.status} /><div className="muted small">{fmtMoney(v.grand_total, v.currency)} · valid {fmtDate(v.valid_until)}</div>{v.po_reference && <div className="small">PO {v.po_reference}</div>}</li>)}</ul>
          </Card>
        </div>
      </div>
      {dlg && <VersionDialog kind={dlg} version={cur} onClose={() => setDlg(null)} onSubmit={async (b) => { const r = await run(() => api.post(`/quotation-versions/${cur.id}/${dlg}`, b), dlg === 'send' ? 'Quotation issued' : dlg === 'accept' ? 'Acceptance recorded' : 'Updated'); if (r) setDlg(null); }} err={actErr} />}
    </>
  );
}

function VersionDialog({ kind, version, onClose, onSubmit, err }) {
  const [v, setV] = useState({ po_date: today(), valid_until: version.valid_until });
  const titles = { send: 'Issue quotation to customer', accept: 'Record customer acceptance', decline: 'Customer declined', extend: 'Extend validity' };
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal title={titles[kind]} size="narrow" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onSubmit(v)}>Confirm</button></>}>
      <div className="stack">
        {kind === 'send' && <><label className="f">Recipients (email)<input type="text" value={v.recipients || ''} onChange={set('recipients')} placeholder="customer@example.com" /></label><label className="f">Message<textarea value={v.message || ''} onChange={set('message')} /></label><Alert kind="info">The customer PDF never includes cost, margin, internal notes or approval data (BRULE-QUO-007).</Alert></>}
        {kind === 'accept' && <><label className="f">Customer PO / acceptance reference *<input type="text" value={v.po_reference || ''} onChange={set('po_reference')} /></label><label className="f">PO date<input type="date" value={v.po_date} onChange={set('po_date')} /></label></>}
        {kind === 'decline' && <label className="f">Reason *<input type="text" value={v.reason || ''} onChange={set('reason')} /></label>}
        {kind === 'extend' && <><label className="f">New validity date<input type="date" value={v.valid_until} min={version.valid_until} onChange={set('valid_until')} /></label><label className="f">Reason<input type="text" value={v.reason || ''} onChange={set('reason')} /></label></>}
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}
