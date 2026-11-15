import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useAsync, useToast } from '../state';
import { Alert, Badge, Card, ErrorBox, Modal, PageHead, Spinner } from '../components/ui';
import { ActionDialog, DocumentsPanel, EntityTable, FormModal } from '../components/entity';
import { fmtDate, fmtDateTime, fmtMoney, today } from '../util';

export function ClaimPage() {
  const { id } = useParams(); const { me, can, hasRole } = useAuth(); const toast = useToast(); const nav = useNavigate();
  const [c, setC] = useState(null); const [err, setErr] = useState(null); const [apr, setApr] = useState(null); const [edit, setEdit] = useState(false); const [line, setLine] = useState(null); const [adj, setAdj] = useState(null); const [actErr, setActErr] = useState(null); const [busy, setBusy] = useState(false); const [tab, setTab] = useState('lines');
  const load = useCallback(async () => { try { const x = await api.get(`/claims/${id}/review`); setC(x); setErr(null); if (x.approval_request_id) setApr(await api.get(`/approvals/${x.approval_request_id}`).catch(() => null)); } catch (e) { setErr(e); } }, [id]);
  useEffect(() => { load(); }, [load]);
  if (err) return <ErrorBox error={err} />; if (!c) return <Spinner />;
  const mine = c.owner_id === me.id; const editable = ['Draft', 'Returned'].includes(c.status) && (mine || hasRole('ROL-ADM'));
  const finvPending = apr?.steps?.some((s) => s.status === 'Pending' && s.role_code === 'ROL-FINV') && hasRole('ROL-FINV', 'ROL-ADM');
  const lines = c._lines || [];
  const doSubmit = async () => { setBusy(true); setActErr(null); try { await api.post(`/e/claims/${id}/actions/submit`); toast('Claim submitted for approval', 'success'); load(); } catch (e) { setActErr(e); } finally { setBusy(false); } };
  const startAdjust = () => setAdj(Object.fromEntries(lines.map((l) => [l.id, { amount: l.approved_amount ?? l.claim_amount, reason: l.adjust_reason || '' }])));
  const saveAdjust = async () => { try { await api.post(`/e/claims/${id}/actions/adjust`, { lines: Object.entries(adj).map(([lid, v]) => ({ id: Number(lid), approved_amount: Number(v.amount), reason: v.reason })) }); toast('Adjustments saved', 'success'); setAdj(null); load(); } catch (e) { setActErr(e); } };
  const stage = c._stage || c.status;
  return (
    <>
      <PageHead title={<>{c.title} <Badge v={stage} /> <Badge v={c.payment_status} /></>} sub={<>{c.number} · claimant {c.claimant_name} · {c.currency}</>}>
        {editable && <button className="btn" onClick={() => setEdit(true)}>Edit header</button>}
        {editable && <button className="btn" onClick={() => setLine({})}>+ Expense line</button>}
        {editable && <button className="btn primary" disabled={busy} onClick={doSubmit}>Submit for approval</button>}
        {apr && <Link className="btn" to={`/approvals/${apr.id}`}>Approval route</Link>}
      </PageHead>
      <ErrorBox error={actErr} />
      {c.status === 'Returned' && <Alert kind="warn">This claim was returned for changes. Update it and re-submit.</Alert>}
      {c._pending_step && <Alert kind="info">Waiting for: <b>{c._pending_step}</b>. Approval and payment are tracked separately.</Alert>}
      {c._flags?.length > 0 && <Alert kind="warn"><b>Policy flags</b><ul>{c._flags.map((f, i) => <li key={i}>{f}</li>)}</ul></Alert>}
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card kpi"><div className="label">Claimed</div><div className="value mono">{fmtMoney(c.total_amount, c.currency)}</div></div>
        <div className="card kpi"><div className="label">Approved amount</div><div className="value mono">{['Approved', 'Pending finance verification'].includes(stage) || c.payment_status !== 'Not ready' ? fmtMoney(c.approved_amount, c.currency) : '—'}</div></div>
        <div className="card kpi"><div className="label">Claim date</div><div className="value" style={{ fontSize: 18 }}>{fmtDate(c.claim_date)}</div></div>
        <div className="card kpi"><div className="label">Payment</div><div className="value" style={{ fontSize: 18 }}>{c.payment_status}</div><div className="hint">{c.payment_reference || ''} {c.paid_at ? fmtDate(c.paid_at) : ''}</div></div>
      </div>
      <Card title="Expense lines" actions={finvPending && !adj && <button className="btn primary sm" onClick={startAdjust}>Finance adjustment…</button>}>
        <div className="table-wrap"><table className="t"><thead><tr><th>Date</th><th>Category</th><th>Merchant / description</th><th className="num">Amount</th><th className="num">Claim ccy</th><th>Receipt</th><th className="num">Approved</th>{adj && <th>Adjust reason</th>}<th /></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}><td>{fmtDate(l.expense_date)}</td><td>{l.category_name}</td><td>{l.merchant && <b>{l.merchant}</b>} {l.description}{l.attendees && <div className="muted small">Attendees: {l.attendees}</div>}{(l.policy_flags || []).map((f) => <div key={f} className="err">⚠ {f}</div>)}</td>
              <td className="num mono">{fmtMoney(l.amount, l.currency)}</td><td className="num mono">{fmtMoney(l.claim_amount)}</td><td>{l.receipt_attached ? '✓' : <span className="err">missing</span>}</td>
              <td className="num mono">{adj ? <input type="number" min="0" max={l.claim_amount} step="0.01" aria-label="Approved amount" style={{ width: 90 }} value={adj[l.id].amount} onChange={(e) => setAdj({ ...adj, [l.id]: { ...adj[l.id], amount: e.target.value } })} /> : l.approved_amount != null ? fmtMoney(l.approved_amount) : '—'}{l.adjust_reason && !adj && <div className="muted small">{l.adjust_reason}</div>}</td>
              {adj && <td><input type="text" aria-label="Adjustment reason" value={adj[l.id].reason} onChange={(e) => setAdj({ ...adj, [l.id]: { ...adj[l.id], reason: e.target.value } })} /></td>}
              <td className="right nowrap">{editable && <><button className="btn sm" onClick={() => setLine(l)}>Edit</button> <button className="btn sm danger" onClick={async () => { await api.del(`/e/claim_lines/${l.id}`); load(); }}>✕</button></>}</td></tr>))}</tbody></table>
          {lines.length === 0 && <div className="empty">No expense lines yet.</div>}</div>
        {adj && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn" onClick={() => setAdj(null)}>Cancel</button><button className="btn primary" onClick={saveAdjust}>Save adjustments</button></div>}
        {finvPending && <div className="help" style={{ marginTop: 8 }}>Verify receipts and amounts, adjust where policy requires, then approve the “Finance verification” step from the approval route.</div>}
      </Card>
      <div style={{ height: 14 }} />
      <Card title="Receipts & supporting documents"><DocumentsPanel entity="claims" recordId={id} canUpload={mine || hasRole('ROL-ADM')} /></Card>
      {edit && <FormModal entity="claims" record={c} onClose={() => setEdit(false)} onSaved={load} />}
      {line && <FormModal entity="claim_lines" record={line.id ? line : undefined} defaults={{ claim_id: Number(id), currency: c.currency, expense_date: today() }} title={line.id ? 'Edit expense line' : 'Add expense line'} onClose={() => setLine(null)} onSaved={load} />}
    </>
  );
}

