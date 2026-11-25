import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/icons';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useMeta, useToast } from '../state';
import { fmtDate, fmtDateTime, fmtMoney, fmtCompact, today, plusDays } from '../util';
import { ActionBar, Alert, Badge, Card, Confirm, Empty, ErrorBox, KV, Modal, PageHead, Segmented, Skeleton, Spinner, SummaryStrip, Tabs } from '../components/ui';
import { ActionDialog, DocumentsPanel, EntityTable, FormModal, HistoryPanel, SharePanel, renderValue, visibleActions } from '../components/entity';
import { FieldInput } from '../components/fields';

// ------------------------------------------------------------------------ list
export function EntityListPage() {
  const { entity } = useParams();
  const { meta, error } = useMeta(entity); const nav = useNavigate(); const [show, setShow] = useState(false); const [key] = useState(0); const [count, setCount] = useState(null);
  if (error) return <ErrorBox error={error} />; if (!meta) return <Skeleton variant="page" />;
  const quote = entity === 'quotations';
  const canCreate = meta.perms.C && (!meta.system || quote);
  return (
    <>
      <PageHead title={meta.plural} count={count} sub={meta.system && !quote ? 'Records of this type are created by workflows.' : undefined}>
        {entity === 'opportunities' && <Segmented value="list" items={[{ key: 'list', label: 'List', icon: 'listView', to: '/opportunities' }, { key: 'board', label: 'Board', icon: 'boardView', to: '/pipeline' }]} />}
        {canCreate && <button className="btn primary" onClick={() => setShow(true)}><Icon name="add" size={16} />New {meta.label.toLowerCase()}</button>}
      </PageHead>
      <EntityTable entity={entity} refreshKey={key} onCount={setCount} onNew={canCreate ? () => setShow(true) : undefined} />
      {show && (quote ? <CreateQuotationModal onClose={() => setShow(false)} /> : <FormModal entity={entity} onClose={() => setShow(false)} onSaved={(r) => nav(`/${entity}/${r.id}`)} />)}
    </>
  );
}

