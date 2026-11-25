// Approvals v2: inbox with readable progress and waiting time; decision page that shows the facts first
// (what · why · route) with a fixed decision bar. docs/redesign/01-audit-and-strategy.md WF-1…WF-3, WF-5.
import { useEffect, useState } from 'react';
import { Icon } from '../components/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAsync, useToast } from '../state';
import { Alert, Badge, Card, Confirm, Empty, ErrorBox, KV, Menu, Modal, PageHead, Skeleton, Tabs } from '../components/ui';
import { FieldInput } from '../components/fields';
import { fmtDate, fmtDateTime, fmtMoney } from '../util';
import { roleName } from '../nav';

const TYPE = { quotation: 'Quotation', deal_registration: 'Deal registration', partner: 'Partner onboarding', claim: 'Expense claim', target: 'Sales target', config: 'Configuration change', event: 'Event budget', discount: 'Discount' };

export async function recordPath(r) {
  if (r.record_entity === 'quotation_versions') { try { const v = await api.get(`/quotation-versions/${r.record_id}`); return `/quotations/${v.version.quotation_id}`; } catch { return null; } }
  if (r.record_entity === 'app_setting_versions') return '/settings/app';
  return `/${r.record_entity}/${r.record_id}`;
}

/** "3 days", "5 hours", "just now" since a date. */
export function since(d) {
  if (!d) return '';
  const ms = Date.now() - new Date(d).getTime(); const h = Math.floor(ms / 3600000);
  if (h < 1) return 'less than an hour'; if (h < 24) return `${h} hour${h === 1 ? '' : 's'}`;
  const days = Math.floor(h / 24); return `${days} day${days === 1 ? '' : 's'}`;
}
function slaText(due) {
  if (!due) return null;
  const ms = new Date(due).getTime() - Date.now(); const days = Math.round(Math.abs(ms) / 86400000);
  if (ms < 0) return { late: true, text: `Overdue by ${days || 'less than 1'} day${days === 1 ? '' : 's'}` };
  return { late: false, text: days ? `Due in ${days} day${days === 1 ? '' : 's'}` : 'Due today' };
}
const approverText = (s) => (s.approver_name ? s.approver_name : `Any ${roleName(s.role_code || 'approver').toLowerCase()}`);