export function PaymentsPage() {
  const { hasRole } = useAuth(); const toast = useToast();
  const { data: ready, reload, error } = useAsync(() => api.get('/claims-payments/ready'), []);
  const { data: batches, reload: rb } = useAsync(() => api.get('/e/claim_batches?size=50'), []);
  const [sel, setSel] = useState([]); const [err, setErr] = useState(null); const [open, setOpen] = useState(null);
  const create = async () => { try { await api.post('/claims-payments/batches', { claim_ids: sel }); toast('Batch created', 'success'); setSel([]); reload(); rb(); setErr(null); } catch (e) { setErr(e); } };
  return (
    <>
      <PageHead title="Reimbursements" sub="Approved claims ready for payment. Payment officers cannot pay claims they verified (segregation of duties)." />
      <ErrorBox error={error || err} />
      <Card title="Ready for payment" actions={hasRole('ROL-PAY', 'ROL-ADM') && <button className="btn primary sm" disabled={!sel.length} onClick={create}>Create batch ({sel.length})</button>}>
        <table className="t"><thead><tr><th /><th>Claim</th><th>Claimant</th><th className="num">Approved</th><th>Payment status</th></tr></thead><tbody>
          {(ready || []).map((c) => <tr key={c.id}><td><input type="checkbox" aria-label={`Select ${c.number}`} checked={sel.includes(c.id)} onChange={() => setSel((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))} /></td><td><Link to={`/claims/${c.id}`}>{c.number}</Link> {c.title}</td><td>{c.claimant}</td><td className="num mono">{fmtMoney(c.approved_amount, c.currency)}</td><td><Badge v={c.payment_status} /></td></tr>)}</tbody></table>
        {ready && ready.length === 0 && <div className="empty">No claims waiting for payment.</div>}
      </Card>
      <div style={{ height: 14 }} />
      <Card title="Batches" pad={false}>
        <table className="t"><thead><tr><th>Batch</th><th>Status</th><th className="num">Claims</th><th className="num">Total</th><th>Payment date</th><th>Reference</th></tr></thead><tbody>
          {(batches?.rows || []).map((b) => <tr key={b.id} className="click" onClick={() => setOpen(b.id)}><td className="mono">{b.number}</td><td><Badge v={b.status} /></td><td className="num">{b.claim_count}</td><td className="num mono">{fmtMoney(b.total_amount, b.currency)}</td><td>{fmtDate(b.payment_date)}</td><td>{b.bank_reference || '—'}</td></tr>)}</tbody></table>
      </Card>
      {open && <BatchModal id={open} onClose={() => { setOpen(null); rb(); reload(); }} />}
    </>
  );
}

