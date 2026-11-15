import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useAsync, useToast } from '../state';
import { Alert, Badge, Card, ErrorBox, KV, Modal, PageHead, Spinner, Tabs } from '../components/ui';
import { FieldInput } from '../components/fields';
import { fmtDateTime, fmtMoney } from '../util';

const TYPE = { quotation: 'Quotation', deal_registration: 'Deal registration', partner: 'Partner onboarding', claim: 'Expense claim', target: 'Sales target', config: 'Configuration change', event: 'Event budget', discount: 'Discount' };

export async function recordPath(r) {
  if (r.record_entity === 'quotation_versions') { try { const v = await api.get(`/quotation-versions/${r.record_id}`); return `/quotations/${v.version.quotation_id}`; } catch { return null; } }
  if (r.record_entity === 'app_setting_versions') return '/settings/app';
  return `/${r.record_entity}/${r.record_id}`;
}

export function ApprovalsPage() {
  const nav = useNavigate(); const { can, hasRole } = useAuth(); const [view, setView] = useState('pending');
  const { data, error, loading } = useAsync(() => api.get(`/approvals/inbox?view=${view}`), [view]);
  const tabs = [{ key: 'pending', label: 'Waiting for me' }, { key: 'submitted', label: 'Submitted by me' }, { key: 'decided', label: 'Decided by me' }, { key: 'all', label: 'All visible to me' }];
  return (
    <>
      <PageHead title="Approvals" sub="Requests routed to you by the approval engine. You cannot approve your own requests." />
      <Tabs tabs={tabs} value={view} onChange={setView} />
      <ErrorBox error={error} />
      <div className="card"><div className="table-wrap"><table className="t"><thead><tr><th>Request</th><th>Type</th><th>Record</th><th>Submitted by</th><th className="num">Amount</th><th>Progress</th><th>Status</th><th>Submitted</th></tr></thead>
        <tbody>{(data?.rows || []).map((r) => (
          <tr key={r.id} className="click" tabIndex={0} onClick={() => nav(`/approvals/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/approvals/${r.id}`)}>
            <td className="mono">{r.number}</td><td>{TYPE[r.process_type] || r.process_type}</td><td>{r.record_label}</td><td>{r.submitter_name}</td><td className="num">{r.amount != null ? fmtMoney(r.amount, r.currency) : '—'}</td>
            <td>{(r.steps || []).map((s) => <span key={s.id} title={`${s.label}: ${s.status}`} className={`badge ${s.status === 'Approved' ? 'good' : s.status === 'Pending' ? 'warn' : s.status === 'Rejected' ? 'bad' : ''}`} style={{ marginRight: 3 }}>{s.seq}</span>)}</td>
            <td><Badge v={r.status} /></td><td className="muted small">{fmtDateTime(r.submitted_at)}</td></tr>))}</tbody></table>
        {loading && <Spinner />}{!loading && (data?.rows || []).length === 0 && <div className="empty">{view === 'pending' ? 'Nothing is waiting for your approval. 🎉' : 'No requests.'}</div>}</div></div>
    </>
  );
}