export function CreateQuotationModal({ opportunity, onClose }) {
  const nav = useNavigate(); const toast = useToast();
  const [opp, setOpp] = useState(opportunity ? opportunity.id : null); const [label, setLabel] = useState(opportunity ? opportunity.name : ''); const [ccy, setCcy] = useState(opportunity?.currency || 'USD'); const [cfg, setCfg] = useState(null); const [cfgLabel, setCfgLabel] = useState('');
  const [opt, setOpt] = useState(''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(null); try { const r = await api.post('/quotations/create', { opportunity_id: opp, currency: ccy, option_label: opt || undefined, config_id: cfg || undefined }); toast(`Quotation ${r.number} created`, 'success'); nav(`/quotations/${r.id}`); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <Modal title="New quotation" size="narrow" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!opp || busy} onClick={go}>{busy ? 'Creating…' : 'Create quotation'}</button></>}>
      <div className="stack">
        <FieldInput field={{ name: 'o', label: 'Opportunity', type: 'ref', ref: 'opportunities', req: true }} value={opp} labelValue={label} readOnly={!!opportunity} onChange={(n, v, l) => { setOpp(v); setLabel(l); }} />
        <label className="f">Currency<select value={ccy} onChange={(e) => setCcy(e.target.value)}>{['USD', 'KHR', 'VND', 'THB', 'SGD', 'EUR'].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="f">Option label (optional)<input type="text" value={opt} onChange={(e) => setOpt(e.target.value)} placeholder="e.g. Option A - Dell" /></label>
        {opp && <FieldInput field={{ name: 'c', label: 'Start from validated BOM (optional)', type: 'ref', ref: 'solution_configs' }} value={cfg} labelValue={cfgLabel} onChange={(n, v, l) => { setCfg(v); setCfgLabel(l); }} />}
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------------- detail
const SKIP = new Set(['version', 'created_by', 'modified_by', 'deleted_by']);

export function EntityDetailPage() {
  const { entity, id } = useParams();
  if (entity === 'quotations') return <Navigate to={`/quotations/${id}`} replace />;
  if (entity === 'claims') return <Navigate to={`/claims/${id}`} replace />;
  if (entity === 'approval_requests') return <Navigate to={`/approvals/${id}`} replace />;
  return <Detail key={`${entity}/${id}`} entity={entity} id={id} />;
}

// Fields the opportunity panel already shows (facts appear once).
const OPP_PANEL = new Set(['amount', 'currency', 'probability', 'weighted_amount', 'forecast_category', 'status', 'stage', 'prob_overridden', 'close_date']);
const SUMMARY_TYPES = ['money', 'date', 'pct'];

function Detail({ entity, id }) {
  const { meta, error: me } = useMeta(entity); const { can } = useAuth(); const nav = useNavigate(); const toast = useToast();
  const [rec, setRec] = useState(null); const [err, setErr] = useState(null); const [tab, setTab] = useState('details'); const [edit, setEdit] = useState(false); const [act, setAct] = useState(null); const [del, setDel] = useState(false); const [addChild, setAddChild] = useState(null); const [key, setKey] = useState(0);
  const load = useCallback(() => api.get(`/e/${entity}/${id}`).then((r) => { setRec(r); setErr(null); }).catch(setErr), [entity, id]);
  useEffect(() => { load(); }, [load]);
  if (me || err) return <ErrorBox error={me || err} retry={load} />;
  if (!meta || !rec) return <Skeleton variant="page" />;
  const title = rec[meta.title] != null && meta.title !== 'id' ? String(rec[meta.title]) : rec.number || `${meta.label} #${rec.id}`;
  const status = meta.statusField ? rec[meta.statusField] : null;
  const isOpp = entity === 'opportunities';
  // Summary strip: owner + the first money/date/percent list fields (not for opportunities: their panel is the summary).
  const summaryFields = isOpp ? [] : meta.fields.filter((f) => f.list && SUMMARY_TYPES.includes(f.type) && rec[f.name] != null && !rec[`${f.name}__masked`]).slice(0, 4);
  const shown = new Set([meta.title, 'number', meta.statusField, ...(isOpp ? OPP_PANEL : []), ...summaryFields.map((f) => f.name), ...(rec.owner_id__label && !isOpp ? ['owner_id'] : [])]);
  const fields = meta.fields.filter((f) => !f.hide && !SKIP.has(f.name) && !shown.has(f.name));
  const children = meta.children || [];
  const tabs = [{ key: 'details', label: 'Overview' }, ...children.map((c) => ({ key: `c:${c.entity}`, label: c.label, count: rec._counts?.[c.entity] })), ...(can('M20', 'V') ? [{ key: 'docs', label: 'Documents' }] : []), { key: 'history', label: 'History' }, ...(meta.perms.H ? [{ key: 'share', label: 'Sharing' }] : [])];
  if (entity === 'approval_processes') tabs.splice(1, 0, { key: 'rules', label: 'Rules & simulation' });
  if (entity === 'users') tabs.splice(1, 0, { key: 'roles', label: 'Roles & access' });
  if (entity === 'deal_registrations' && rec.conflict_status !== 'None') tabs.splice(1, 0, { key: 'conflicts', label: 'Conflict case' });
  if (entity === 'meetings') tabs.splice(1, 0, { key: 'avail', label: 'Availability' });
  const childTab = tab.startsWith('c:') ? children.find((c) => `c:${c.entity}` === tab) : null;
  const actions = visibleActions(entity, meta, rec);

  const afterChange = () => { load(); setKey((k) => k + 1); };
  const sections = []; let cur = null;
  for (const f of fields) { const s = f.section || (cur ? cur.s : 'Details'); if (!cur || cur.s !== s) { cur = { s, items: [] }; sections.push(cur); } cur.items.push(f); }
  // One primary (first workflow step, or Edit), one secondary, the rest under More; delete last.
  const bar = [
    ...actions.map((a) => ({ label: a.label, onClick: () => setAct(a), danger: /cancel|suspend|disqualify|anonymi|reject/i.test(a.key) })),
    rec._can?.edit && { label: 'Edit', icon: 'edit', onClick: () => setEdit(true) },
    isOpp && can('M13', 'C') && rec.status === 'Open' && { label: 'New quotation', icon: 'add', onClick: () => setAddChild({ entity: 'quotations', quote: true }) },
    rec._can?.delete && !meta.system && { label: `Delete ${meta.label.toLowerCase()}`, danger: true, onClick: () => setDel(true) },
  ].filter(Boolean).map((a, i) => (isOpp && !a.danger ? { ...a, kind: 'secondary' } : a));

  return (
    <>
      <PageHead crumbs={[{ label: meta.plural, to: `/${entity}` }, { label: rec.number || title }]} eyebrow={meta.label}
        title={<>{title} {status && <Badge v={status} />}{rec._lock?.locked === true && <Badge v="Blocked"><Icon name="lock" size={16} />{rec._lock.message}</Badge>}</>}
        sub={<>{rec.number && rec.number !== title ? <span className="mono">{rec.number}</span> : null}{rec.number && rec.number !== title && rec.owner_id__label ? ' · ' : ''}{rec.owner_id__label ? <>Owner <Link to={`/users/${rec.owner_id}`}>{rec.owner_id__label}</Link></> : null}</>}>
        <ActionBar actions={bar} />
      </PageHead>

      {isOpp && <OpportunityPanel rec={rec} reload={afterChange} />}
      {!isOpp && <SummaryStrip items={[
        rec.owner_id__label && { k: 'Owner', v: <Link to={`/users/${rec.owner_id}`}>{rec.owner_id__label}</Link> },
        ...summaryFields.map((f) => ({ k: f.label, v: renderValue(f, rec, meta) })),
        { k: 'Last updated', v: fmtDate(rec.modified_at) },
      ]} />}
      {entity === 'leads' && rec.status !== 'Converted' && rec.status !== 'Disqualified' && <Alert kind="info">Lead score <b>{rec.score}</b>/100. Qualify the lead against BANT-T criteria, then convert it to an account, contact and opportunity.</Alert>}
      {entity === 'leads' && rec.status === 'Converted' && <Alert kind="good">Converted → {rec.converted_account_id && <Link to={`/accounts/${rec.converted_account_id}`}>Account</Link>} {rec.converted_opportunity_id && <>· <Link to={`/opportunities/${rec.converted_opportunity_id}`}>Opportunity</Link></>}. Converted leads are read-only.</Alert>}
      <div style={{ height: 'var(--sp-5)' }} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'details' && (
        <div className="stack">
          {sections.map((s) => (
            <Card key={s.s} title={s.s}>
              <KV items={s.items.map((f) => ({ k: f.label, v: renderValue(f, rec, meta), full: ['longtext', 'json'].includes(f.type) }))} />
            </Card>
          ))}
          <div className="muted small">Created {fmtDateTime(rec.created_at)} · Last modified {fmtDateTime(rec.modified_at)} · Version {rec.version}</div>
          {entity === 'accounts' && rec._360 && <Account360 rec={rec} />}
          {entity === 'partners' && rec._performance && <Card title="Partner performance"><div className="grid g3"><div><div className="muted small">Opportunities</div><b className="metric">{rec._performance.opportunities}</b></div><div><div className="muted small">Won value</div><b className="metric">{fmtMoney(rec._performance.won)}</b></div><div><div className="muted small">Open pipeline</div><b className="metric">{fmtMoney(rec._performance.open_pipeline)}</b></div></div></Card>}
          {entity === 'events' && rec._roi && <EventPanel rec={rec} reload={afterChange} />}
          {entity === 'contracts' && <Alert kind="info">Renewal opportunities are created automatically when the contract is within the renewal lead window, or manually from the renewal record.</Alert>}
        </div>
      )}
      {tab === 'rules' && <RulesEditor rec={rec} reload={load} />}
      {tab === 'roles' && <UserRoles rec={rec} reload={load} />}
      {tab === 'conflicts' && <Conflicts rec={rec} />}
      {tab === 'avail' && <Availability rec={rec} />}
      {childTab && <EntityTable entity={childTab.entity} filters={{ [childTab.fk]: id }} embedded refreshKey={key} onNew={() => setAddChild(childTab)} />}
      {tab === 'docs' && <Card><DocumentsPanel entity={entity} recordId={id} canUpload={can('M20', 'C')} /></Card>}
      {tab === 'history' && <Card><HistoryPanel entity={entity} recordId={id} /></Card>}
      {tab === 'share' && <Card><SharePanel entity={entity} recordId={id} /></Card>}

      {edit && <FormModal entity={entity} record={rec} onClose={() => setEdit(false)} onSaved={afterChange} />}
      {act && <ActionDialog entity={entity} recordId={id} action={act} onClose={() => setAct(null)} onDone={(r) => { if (r && r.opportunity_id && act.key === 'create_opportunity') nav(`/opportunities/${r.opportunity_id}`); else if (act.key === 'convert' && r?.opportunity_id) nav(`/opportunities/${r.opportunity_id}`); else if (act.key === 'new_version' && r?.id) nav(`/${entity}/${r.id}`); else afterChange(); }} />}
      {del && <Confirm danger title={`Delete this ${meta.label.toLowerCase()}?`} message={<><b>{title}</b> will be removed from lists and searches.</>} consequences={['The deletion is recorded in the audit log.', 'Linked records keep their history.']} undo="An administrator can restore it from the audit log." yesLabel={`Delete ${meta.label.toLowerCase()}`} onNo={() => setDel(false)} onYes={async () => { try { await api.del(`/e/${entity}/${id}`); toast(`${meta.label} deleted`, 'success'); nav(`/${entity}`); } catch (e) { toast(e.message, 'error'); setDel(false); } }} />}
      {addChild && (addChild.quote ? <CreateQuotationModal opportunity={rec} onClose={() => setAddChild(null)} /> : <FormModal entity={addChild.entity} defaults={{ [addChild.fk]: Number(id), [`${addChild.fk}`]: Number(id) }} onClose={() => setAddChild(null)} onSaved={afterChange} />)}
    </>
  );
}

// ------------------------------------------------------------- opportunity panel
function OpportunityPanel({ rec, reload }) {
  const { can, hasRole } = useAuth(); const toast = useToast();
  const [dlg, setDlg] = useState(null); const [act, setAct] = useState(null); const [ai, setAi] = useState(null); const [aiBusy, setAiBusy] = useState(false);
  const stages = rec._stages || []; const idx = stages.findIndex((s) => s.code === rec.stage);
  const open = rec.status === 'Open'; const mgr = rec._is_manager;
  const next = (rec._next || []).map((c) => stages.find((s) => s.code === c)).filter(Boolean);
  const fwd = next.filter((s) => !['S11', 'S12', 'S13'].includes(s.code));
  const canWin = open && (rec.stage === 'S10' || next.some((s) => s.code === 'S11'));
  const flags = rec.risk_flags || [];
  const runAi = async (kind) => { setAiBusy(true); try { setAi(await api.get(`/ai/opportunity/${rec.id}/${kind}`)); } catch (e) { toast(e.message, 'error'); } finally { setAiBusy(false); } };
  return (
    <div className="stack">
      <Card>
        <div className="stages" role="list" aria-label="Pipeline stages">
          {stages.filter((s) => !['S12', 'S13'].includes(s.code)).map((s, i) => <div key={s.code} role="listitem" className={`stage ${s.code === rec.stage ? 'cur' : (i < idx && s.code !== 'S11') || rec.status === 'Won' ? 'done' : ''}`}><b>{s.probability}%</b>{s.name}</div>)}
        </div>
        <SummaryStrip items={[
          { k: 'Amount', v: <span className="mono">{fmtMoney(rec.amount, rec.currency)}</span> },
          { k: 'Probability', v: <>{rec.probability}%{rec.prob_overridden ? <Icon name="edit" size={16} label="Manually overridden" style={{ verticalAlign: -2, marginLeft: 4 }} /> : ''}</> },
          { k: 'Weighted', v: <span className="mono">{fmtMoney(rec.weighted_amount)}</span> },
          { k: 'Forecast', v: <Badge v={rec.forecast_category} /> },
          { k: 'Close date', v: fmtDate(rec.close_date) },
          rec.status === 'On hold' && { k: 'Review by', v: fmtDate(rec.review_date) },
        ]} />
        <ActionBar actions={[
          canWin && { label: 'Mark won', icon: 'check', kind: 'accent', onClick: () => setDlg({ code: 'S11', name: 'Closed Won' }) },
          open && fwd[0] && { label: `Move to ${fwd[0].name}`, icon: 'next', kind: canWin ? 'secondary' : 'primary', onClick: () => setDlg(fwd[0]) },
          rec.status === 'On hold' && { label: 'Resume', onClick: () => setAct({ key: 'resume', label: 'Resume from hold' }) },
          ['Won', 'Lost', 'Cancelled'].includes(rec.status) && { label: 'Reopen', onClick: () => setAct({ key: 'reopen', label: 'Reopen' }) },
          ...(open ? fwd.slice(1).map((s) => ({ label: `Move to ${s.name}`, onClick: () => setDlg(s) })) : []),
          open && mgr && idx > 0 && { label: 'Move back one stage', onClick: () => setDlg({ code: stages[Math.max(0, idx - 1)].code, name: stages[Math.max(0, idx - 1)].name, backwards: true }) },
          open && next.some((s) => s.code === 'S13') && { label: 'Put on hold', onClick: () => setDlg(next.find((s) => s.code === 'S13')) },
          open && { label: 'Override probability…', onClick: () => setAct({ key: 'set_probability', label: 'Override probability' }) },
          open && { label: 'Change forecast category…', onClick: () => setAct({ key: 'set_forecast_category', label: 'Forecast category' }) },
          can('M28', 'U') && open && { label: 'AI summary', icon: 'ai', onClick: () => runAi('summary'), disabled: aiBusy },
          can('M28', 'U') && open && { label: 'Suggested next actions', icon: 'ai', onClick: () => runAi('next-actions'), disabled: aiBusy },
          open && next.some((s) => s.code === 'S12') && { label: 'Mark lost…', danger: true, onClick: () => setDlg(next.find((s) => s.code === 'S12')) },
          open && { label: 'Cancel deal…', danger: true, onClick: () => setAct({ key: 'cancel', label: 'Cancel opportunity', prompt: 'reason' }) },
        ]} />
      </Card>
      {flags.length > 0 && <Alert kind="warn"><b>Risk indicators:</b> {flags.map((f) => f.label).join(' · ')}</Alert>}
      {open && rec._stage_checklist?.length > 0 && <Alert kind="info"><b>To leave “{stages[idx]?.name}” you still need:</b><ul>{rec._stage_checklist.map((c, i) => <li key={i}>{c}</li>)}</ul></Alert>}
      {ai && <Alert kind="info"><div className="small muted">{ai.notice}</div>{ai.text && <p style={{ margin: '6px 0 0' }}>{ai.text}</p>}{ai.actions && <ul>{ai.actions.map((a, i) => <li key={i}><Badge v={a.priority} /> {a.action}</li>)}</ul>}</Alert>}
      {dlg && <StageDialog rec={rec} target={dlg} onClose={() => setDlg(null)} onDone={reload} />}
      {act && <ActionDialog entity="opportunities" recordId={rec.id} action={act} onClose={() => setAct(null)} onDone={reload} />}
    </div>
  );
}

function StageDialog({ rec, target, onClose, onDone }) {
  const [v, setV] = useState({ review_date: plusDays(30), po_date: today() }); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false); const toast = useToast(); const [override, setOverride] = useState(false);
  const { meta } = useMeta('opportunities');
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const go = async () => {
    setBusy(true); setErr(null);
    try { await api.post(`/e/opportunities/${rec.id}/actions/change_stage`, { to: target.code, ...v, override: override || undefined }); toast(`Moved to ${target.name}`, 'success'); onDone(); onClose(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const lossReasons = (meta?.fields.find((f) => f.name === 'loss_reason')?.options) || [];
  return (
    <Modal title={`${target.backwards ? 'Move back to' : 'Move to'} ${target.code} — ${target.name}`} size="narrow" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={go}>{busy ? 'Working…' : 'Confirm'}</button></>}>
      <div className="stack">
        {target.code === 'S11' && <><label className="f">Customer PO number<input type="text" value={v.po_number || ''} onChange={set('po_number')} /></label><label className="f">PO date<input type="date" value={v.po_date} onChange={set('po_date')} /></label>
          <label className="check" style={{ paddingTop: 0 }}><input type="checkbox" checked={!!v.no_quotation_exception} onChange={set('no_quotation_exception')} />No-quotation exception (Services only, manager)</label><label className="f">Lessons learned<textarea value={v.lessons_learned || ''} onChange={set('lessons_learned')} /></label>
          <Alert kind="info">Closed Won needs an <b>accepted quotation version</b> and a PO reference. It locks commercial fields and queues the ERP order handover.</Alert></>}
        {target.code === 'S12' && <><label className="f">Loss reason *<select value={v.loss_reason || ''} onChange={set('loss_reason')}><option value="">Select…</option>{lossReasons.map((o) => <option key={o}>{o}</option>)}</select></label>
          <label className="f">Competitor{v.loss_reason === 'Competitor' ? ' *' : ''}<input type="text" value={v.loss_competitor || ''} onChange={set('loss_competitor')} /></label><label className="f">Lessons learned<textarea value={v.lessons_learned || ''} onChange={set('lessons_learned')} /></label></>}
        {target.code === 'S13' && <><label className="f">Hold reason *<input type="text" value={v.hold_reason || ''} onChange={set('hold_reason')} /></label><label className="f">Review date * (within 90 days)<input type="date" value={v.review_date} onChange={set('review_date')} /></label></>}
        {!['S11', 'S12', 'S13'].includes(target.code) && <label className="f">Comment / reason{target.backwards ? ' (required for backwards move)' : ' (optional)'}<input type="text" value={v.reason || ''} onChange={set('reason')} /></label>}
        <ErrorBox error={err} />
        {err?.data?.can_override && <label className="check" style={{ paddingTop: 0 }}><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />Manager override of stage criteria (reason required above)</label>}
      </div>
    </Modal>
  );
}

function Account360({ rec }) {
  const d = rec._360;
  return (
    <Card title="Account 360°">
      <div className="grid g3"><div><div className="muted small">Open opportunities</div><b className="metric">{d.open_opportunities}</b></div><div><div className="muted small">Open pipeline</div><b className="metric">{fmtMoney(d.open_pipeline)}</b></div><div><div className="muted small">Won to date</div><b className="metric">{fmtMoney(d.won_total)}</b></div></div>
      {d.subsidiaries.length > 0 && <div style={{ marginTop: 12 }}><div className="muted small">Subsidiaries</div>{d.subsidiaries.map((s) => <Link key={s.id} to={`/accounts/${s.id}`} style={{ marginRight: 12 }}>{s.legal_name}</Link>)}</div>}
      {rec.credit_blocked && <Alert kind="bad">Credit blocked in ERP — quotations cannot be issued without Finance release.</Alert>}
    </Card>
  );
}

function EventPanel({ rec, reload }) {
  const { me } = useAuth(); const toast = useToast(); const r = rec._roi; const [dietary, setDietary] = useState('');
  return (
    <Card title="Event results & ROI">
      <div className="grid g4"><div><div className="muted small">Budget (base)</div><b className="metric">{fmtMoney(r.budget)}</b></div><div><div className="muted small">Actual cost (approved claims)</div><b className="metric">{fmtMoney(r.actual_cost)}</b></div><div><div className="muted small">Registered / attended</div><b className="metric">{rec.registered_count} / {rec.attended_count}</b></div><div><div className="muted small">Leads · pipeline influenced</div><b className="metric">{rec.leads_generated} · {fmtCompact(rec.pipeline_influenced)}</b></div></div>
      {rec.status === 'Open for registration' && (
        <div className="row" style={{ marginTop: 14 }}><input type="text" placeholder="Dietary / accessibility needs (optional)" value={dietary} onChange={(e) => setDietary(e.target.value)} style={{ maxWidth: 320 }} /><button className="btn primary" onClick={async () => { try { const x = await api.post(`/events/${rec.id}/register`, { dietary }); toast(`You are ${x.status.toLowerCase()}`, 'success'); reload(); } catch (e) { toast(e.message, 'error'); } }}>Register myself</button></div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------ admin-ish panels
function RulesEditor({ rec, reload }) {
  const [text, setText] = useState(JSON.stringify(rec.rules, null, 2)); const [err, setErr] = useState(null); const [sim, setSim] = useState('{\n  "gm_pct": 8,\n  "max_discount_pct": 12,\n  "amount_base": 120000,\n  "payment_terms_nonstandard": false\n}'); const [res, setRes] = useState(null); const toast = useToast();
  const editable = rec.status === 'Draft' && rec._can?.edit;
  const save = async () => { try { await api.put(`/e/approval_processes/${rec.id}`, { rules: JSON.parse(text), version: rec.version }); toast('Rules saved', 'success'); reload(); setErr(null); } catch (e) { setErr(e); } };
  const run = async () => { try { setRes(await api.post('/approvals-workflow/simulate', { type: rec.process_type, snapshot: JSON.parse(sim) })); setErr(null); } catch (e) { setErr(e); } };
  return (
    <div className="grid g2">
      <Card title="Rules (conditions → approval steps)" actions={editable && <button className="btn primary sm" onClick={save}>Save draft</button>}>
        {!editable && <Alert kind="info">Only <b>Draft</b> versions can be edited. Use “Create new version”, edit it, then “Activate version” (the previous version is retired).</Alert>}
        <textarea style={{ minHeight: 360, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} value={text} readOnly={!editable} onChange={(e) => setText(e.target.value)} />
        <div className="help">Condition ops: &lt; &lt;= &gt; &gt;= = != in true. Values may reference settings, e.g. <code>"@margin_floor_standard"</code>. Step kinds: manager (level), authority, role (country_scoped), user. Steps with the same <code>seq</code> run in parallel.</div>
        <ErrorBox error={err} />
      </Card>
      <Card title="Simulate" actions={<button className="btn sm" onClick={run}>Evaluate against ACTIVE version</button>}>
        <textarea style={{ minHeight: 140, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} value={sim} onChange={(e) => setSim(e.target.value)} />
        {res && <div style={{ marginTop: 10 }}>{res.required ? <Alert kind="warn"><b>Approval required</b> ({res.process?.name} v{res.process?.version})<ul>{res.rules.map((r) => <li key={r}>{r}</li>)}</ul><div className="small">Steps: {res.steps.map((s) => `${s.seq || 1}: ${s.label || s.role || s.kind}`).join(' → ')}</div></Alert> : <Alert kind="good">No approval required — auto-approved.</Alert>}</div>}
      </Card>
    </div>
  );
}

function UserRoles({ rec, reload }) {
  const [all, setAll] = useState([]); const [mine, setMine] = useState([]); const [err, setErr] = useState(null); const toast = useToast();
  useEffect(() => { Promise.all([api.get('/admin/roles'), api.get(`/admin/users/${rec.id}/roles`)]).then(([a, m]) => { setAll(a); setMine(m); }).catch(setErr); }, [rec.id]);
  const toggle = (c) => setMine((m) => (m.includes(c) ? m.filter((x) => x !== c) : [...m, c]));
  const save = async () => { try { await api.put(`/admin/users/${rec.id}/roles`, { roles: mine }); toast('Roles saved — the user must sign in again', 'success'); setErr(null); } catch (e) { setErr(e); } };
  return (
    <Card title="Roles" actions={<><button className="btn sm" onClick={async () => { await api.post(`/admin/users/${rec.id}/unlock`); toast('Account unlocked', 'success'); }}>Unlock account</button><button className="btn primary sm" onClick={save}>Save roles</button></>}>
      <ErrorBox error={err} />
      <div className="grid g3">{all.filter((r) => !['ROL-EMP', 'ROL-DM'].includes(r.code)).map((r) => <label key={r.code} className="row" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={mine.includes(r.code)} onChange={() => toggle(r.code)} /><span><b>{r.name}</b><div className="muted small">{r.code} — {r.description}</div></span></label>)}</div>
      <div className="help" style={{ marginTop: 10 }}>ROL-EMP is granted to every internal user and ROL-DM to anyone with direct reports. Separation-of-duty conflicts (e.g. Payment Officer + Finance Verifier) are rejected.</div>
    </Card>
  );
}

function Conflicts({ rec }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get(`/e/deal_registrations/${rec.id}/conflicts`).then(setRows).catch(() => setRows([])); }, [rec.id]);
  if (!rows) return <Spinner />;
  return <Card title="Competing registrations (same customer + vendor)"><table className="t"><thead><tr><th>Number</th><th>Partner</th><th>Owner</th><th>Status</th><th className="num">Value</th><th>Protection ends</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td><Link to={`/deal_registrations/${r.id}`}>{r.number}</Link></td><td>{r.partner_name || '—'}</td><td>{r.owner_name}</td><td><Badge v={r.status} /></td><td className="num">{fmtMoney(r.deal_value, r.currency)}</td><td>{fmtDate(r.protection_end)}</td></tr>)}</tbody></table>{rec.conflict_decision && <Alert kind="info">Decision: {rec.conflict_decision}</Alert>}</Card>;
}

function Availability({ rec }) {
  const [rows, setRows] = useState(null); const [res, setRes] = useState(null);
  useEffect(() => { api.get(`/e/meeting_participants?f_meeting_id=${rec.id}&size=100`).then((d) => setRows(d.rows)).catch(() => setRows([])); }, [rec.id]);
  const check = async () => { const ids = rows.map((r) => r.user_id).filter(Boolean); setRes(await api.post('/calendar/availability', { user_ids: ids, start: rec.start_at, end: rec.end_at, exclude_meeting_id: rec.id })); };
  if (!rows) return <Spinner />;
  return (
    <Card title="Attendee availability" actions={<button className="btn primary sm" onClick={check}>Check availability for this slot</button>}>
      <p className="muted small">Availability comes from CRM meetings. People who do not share their calendar are shown as <b>unknown</b> — never assumed free.</p>
      {res && <>{res.holidays.length > 0 && <Alert kind="warn">Non-working day in this period: {res.holidays.join(', ')}</Alert>}<table className="t"><thead><tr><th>Attendee</th><th>Status</th><th>Conflicts</th></tr></thead><tbody>{res.users.map((u) => <tr key={u.id}><td>{u.name}</td><td><Badge v={u.status === 'free' ? 'Active' : u.status === 'busy' ? 'Rejected' : 'Pending'}>{u.status}</Badge></td><td>{u.conflicts.map((c, i) => <div key={i} className="small">{c.subject} ({fmtDateTime(c.start)})</div>)}</td></tr>)}</tbody></table></>}
    </Card>
  );
}