function BatchModal({ id, onClose }) {
  const { hasRole } = useAuth(); const toast = useToast(); const [d, setD] = useState(null); const [err, setErr] = useState(null); const [res, setRes] = useState({}); const [ref, setRef] = useState('');
  const load = useCallback(() => api.get(`/claims-payments/batches/${id}`).then(setD).catch(setErr), [id]);
  useEffect(() => { load(); }, [load]);
  const call = async (op, body) => { try { await api.post(`/claims-payments/batches/${id}/${op}`, body || {}); toast('Done', 'success'); setErr(null); load(); } catch (e) { setErr(e); } };
  if (!d) return <Modal title="Batch" onClose={onClose}><Spinner /></Modal>;
  const b = d.batch;
  return (
    <Modal title={`Batch ${b.number}`} size="wide" onClose={onClose}>
      <div className="stack">
        <div className="row"><Badge v={b.status} /><b className="mono">{fmtMoney(b.total_amount, b.currency)}</b><span className="muted">{b.claim_count} claims</span></div>
        <ErrorBox error={err} />
        <table className="t"><thead><tr><th>Claim</th><th>Claimant</th><th className="num">Amount</th><th>Payment</th>{b.status === 'Sent to payment' && <th>Result</th>}</tr></thead><tbody>
          {d.claims.map((c) => <tr key={c.id}><td>{c.number} {c.title}</td><td>{c.claimant}</td><td className="num mono">{fmtMoney(c.approved_amount, c.currency)}</td><td><Badge v={c.payment_status} /></td>{b.status === 'Sent to payment' && <td><select value={res[c.id] || 'Paid'} onChange={(e) => setRes({ ...res, [c.id]: e.target.value })}><option>Paid</option><option>Failed</option></select></td>}</tr>)}</tbody></table>
        <div className="row wrap">
          {b.status === 'Pending authorisation' && hasRole('ROL-FIN', 'ROL-ADM') && <button className="btn primary" onClick={() => call('authorise')}>Authorise batch</button>}
          {b.status === 'Authorised' && hasRole('ROL-PAY', 'ROL-ADM') && <button className="btn primary" onClick={() => call('send', { payment_date: today() })}>Send to payment (INT-19)</button>}
          {b.status === 'Sent to payment' && hasRole('ROL-PAY', 'ROL-ADM') && <><input type="text" placeholder="Bank / accounting reference" value={ref} onChange={(e) => setRef(e.target.value)} style={{ maxWidth: 260 }} /><button className="btn primary" onClick={() => call('result', { bank_reference: ref, results: d.claims.map((c) => ({ claim_id: c.id, status: res[c.id] || 'Paid', reference: ref, error: 'Rejected by bank' })) })}>Record payment results</button></>}
        </div>
      </div>
    </Modal>
  );
}