export function ApprovalDetailPage() {
  const { id } = useParams(); const toast = useToast(); const nav = useNavigate();
  const { data: r, error, loading, reload } = useAsync(() => api.get(`/approvals/${id}`), [id]);
  const [mode, setMode] = useState(null); const [f, setF] = useState({}); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false); const [path, setPath] = useState(null); const [dl, setDl] = useState(false); const [du, setDu] = useState(null); const [dul, setDul] = useState('');
  useEffect(() => { if (r) recordPath(r).then(setPath); }, [r]);
  if (loading) return <Spinner />; if (error) return <ErrorBox error={error} />;
  const decide = async (decision) => { setBusy(true); setErr(null); try { const res = await api.post(`/approvals/${id}/decide`, { decision, comment: f.comment, reason: f.reason, conditions: f.conditions }); toast(res.status === 'Pending' ? 'Decision recorded — next approver notified' : `Request ${res.status.toLowerCase()}`, 'success'); setMode(null); setF({}); reload(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const pendingStep = r.steps.find((s) => s.status === 'Pending');
  const snap = r.snapshot || {};
  return (
    <>
      <PageHead title={<>{r.number} <Badge v={r.status} /></>} sub={<>{TYPE[r.process_type]} · {path ? <Link to={path}>{r.record_label}</Link> : r.record_label} · submitted by {r.submitter_name} on {fmtDateTime(r.submitted_at)}</>}>
        {r.can_withdraw && <button className="btn danger" onClick={async () => { try { await api.post(`/approvals/${id}/withdraw`, { reason: 'Withdrawn by submitter' }); toast('Request withdrawn', 'success'); reload(); } catch (e) { toast(e.message, 'error'); } }}>Withdraw</button>}
        {path && <Link className="btn" to={path}>Open record</Link>}
      </PageHead>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px', alignItems: 'start' }}>
        <div className="stack">
          {r.can_decide && (
            <Card title="Your decision">
              <div className="row wrap">
                <button className="btn good" onClick={() => setMode('approve')}>Approve</button><button className="btn" onClick={() => setMode('approve_conditions')}>Approve with conditions</button><button className="btn" onClick={() => setMode('return')}>Return for changes</button><button className="btn danger" onClick={() => setMode('reject')}>Reject</button><button className="btn" onClick={() => setDl(true)}>Delegate…</button>
              </div>
              {mode && (
                <div className="stack" style={{ marginTop: 14 }}>
                  {mode === 'reject' && <label className="f">Reason (required)<input type="text" value={f.reason || ''} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>}
                  {mode === 'return' && <label className="f">What needs to change? (required)<textarea value={f.comment || ''} onChange={(e) => setF({ ...f, comment: e.target.value })} /></label>}
                  {mode === 'approve_conditions' && <label className="f">Conditions (required)<textarea value={f.conditions || ''} onChange={(e) => setF({ ...f, conditions: e.target.value })} /></label>}
                  {['approve', 'approve_conditions'].includes(mode) && <label className="f">Comment (optional)<input type="text" value={f.comment || ''} onChange={(e) => setF({ ...f, comment: e.target.value })} /></label>}
                  <ErrorBox error={err} />
                  <div className="row"><button className="btn primary" disabled={busy} onClick={() => decide(mode)}>{busy ? 'Saving…' : `Confirm ${mode.replace('_', ' ')}`}</button><button className="btn" onClick={() => { setMode(null); setErr(null); }}>Cancel</button></div>
                </div>
              )}
            </Card>
          )}
          <Card title="Approval route">
            <ul className="timeline">{r.steps.map((s) => (
              <li key={s.id}><b>Step {s.seq}: {s.label}</b> <Badge v={s.status} />{s.escalation_level > 0 && <Badge v="High">escalated L{s.escalation_level}</Badge>}
                <div className="muted small">{s.approver_name ? `Approver: ${s.approver_name}` : `Any ${s.role_code || 'approver'}`}{s.decided_by_name ? ` · decided by ${s.decided_by_name}${s.on_behalf_name ? ` on behalf of ${s.on_behalf_name}` : ''} · ${fmtDateTime(s.decided_at)}` : s.sla_due ? ` · SLA ${fmtDateTime(s.sla_due)}` : ''}</div>
                {s.reason && <div className="small"><b>Reason:</b> {s.reason}</div>}{s.comment && <div className="small">“{s.comment}”</div>}{s.conditions && <div className="small"><b>Conditions:</b> {s.conditions}</div>}</li>))}</ul>
          </Card>
        </div>
        <div className="stack">
          <Card title="Why was approval needed?">
            {(r.triggered_rules || []).length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{r.triggered_rules.map((t) => <li key={t}>{t}</li>)}</ul> : <span className="muted">—</span>}
            {snap.requires_approval && <div className="help">Margin values are restricted for your role.</div>}
            {snap.gm_pct != null && <div style={{ marginTop: 10 }}><KV items={[{ k: 'Margin', v: `${snap.gm_pct}%` }, { k: 'Max discount', v: `${snap.max_discount_pct ?? 0}%` }, { k: 'Deal value', v: fmtMoney(snap.grand_total ?? r.amount, r.currency) }, { k: 'Gross profit', v: fmtMoney(snap.gross_profit) }]} /></div>}
            {r.process_type === 'claim' && <div style={{ marginTop: 8 }}>{path && <Link to={path} className="btn sm">Review claim lines & receipts</Link>}</div>}
            {r.comment && <div style={{ marginTop: 10 }}><div className="muted small">Submitter note</div>{r.comment}</div>}
          </Card>
        </div>
      </div>
      {dl && <Modal title="Delegate this step" size="narrow" onClose={() => setDl(false)} footer={<><button className="btn" onClick={() => setDl(false)}>Cancel</button><button className="btn primary" disabled={!du} onClick={async () => { try { await api.post(`/approvals/steps/${pendingStep.id}/delegate`, { user_id: du, reason: f.dreason }); toast('Delegated', 'success'); setDl(false); reload(); } catch (e) { toast(e.message, 'error'); } }}>Delegate</button></>}>
        <div className="stack"><FieldInput field={{ name: 'u', label: 'Delegate to', type: 'ref', ref: 'users', req: true }} value={du} labelValue={dul} onChange={(n, v, l) => { setDu(v); setDul(l); }} /><label className="f">Reason<input type="text" value={f.dreason || ''} onChange={(e) => setF({ ...f, dreason: e.target.value })} /></label></div></Modal>}
    </>
  );
}
