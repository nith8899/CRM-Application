import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, openAuthed } from '../api';
import { useAsync, useAuth, useToast } from '../state';
import { Alert, Badge, Card, ErrorBox, Modal, PageHead, Spinner, Tabs, Empty } from '../components/ui';
import { EntityTable } from '../components/entity';
import { fmtDateTime } from '../util';
import { roleName } from '../nav';

export function AdminOverview() {
  const toast = useToast(); const { data, error, loading, reload } = useAsync(() => api.get('/admin/overview'), []); const [jobs, setJobs] = useState(null); const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox error={error} />; if (loading) return <Spinner />;
  const K = ({ l, v, h, to }) => <Link to={to || '#'} style={{ color: 'inherit', textDecoration: 'none' }}><div className="card kpi"><div className="label">{l}</div><div className="value">{v}</div><div className="hint">{h}</div></div></Link>;
  return (
    <>
      <PageHead title="Administration" sub="System health, security signals and configuration entry points."><button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { setJobs(await api.post('/admin/jobs/run')); toast('Background jobs executed', 'success'); reload(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } }}>Run background jobs now</button></PageHead>
      <div className="grid g4" style={{ marginBottom: 'var(--sp-6)' }}>
        <K l="Active users" v={data.users.active} h={`${data.users.total} total · ${data.users.locked} locked`} to="/users" />
        <K l="Accounts / contacts" v={`${data.records.accounts} / ${data.records.contacts}`} h={`${data.records.opportunities} opportunities · ${data.records.leads} leads`} />
        <K l="Pending approvals" v={data.approvals_pending} h="across all workflows" to="/approvals" />
        <K l="Integration queue" v={data.integrations.failed + data.integrations.dead} h={`${data.integrations.pending} pending · ${data.integrations.failed} failed · ${data.integrations.dead} dead-letter`} to="/integrations/logs" />
        <K l="Audit events (24h)" v={data.audit_events_24h} h="immutable log" to="/admin/audit" />
        <K l="Failed logins (24h)" v={data.failed_logins_24h} h="security signal" to="/admin/audit" />
        <K l="Data quality" v="Review" h="duplicates, missing data" to="/admin/data-quality" />
        <K l="Configuration" v="Settings" h="thresholds & policies" to="/settings/app" />
      </div>
      {jobs && <Card title="Job results"><pre className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(jobs, null, 2)}</pre></Card>}
    </>
  );
}

// --------------------------------------------------------------- permissions
const ACTS = [['V', 'View'], ['C', 'Create'], ['E', 'Edit'], ['D', 'Delete'], ['S', 'Submit'], ['A', 'Approve'], ['X', 'Export'], ['I', 'Import'], ['G', 'Assign'], ['H', 'Share'], ['F', 'Files'], ['U', 'Use AI'], ['K', 'Configure']];
const SCOPES = [['O', 'Own'], ['T', 'Team'], ['D', 'Dept/BU'], ['B', 'Branch'], ['N', 'Country'], ['G', 'Organisation'], ['R', 'Shared'], ['L', 'Reporting line']];
const MODS = { M01: 'Dashboard', M02: 'Leads', M03: 'Accounts', M04: 'Contacts', M05: 'Partners', M06: 'Vendors', M07: 'Products', M08: 'Opportunities', M09: 'Deal registration', M10: 'Activities', M11: 'Meetings', M12: 'Sizing & BOM', M13: 'Quotations', M14: 'Pricing & margin', M15: 'Approvals', M16: 'Projects', M17: 'Targets & commission', M18: 'Forecasting', M19: 'Renewals', M20: 'Documents', M21: 'Notifications', M22: 'Reports', M23: 'Import/Export', M24: 'Administration', M25: 'Integrations', M26: 'Audit & security', M28: 'AI assistance', M29: 'Activity reports', M30: 'Tasks', M31: 'Calendar', M32: 'Settings', M33: 'Org & workflow', M34: 'Events', M35: 'Claims' };