export function CommissionPage() {
  const { hasRole, can } = useAuth(); const toast = useToast();
  const { data: my } = useAsync(() => api.get('/commission/my'), []);
  const { data: att } = useAsync(() => api.get('/targets/attainment'), []);
  const [f, setF] = useState({ period_label: '', period_start: '', period_end: '' }); const [err, setErr] = useState(null); const [key, setKey] = useState(0);
  const fin = hasRole('ROL-FIN', 'ROL-ADM');
  return (
    <>
      <PageHead title="Targets & commission" sub="Attainment is calculated from closed-won opportunities credited to the owner (and team splits)." />
      <Card title="Target attainment" pad={false}>
        <table className="t"><thead><tr><th>Target</th><th>Owner</th><th>Measure</th><th>Period</th><th className="num">Target</th><th className="num">Actual</th><th style={{ width: 160 }}>Attainment</th></tr></thead><tbody>
          {(att || []).map((a) => <tr key={a.id}><td>{a.number}</td><td>{a.owner_name}</td><td>{a.measure}</td><td>{a.period_label}</td><td className="num mono">{fmtMoney(a.target)}</td><td className="num mono">{fmtMoney(a.actual)}</td><td><div className="row"><div className="bar grow"><i style={{ width: `${Math.min(100, a.pct || 0)}%`, background: (a.pct || 0) >= 100 ? 'var(--good)' : 'var(--primary)' }} /></div><span className="small">{a.pct ?? '—'}%</span></div></td></tr>)}</tbody></table>
        {att && att.length === 0 && <div className="empty">No active targets.</div>}
      </Card>
      <div style={{ height: 14 }} />
      {fin && (
        <>
          <Card title="Calculate commission estimates">
            <div className="row wrap"><label className="f">Period label<input type="text" placeholder="2026-Q4" value={f.period_label} onChange={(e) => setF({ ...f, period_label: e.target.value })} /></label><label className="f">From<input type="date" value={f.period_start} onChange={(e) => setF({ ...f, period_start: e.target.value })} /></label><label className="f">To<input type="date" value={f.period_end} onChange={(e) => setF({ ...f, period_end: e.target.value })} /></label>
              <button className="btn primary" style={{ marginTop: 18 }} onClick={async () => { try { const r = await api.post('/commission/calculate', f); toast(`${r.count} statements calculated`, 'success'); setKey((k) => k + 1); setErr(null); } catch (e) { setErr(e); } }}>Calculate</button></div>
            <ErrorBox error={err} />
          </Card>
          <div style={{ height: 14 }} />
          <EntityTable entity="commission_records" refreshKey={key} title="Commission statements" />
        </>
      )}
      {my && my.length > 0 && <Card title="My approved statements" pad={false}><table className="t"><thead><tr><th>Statement</th><th>Period</th><th className="num">Basis</th><th className="num">Attainment</th><th className="num">Commission</th><th>Status</th></tr></thead><tbody>{my.map((r) => <tr key={r.number}><td>{r.number}</td><td>{r.period_label}</td><td className="num mono">{fmtMoney(r.basis_amount)}</td><td className="num">{r.attainment_pct?.toFixed(1)}%</td><td className="num mono">{fmtMoney(r.amount, r.currency)}</td><td><Badge v={r.status} /></td></tr>)}</tbody></table></Card>}
    </>
  );
}