export function ApprovalsPage() {
  const nav = useNavigate(); const [view, setView] = useState('pending');
  const { data, error, loading, reload } = useAsync(() => api.get(`/approvals/inbox?view=${view}`), [view]);
  const rows = data?.rows || [];
  const tabs = [{ key: 'pending', label: 'Waiting for me', count: view === 'pending' && data ? rows.length : undefined }, { key: 'submitted', label: 'Submitted by me' }, { key: 'decided', label: 'Decided by me' }, { key: 'all', label: 'All visible to me' }];
  return (
    <>
      <PageHead title="Approvals" sub="Requests routed to you by the approval engine. You can't approve your own requests." />
      <Tabs tabs={tabs} value={view} onChange={setView} />
      <ErrorBox error={error} retry={reload} />
      <div className="card"><div className="table-wrap">
        {loading ? <Skeleton variant="rows" count={4} /> : rows.length === 0
          ? <Empty icon={view === 'pending' ? 'success' : 'inbox'} title={view === 'pending' ? 'Nothing is waiting for you' : 'No requests here'}>{view === 'pending' ? 'New requests routed to you appear here and on your dashboard.' : 'Requests you submit or decide appear in these tabs.'}</Empty>
          : (
            <table className="t list stack-sm">
              <thead><tr><th scope="col">Request</th><th scope="col">What</th><th scope="col">Submitted by</th><th scope="col" className="num">Amount</th><th scope="col">Progress</th><th scope="col">Waiting</th><th scope="col">Status</th></tr></thead>
              <tbody>{rows.map((r) => {
                const steps = r.steps || []; const cur = steps.find((s) => s.status === 'Pending'); const curIdx = cur ? steps.indexOf(cur) + 1 : steps.length;
                return (
                  <tr key={r.id} className="click" tabIndex={0} onClick={() => nav(`/approvals/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/approvals/${r.id}`)}>
                    <td data-label="Request" className="mono">{r.number}</td>
                    <td data-label="What"><div>{TYPE[r.process_type] || r.process_type}</div><div className="muted small">{r.record_label}</div></td>
                    <td data-label="Submitted by">{r.submitter_name}</td>
                    <td data-label="Amount" className="num mono">{r.amount != null ? fmtMoney(r.amount, r.currency) : '—'}</td>
                    <td data-label="Progress"><span className="step-label">{steps.length ? `Step ${curIdx} of ${steps.length}` : '—'}</span>{cur && <div className="muted small">{cur.label}</div>}</td>
                    <td data-label="Waiting" className="nowrap">{r.status === 'Pending' ? since(r.submitted_at) : <span className="muted">—</span>}<div className="muted small">{fmtDate(r.submitted_at)}</div></td>
                    <td data-label="Status"><Badge v={r.status} /></td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
      </div></div>
    </>
  );
}

/** The thing being approved, shown in full so nobody decides blind. */
function Facts({ r, path }) {
  const isClaim = r.process_type === 'claim' && r.record_entity === 'claims';
  const { data: claim, error } = useAsync(() => (isClaim ? api.get(`/claims/${r.record_id}/review`) : Promise.resolve(null)), [r.record_id, isClaim]);
  const snap = r.snapshot || {};
  const lines = claim?._lines || [];
  const missing = lines.filter((l) => !l.receipt_attached).length;
  const flags = [...(claim?._flags || []), ...lines.flatMap((l) => l.policy_flags || [])];
  return (
    <Card title="What you're approving" actions={path && <Link to={path} className="btn sm ghost">Open {TYPE[r.process_type]?.toLowerCase() || 'record'}</Link>}>
      <div className="stack">
        <div className="facts-total">{r.amount != null && <b>{fmtMoney(r.amount, r.currency)}</b>}<span className="muted">{r.record_label}</span></div>
        {r.comment && <div><div className="muted small">Note from {r.submitter_name}</div>“{r.comment}”</div>}
        {snap.gm_pct != null && <KV items={[{ k: 'Margin', v: `${snap.gm_pct}%` }, { k: 'Largest discount', v: `${snap.max_discount_pct ?? 0}%` }, { k: 'Deal value', v: fmtMoney(snap.grand_total ?? r.amount, r.currency) }, { k: 'Gross profit', v: fmtMoney(snap.gross_profit) }]} />}
        {snap.requires_approval && snap.gm_pct == null && <div className="help">Margin values are restricted for your role.</div>}
        {isClaim && error && <ErrorBox error={error} />}
        {isClaim && !claim && !error && <Skeleton variant="rows" count={3} />}
        {isClaim && claim && (
          <>
            {flags.length > 0 && <Alert kind="warn"><b>{flags.length} policy flag{flags.length === 1 ? '' : 's'}</b><ul>{[...new Set(flags)].map((f) => <li key={f}>{f}</li>)}</ul></Alert>}
            {missing > 0 && <Alert kind="bad"><b>{missing} receipt{missing === 1 ? '' : 's'} missing</b> on {lines.length} expense line{lines.length === 1 ? '' : 's'}.</Alert>}
            <div className="table-wrap"><table className="t list stack-sm">
              <thead><tr><th scope="col">Date</th><th scope="col">Category</th><th scope="col">Description</th><th scope="col">Receipt</th><th scope="col" className="num">Amount</th></tr></thead>
              <tbody>{lines.map((l) => <tr key={l.id}><td data-label="Date" className="nowrap">{fmtDate(l.expense_date)}</td><td data-label="Category">{l.category_name}</td><td data-label="Description">{l.merchant && <b>{l.merchant} </b>}{l.description}{l.attendees && <div className="muted small">Attendees: {l.attendees}</div>}</td>
                <td data-label="Receipt">{l.receipt_attached ? <span className="row gap-sm" style={{ color: 'var(--status-good-fg)' }}><Icon name="success" size={16} />Attached</span> : <span className="err row gap-sm"><Icon name="error" size={16} />Missing</span>}</td>
                <td data-label="Amount" className="num mono">{fmtMoney(l.claim_amount ?? l.amount, claim.currency)}</td></tr>)}</tbody>
            </table></div>
            {lines.length === 0 && <Empty small>No expense lines on this claim.</Empty>}
          </>
        )}
      </div>
    </Card>
  );
}

export function ApprovalDetailPage() {
  const { id } = useParams(); const toast = useToast();
  const { data: r, error, loading, reload } = useAsync(() => api.get(`/approvals/${id}`), [id]);
  const [mode, setMode] = useState(null); const [comment, setComment] = useState(''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false); const [path, setPath] = useState(null);
  const [dl, setDl] = useState(false); const [du, setDu] = useState(null); const [dul, setDul] = useState(''); const [dreason, setDreason] = useState(''); const [withdraw, setWithdraw] = useState(false);
  useEffect(() => { if (r) recordPath(r).then(setPath); }, [r]);
  if (loading) return <Skeleton variant="page" />; if (error) return <ErrorBox error={error} retry={reload} />;
  const decide = async (decision, text) => {
    setBusy(true); setErr(null);
    try {
      const body = decision === 'reject' ? { decision, reason: text } : decision === 'return' ? { decision, comment: text } : decision === 'approve_conditions' ? { decision, conditions: text, comment } : { decision, comment: text || undefined };
      const res = await api.post(`/approvals/${id}/decide`, body);
      toast(res.status === 'Pending' ? 'Decision recorded. The next approver has been notified.' : `Request ${res.status.toLowerCase()}`, 'success'); setMode(null); setComment(''); reload();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const steps = r.steps || [];
  const pendingStep = steps.find((s) => s.status === 'Pending');
  const nextStep = pendingStep ? steps.find((s) => s.seq > pendingStep.seq && s.status !== 'Approved') : null;
  const sla = pendingStep && slaText(pendingStep.sla_due);
  const dialog = {
    approve: { title: 'Approve this request?', yes: 'Approve', reason: null, msg: nextStep ? `It moves on to step ${nextStep.seq}: ${nextStep.label}.` : `This is the last step. The ${TYPE[r.process_type]?.toLowerCase() || 'request'} will be approved.` },
    approve_conditions: { title: 'Approve with conditions', yes: 'Approve with conditions', reason: 'Conditions the submitter must meet', msg: 'The request is approved, and your conditions are recorded on it.' },
    return: { title: 'Return for changes?', yes: 'Return to submitter', reason: 'What needs to change?', msg: `${r.submitter_name} can edit and resubmit it.` },
    reject: { title: 'Reject this request?', yes: 'Reject request', reason: 'Reason for rejecting', msg: 'The request ends here. The submitter is notified with your reason.', danger: true },
  }[mode];

  return (
    <>
      <PageHead crumbs={[{ label: 'Approvals', to: '/approvals' }, { label: r.number }]} eyebrow={TYPE[r.process_type] || 'Approval request'}
        title={<>{r.record_label || r.number} <Badge v={r.status} /></>}
        sub={<>{r.number} · submitted by {r.submitter_name} {since(r.submitted_at)} ago ({fmtDateTime(r.submitted_at)})</>}>
        {r.can_withdraw && <button className="btn danger" onClick={() => setWithdraw(true)}>Withdraw request</button>}
      </PageHead>

      <div className={r.can_decide ? 'decision' : 'grid'} style={r.can_decide ? undefined : { gridTemplateColumns: 'minmax(0,1fr) 340px', alignItems: 'start' }}>
        <div className="stack">
          <Facts r={r} path={path} />
          <Card title="Approval route" sub={`${steps.filter((s) => s.status === 'Approved').length} of ${steps.length} steps approved`}>
            {steps.map((s) => {
              const state = s.status === 'Approved' ? 'done' : s.status === 'Pending' ? 'current' : '';
              const due = s.status === 'Pending' && slaText(s.sla_due);
              return (
                <div key={s.id} className={`route-step ${state}`}>
                  <span className="dotn" aria-hidden>{s.status === 'Approved' ? <Icon name="check" size={16} /> : s.seq}</span>
                  <div className="grow">
                    <div className="row wrap gap-sm"><b>Step {s.seq}: {s.label}</b><Badge v={s.status} />{s.escalation_level > 0 && <Badge v="High">Escalated (level {s.escalation_level})</Badge>}</div>
                    <div className="muted small">{approverText(s)}{s.decided_by_name ? ` · decided by ${s.decided_by_name}${s.on_behalf_name ? ` on behalf of ${s.on_behalf_name}` : ''} · ${fmtDateTime(s.decided_at)}` : ''}{due ? <> · <span className={due.late ? 'err' : ''}>{due.text}</span></> : ''}</div>
                    {s.reason && <div className="small"><b>Reason:</b> {s.reason}</div>}{s.comment && <div className="small">“{s.comment}”</div>}{s.conditions && <div className="small"><b>Conditions:</b> {s.conditions}</div>}
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
        <div className="stack">
          <Card title="Why approval is needed">
            {(r.triggered_rules || []).length ? <ul style={{ margin: 0, paddingLeft: 'var(--sp-7)' }}>{r.triggered_rules.map((t) => <li key={t}>{t}</li>)}</ul> : <span className="muted">This request type always needs approval.</span>}
          </Card>
          {pendingStep && (
            <Card title="Current step">
              <KV items={[{ k: 'Step', v: `${pendingStep.seq} of ${steps.length} · ${pendingStep.label}` }, { k: 'Approver', v: approverText(pendingStep) }, sla && { k: 'Deadline', v: <span className={sla.late ? 'err' : ''}>{sla.text}</span> }]} />
            </Card>
          )}
        </div>
      </div>

      {r.can_decide && (
        <div className="decision-bar" role="region" aria-label="Your decision">
          <span className="who grow">Your decision{sla ? <> · <span className={sla.late ? 'err' : ''}>{sla.text}</span></> : ''}</span>
          <button className="btn" onClick={() => setMode('return')}>Return for changes</button>
          <button className="btn danger" onClick={() => setMode('reject')}>Reject</button>
          <Menu label="More" icon={null} items={[{ label: 'Approve with conditions…', onClick: () => setMode('approve_conditions') }, { label: 'Delegate this step…', onClick: () => setDl(true) }]} />
          <button className="btn accent" onClick={() => setMode('approve')}><Icon name="check" size={16} />Approve</button>
        </div>
      )}

      {dialog && (dialog.reason
        ? <Confirm title={dialog.title} message={dialog.msg} reasonLabel={dialog.reason} danger={dialog.danger} yesLabel={dialog.yes} busy={busy} onNo={() => { setMode(null); setErr(null); }} onYes={(text) => decide(mode, text)} />
        : <Modal title={dialog.title} size="narrow" onClose={() => setMode(null)} footer={<><button className="btn" onClick={() => setMode(null)}>Cancel</button><button className="btn accent" disabled={busy} onClick={() => decide('approve', comment)}>{busy ? 'Saving…' : dialog.yes}</button></>}>
          <div className="stack"><p style={{ margin: 0 }}>{dialog.msg}</p><label className="f">Comment (optional)<input type="text" value={comment} onChange={(e) => setComment(e.target.value)} /></label></div>
        </Modal>)}
      {err && <div className="toasts"><div className="toast error"><Icon name="error" /><span>{err.message}</span></div></div>}
      {withdraw && <Confirm danger title="Withdraw this request?" message="Approvers stop seeing it. You can submit the record again later." yesLabel="Withdraw request" onNo={() => setWithdraw(false)} onYes={async () => { try { await api.post(`/approvals/${id}/withdraw`, { reason: 'Withdrawn by submitter' }); toast('Request withdrawn', 'success'); setWithdraw(false); reload(); } catch (e) { toast(e.message, 'error'); } }} />}
      {dl && <Modal title="Delegate this step" size="narrow" onClose={() => setDl(false)} footer={<><button className="btn" onClick={() => setDl(false)}>Cancel</button><button className="btn primary" disabled={!du} onClick={async () => { try { await api.post(`/approvals/steps/${pendingStep.id}/delegate`, { user_id: du, reason: dreason }); toast('Step delegated', 'success'); setDl(false); reload(); } catch (e) { toast(e.message, 'error'); } }}>Delegate</button></>}>
        <div className="stack"><FieldInput field={{ name: 'u', label: 'Delegate to', type: 'ref', ref: 'users', req: true }} value={du} labelValue={dul} onChange={(n, v, l) => { setDu(v); setDul(l); }} /><label className="f">Reason<input type="text" value={dreason} onChange={(e) => setDreason(e.target.value)} /></label></div></Modal>}
    </>
  );
}