const ACT_NAME = Object.fromEntries(ACTS); const SCOPE_NAME = Object.fromEntries(SCOPES);
const actWords = (a) => [...(a || '')].map((c) => ACT_NAME[c] || c);
const actShort = (a) => { const w = actWords(a); return w.length <= 2 ? w.join(' · ') : `${w.slice(0, 2).join(' · ')} +${w.length - 2}`; };
const scopeWords = (s) => (s || '').split('+').map((c) => SCOPE_NAME[c] || c).join(' + ');

export function PermissionsPage() {
  const { hasRole } = useAuth(); const toast = useToast(); const { data: roles } = useAsync(() => api.get('/admin/roles'), []); const { data: perms, reload } = useAsync(() => api.get('/admin/permissions'), []); const [sel, setSel] = useState(null); const [acts, setActs] = useState(''); const [scope, setScope] = useState('O'); const [err, setErr] = useState(null);
  const map = useMemo(() => { const m = {}; (perms || []).forEach((p) => { m[`${p.role_code}|${p.module}`] = p; }); return m; }, [perms]);
  if (!roles || !perms) return <Spinner />;
  const admin = hasRole('ROL-ADM');
  const open = (role, mod) => { const p = map[`${role}|${mod}`]; setSel({ role, mod }); setActs(p ? p.actions : ''); setScope(p ? p.scope : 'O'); setErr(null); };
  const save = async () => { try { await api.put('/admin/permissions', { role_code: sel.role, module: sel.mod, actions: acts, scope }); toast('Permission saved', 'success'); setSel(null); reload(); } catch (e) { setErr(e); } };
  const toggle = (a) => setActs((x) => (x.includes(a) ? x.replace(a, '') : x + a));
  const toggleScope = (s) => setScope((x) => { const set = new Set(x.split('+')); set.has(s) ? set.delete(s) : set.add(s); return [...set].join('+') || 'O'; });
  return (
    <>
      <PageHead title="Roles & permissions" sub="Effective access = role actions ∩ record scope ∩ field security ∩ record state. Cells show actions / scope (BRD §7.4)." />
      <Alert kind="info">Each cell shows what a role can do in a module, and on which records (its scope). Hover or focus a cell for the full list.{admin ? ' Select a cell to change it; every change is audited.' : ''}</Alert>
      <div className="card" style={{ marginTop: 12, overflow: 'auto', maxHeight: '70vh' }}>
        <table className="perm-table" style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
          <thead><tr><th style={{ position: 'sticky', left: 0, background: 'var(--surface)', textAlign: 'left' }}>Module</th>{roles.map((r) => <th key={r.code} scope="col" className="perm-role" style={{ position: 'sticky', top: 0, background: 'var(--surface-2)' }}>{roleName(r.code) !== r.code ? roleName(r.code) : r.name}</th>)}</tr></thead>
          <tbody>{Object.entries(MODS).map(([m, name]) => <tr key={m}><td style={{ position: 'sticky', left: 0, background: 'var(--surface)', textAlign: 'left', whiteSpace: 'nowrap' }}><b>{m}</b> {name}</td>{roles.map((r) => { const p = map[`${r.code}|${m}`]; return <td key={r.code} className={admin ? 'sel' : ''} onClick={() => admin && open(r.code, m)} title={`${r.name} · ${name}${p ? `: ${actWords(p.actions).join(', ')} · ${scopeWords(p.scope)}` : ': no access'}`} tabIndex={admin ? 0 : undefined} onKeyDown={(e) => admin && e.key === 'Enter' && open(r.code, m)}>{p ? <><span className="perm-acts">{actShort(p.actions)}</span><div className="muted">{scopeWords(p.scope)}</div></> : <span className="muted" aria-label="No access">—</span>}</td>; })}</tr>)}</tbody>
        </table>
      </div>
      {sel && <Modal title={`${roleName(sel.role)} · ${MODS[sel.mod]}`} size="narrow" onClose={() => setSel(null)} footer={<><button className="btn" onClick={() => setSel(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
        <div className="stack"><div><div className="muted small">Actions</div><div className="row wrap">{ACTS.map(([a, l]) => <label key={a} className="row small"><input type="checkbox" checked={acts.includes(a)} onChange={() => toggle(a)} />{l}</label>)}</div></div>
          <div><div className="muted small">Visibility scope (combine as needed)</div><div className="row wrap">{SCOPES.map(([s, l]) => <label key={s} className="row small"><input type="checkbox" checked={scope.split('+').includes(s)} onChange={() => toggleScope(s)} />{l}</label>)}</div></div>
          <ErrorBox error={err} /><div className="help">Clearing all actions removes the grant. Changes are audited and take effect immediately.</div></div></Modal>}
    </>
  );
}

// -------------------------------------------------------------------- audit
export function AuditPage() {
  const [f, setF] = useState({ entity: '', event: '', q: '', from: '', to: '', user_id: '' }); const [page, setPage] = useState(1); const [open, setOpen] = useState(null); const [u, setU] = useState('');
  const qs = new URLSearchParams({ page, size: 40, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }).toString();
  const { data, error, loading } = useAsync(() => api.get(`/audit?${qs}`), [qs]);
  const toast = useToast(); const { can } = useAuth();
  return (
    <>
      <PageHead title="Audit log" sub="Immutable record of who did what and when. Sensitive field values are hidden from users without field access.">{can('M26', 'X') && <button className="btn" onClick={() => openAuthed(`/audit?format=csv&${qs}`, 'audit.csv').catch((e) => toast(e.message, 'error'))}>Export CSV</button>}</PageHead>
      <div className="card">
        <div className="toolbar">
          <input type="search" placeholder="Search label / detail…" value={f.q} onChange={(e) => { setF({ ...f, q: e.target.value }); setPage(1); }} />
          <input type="text" placeholder="Entity (e.g. opportunities)" value={f.entity} onChange={(e) => { setF({ ...f, entity: e.target.value }); setPage(1); }} style={{ maxWidth: 190 }} />
          <input type="text" placeholder="Event (e.g. stage_change)" value={f.event} onChange={(e) => { setF({ ...f, event: e.target.value }); setPage(1); }} style={{ maxWidth: 190 }} />
          <input type="date" value={f.from} onChange={(e) => { setF({ ...f, from: e.target.value }); setPage(1); }} aria-label="From date" style={{ maxWidth: 150 }} /><input type="date" value={f.to} onChange={(e) => { setF({ ...f, to: e.target.value }); setPage(1); }} aria-label="To date" style={{ maxWidth: 150 }} />
        </div>
        <ErrorBox error={error} />
        <div className="table-wrap"><table className="t"><thead><tr><th>When</th><th>User</th><th>Event</th><th>Record</th><th>Detail</th></tr></thead><tbody>
          {(data?.rows || []).map((r) => <Fragment key={r.id}><tr className="click" tabIndex={0} aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(open === r.id ? null : r.id)}><td className="nowrap">{fmtDateTime(r.ts)}</td><td>{r.user_name || 'system'}</td><td><Badge>{r.event}</Badge></td><td>{r.entity ? <>{r.entity}{r.record_id ? ` #${r.record_id}` : ''} <span className="muted">{r.record_label}</span></> : '—'}</td><td className="muted small">{(r.detail || '').slice(0, 90)}</td></tr>
            {open === r.id && <tr key={`${r.id}x`}><td colSpan={5} style={{ background: 'var(--surface-2)' }}><div className="small"><b>IP:</b> {r.ip || '—'} · <b>Source:</b> {r.data_source}</div>{r.detail && <div className="small">{r.detail}</div>}{r.changes && <pre className="small" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.changes, null, 1)}</pre>}</td></tr>}</Fragment>)}</tbody></table>
          {loading && <Spinner />}{!loading && (data?.rows || []).length === 0 && <Empty icon="audit">No audit events match.</Empty>}</div>
        <div className="pager"><span>{data?.total ?? 0} events</span><div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button><span>Page {page}</span><button className="btn sm" disabled={!data || page * 40 >= data.total} onClick={() => setPage(page + 1)}>Next ›</button></div></div>
      </div>
    </>
  );
}

// ---------------------------------------------------------- app configuration
export function AppSettingsPage() {
  const toast = useToast(); const { data, error, loading, reload } = useAsync(() => api.get('/settings/app'), []); const [ed, setEd] = useState(null); const [val, setVal] = useState(''); const [note, setNote] = useState(''); const [err, setErr] = useState(null); const [hist, setHist] = useState(null);
  if (error) return <ErrorBox error={error} />; if (loading) return <Spinner />;
  const areas = [...new Set(data.map((s) => s.area))];
  const open = (s) => { setEd(s); setVal(s.secret ? '' : typeof s.value === 'string' ? s.value : JSON.stringify(s.value)); setNote(''); setErr(null); };
  const parse = (s) => { if (s.secret) return val; try { return typeof s.value === 'string' ? val : JSON.parse(val); } catch { throw new Error('Invalid value format'); } };
  const save = async () => { try { const r = await api.put(`/settings/app/${ed.key}`, { value: parse(ed), note }); toast(r.status === 'Applied' ? 'Setting applied' : `Submitted for approval (${r.approval})`, 'success'); setEd(null); reload(); } catch (e) { setErr(e); } };
  const showHist = async (s) => setHist({ s, rows: await api.get(`/settings/app/${s.key}/versions`) });
  return (
    <>
      <PageHead title="Configuration" sub="Thresholds and policies. Sensitive changes (marked) require approval and are versioned with rollback." />
      <div className="stack">{areas.map((a) => (
        <Card key={a} title={a} pad={false}>
          <table className="t"><tbody>{data.filter((s) => s.area === a).map((s) => <tr key={s.key}><td style={{ width: '34%' }}><b className="mono small">{s.key}</b><div className="muted small">{s.description}</div></td><td><code>{JSON.stringify(s.value)}</code> {s.sensitive && <Badge v="Pending">needs approval</Badge>} {s.pending > 0 && <Badge v="Pending">{s.pending} pending</Badge>}</td><td className="muted small">v{s.version}</td><td className="right nowrap"><button className="btn sm ghost" onClick={() => showHist(s)}>History</button> {s.editable && <button className="btn sm" onClick={() => open(s)}>Change</button>}</td></tr>)}</tbody></table>
        </Card>))}</div>
      {ed && <Modal title={`Change ${ed.key}`} size="narrow" onClose={() => setEd(null)} footer={<><button className="btn" onClick={() => setEd(null)}>Cancel</button><button className="btn primary" onClick={save}>{ed.sensitive ? 'Submit for approval' : 'Apply'}</button></>}>
        <div className="stack"><label className="f">New value (JSON for numbers, booleans, lists)<input type={ed.secret ? 'password' : 'text'} value={val} onChange={(e) => setVal(e.target.value)} /></label><label className="f">Change note<input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></label>
          {ed.sensitive && <Alert kind="warn">This is a sensitive setting. The change takes effect only after the configured approver accepts it.</Alert>}<ErrorBox error={err} /></div></Modal>}
      {hist && <Modal title={`Version history: ${hist.s.key}`} size="wide" onClose={() => setHist(null)}><table className="t"><thead><tr><th>Version</th><th>Value</th><th>Changed by</th><th>When</th><th>Status</th><th /></tr></thead><tbody>{hist.rows.map((v) => <tr key={v.id}><td>v{v.version}</td><td><code>{JSON.stringify(v.value)}</code></td><td>{v.changed_by_name || 'system'}</td><td>{fmtDateTime(v.changed_at)}</td><td><Badge v={v.status} />{v.note && <div className="muted small">{v.note}</div>}</td><td>{hist.s.editable && !hist.s.secret && v.status === 'Superseded' && <button className="btn sm" onClick={async () => { try { await api.post(`/settings/app/${hist.s.key}/rollback`, { version_id: v.id }); toast('Rollback applied / submitted', 'success'); setHist(null); reload(); } catch (e) { toast(e.message, 'error'); } }}>Roll back</button>}</td></tr>)}</tbody></table></Modal>}
    </>
  );
}

export function DataQualityPage() {
  const { data, error, loading } = useAsync(() => api.get('/admin/data-quality'), []);
  if (error) return <ErrorBox error={error} />; if (loading) return <Spinner />;
  const K = ({ l, v }) => <div className="card kpi"><div className="label">{l}</div><div className="value" style={{ color: v > 0 ? 'var(--warn)' : 'var(--good)' }}>{v}</div></div>;
  return (
    <>
      <PageHead title="Data quality" sub="Data quality is the main adoption risk — review and resolve regularly (merge accounts from the account page)." />
      <div className="grid g4" style={{ marginBottom: 'var(--sp-6)' }}><K l="Accounts missing tax ID" v={data.accounts_missing_tax_id} /><K l="Contacts without email" v={data.contacts_without_email} /><K l="Open deals past close date" v={data.open_opps_past_close} /><K l="Active products without cost" v={data.products_missing_cost} /><K l="Open deals with inactive owner" v={data.inactive_owner_records} /></div>
      <div className="grid g2"><Card title="Duplicate account names" pad={false}><table className="t"><tbody>{data.duplicate_account_names.map((d) => <tr key={d.name}><td>{d.name}</td><td className="num">{d.n}</td></tr>)}</tbody></table>{data.duplicate_account_names.length === 0 && <Empty small icon="inbox">None found</Empty>}</Card><Card title="Duplicate contact emails" pad={false}><table className="t"><tbody>{data.duplicate_contact_emails.map((d) => <tr key={d.email}><td>{d.email}</td><td className="num">{d.n}</td></tr>)}</tbody></table>{data.duplicate_contact_emails.length === 0 && <Empty small icon="inbox">None found</Empty>}</Card></div>
    </>
  );
}

export function OrgPage() {
  const [tab, setTab] = useState('org_units');
  const tabs = [['org_units', 'Legal entities'], ['business_units', 'Business units'], ['branches', 'Branches'], ['teams', 'Teams'], ['territories', 'Territories'], ['reporting_lines', 'Reporting lines']].map(([key, label]) => ({ key, label }));
  return (<><PageHead title="Organisation" sub="Legal entities, business units, branches, teams and effective-dated reporting lines." /><Tabs tabs={tabs} value={tab} onChange={setTab} /><EntityTable entity={tab} key={tab} onNew={() => {}} onRowClick={() => {}} /></>);
}

export function IntegrationLogs() {
  const toast = useToast(); const [status, setStatus] = useState(''); const { data, error, loading, reload } = useAsync(() => api.get(`/integrations/logs${status ? `?status=${status}` : ''}`), [status]);
  const op = async (l, o) => { try { await api.post(`/integrations/logs/${l.id}/${o}`, o === 'discard' ? { reason: 'Discarded by admin' } : {}); toast('Done', 'success'); reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <>
      <PageHead title="Integration monitor" sub="Outbound/inbound message tracking with retry and dead-letter handling (INT-01…INT-23)."><Link className="btn" to="/integrations">Connectors</Link></PageHead>
      <div className="card"><div className="toolbar">{['', 'Pending', 'Succeeded', 'Failed', 'Dead-letter', 'Resubmitted', 'Discarded'].map((s) => <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{s || 'All'}</button>)}</div>
        <ErrorBox error={error} /><div className="table-wrap"><table className="t"><thead><tr><th>#</th><th>Integration</th><th>Direction</th><th>Record</th><th>Status</th><th className="num">Attempts</th><th>Error</th><th>When</th><th /></tr></thead><tbody>
          {(data || []).map((l) => <tr key={l.id}><td>{l.id}</td><td><b>{l.integration_code}</b></td><td>{l.direction}</td><td>{l.entity} #{l.record_id}</td><td><Badge v={l.status} /></td><td className="num">{l.attempts}</td><td className="muted small">{l.error}</td><td className="muted small">{fmtDateTime(l.updated_at)}</td><td className="right nowrap">{['Failed', 'Dead-letter'].includes(l.status) && <><button className="btn sm" onClick={() => op(l, 'resubmit')}>Resubmit</button> <button className="btn sm danger" onClick={() => op(l, 'discard')}>Discard</button></>}</td></tr>)}</tbody></table>
          {loading && <Spinner />}{!loading && (data || []).length === 0 && <Empty icon="integrations">No messages.</Empty>}</div></div>
    </>
  );
}
