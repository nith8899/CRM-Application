import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAsync, useAuth, useToast } from '../state';
import { Alert, Badge, Card, ErrorBox, PageHead, Spinner, Tabs } from '../components/ui';
import { EntityTable, FormModal } from '../components/entity';
import { FieldInput } from '../components/fields';
import { fmtDate, fmtDateTime } from '../util';

// ------------------------------------------------------------------ calendar
export function CalendarPage() {
  const { can } = useAuth(); const nav = useNavigate(); const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); }); const [data, setData] = useState(null); const [show, setShow] = useState(false); const [err, setErr] = useState(null);
  const first = new Date(month.getFullYear(), month.getMonth(), 1); const startOffset = (first.getDay() + 6) % 7; const gridStart = new Date(first); gridStart.setDate(1 - startOffset);
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const load = () => { api.get(`/calendar?from=${days[0].toISOString()}&to=${new Date(days[41].getTime() + 86400000).toISOString()}`).then((d) => { setData(d); setErr(null); }).catch(setErr); };
  useEffect(load, [month]); // eslint-disable-line
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const byDay = useMemo(() => {
    const m = {}; const add = (k, e) => { (m[k] ||= []).push(e); };
    if (!data) return m;
    data.meetings.forEach((x) => add(key(new Date(x.start_at)), { t: 'mtg', label: `${new Date(x.start_at).toTimeString().slice(0, 5)} ${x.subject}`, to: `/meetings/${x.id}` }));
    data.tasks.forEach((x) => add(key(new Date(x.due_at)), { t: 'task', label: `☑ ${x.subject}`, to: `/tasks/${x.id}` }));
    data.events.forEach((x) => add(key(new Date(x.start_at)), { t: 'mtg', label: `★ ${x.name}`, to: `/events/${x.id}` }));
    data.company.forEach((c) => { const s = new Date(c.start_date); const e = new Date(c.end_date); for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) add(key(d), { t: 'hol', label: c.title, nonworking: c.non_working }); });
    return m;
  }, [data]);
  const todayKey = key(new Date());
  return (
    <>
      <PageHead title="Calendar" sub="Your meetings, task deadlines, published events and company calendar.">
        <button className="btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">‹</button><b style={{ minWidth: 130, textAlign: 'center' }}>{month.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</b><button className="btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">›</button>
        <button className="btn" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>{can('M11', 'C') && <button className="btn primary" onClick={() => setShow(true)}>+ Meeting</button>}
      </PageHead>
      <ErrorBox error={err} />
      <div className="cal" role="grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="h">{d}</div>)}
        {days.map((d) => { const k = key(d); const evs = byDay[k] || []; const off = evs.some((e) => e.nonworking) || d.getDay() === 0 || d.getDay() === 6;
          return <div key={k} className={`d ${k === todayKey ? 'today' : ''} ${off ? 'off' : ''}`} style={{ opacity: d.getMonth() === month.getMonth() ? 1 : 0.5 }}><b className="small">{d.getDate()}</b>{evs.slice(0, 4).map((e, i) => (e.to ? <Link key={i} className={`ev ${e.t === 'task' ? 'task' : e.t === 'hol' ? 'hol' : ''}`} to={e.to} title={e.label}>{e.label}</Link> : <span key={i} className="ev hol" title={e.label}>{e.label}</span>))}{evs.length > 4 && <span className="muted small">+{evs.length - 4} more</span>}</div>; })}
      </div>
      {show && <FormModal entity="meetings" onClose={() => setShow(false)} onSaved={(r) => nav(`/meetings/${r.id}`)} />}
    </>
  );
}

// ------------------------------------------------------------------- my work
export function MyWorkPage() {
  const toast = useToast(); const [key, setKey] = useState(0); const [show, setShow] = useState(false);
  const { data, error, loading, reload } = useAsync(() => api.get('/e/tasks?mine=1&size=200&sort=due_at&dir=asc'), [key]);
  if (error) return <ErrorBox error={error} />;
  const open = (data?.rows || []).filter((t) => !['Completed', 'Cancelled'].includes(t.status)); const now = new Date(); const eod = new Date(); eod.setHours(23, 59, 59, 999);
  const groups = [['Overdue', open.filter((t) => t.due_at && new Date(t.due_at) < now)], ['Due today', open.filter((t) => t.due_at && new Date(t.due_at) >= now && new Date(t.due_at) <= eod)], ['Upcoming', open.filter((t) => t.due_at && new Date(t.due_at) > eod)], ['No due date', open.filter((t) => !t.due_at)]];
  const complete = async (t) => { try { await api.post(`/e/tasks/${t.id}/actions/complete`); toast('Task completed', 'success'); reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <>
      <PageHead title="My work" sub="Tasks assigned to you, including auto-generated follow-ups."><button className="btn primary" onClick={() => setShow(true)}>+ New task</button><Link className="btn" to="/tasks">All tasks</Link></PageHead>
      {loading && <Spinner />}
      <div className="stack">
        {groups.map(([name, rows]) => rows.length > 0 && (
          <Card key={name} title={`${name} (${rows.length})`} pad={false}>
            <table className="t"><tbody>{rows.map((t) => <tr key={t.id}><td style={{ width: 40 }}><input type="checkbox" aria-label={`Complete ${t.subject}`} onChange={() => complete(t)} /></td><td><Link to={`/tasks/${t.id}`}>{t.subject}</Link>{t.related_label && <div className="muted small">{t.related_label}</div>}{t.auto_generated && <span className="badge info" style={{ marginLeft: 6 }}>auto</span>}</td><td><Badge v={t.priority} /></td><td><Badge v={t.status} /></td><td className={name === 'Overdue' ? 'err nowrap' : 'nowrap'}>{fmtDateTime(t.due_at)}</td><td>{t.escalation_status !== 'None' && <Badge v="High">{t.escalation_status}</Badge>}</td></tr>)}</tbody></table>
          </Card>
        ))}
        {!loading && open.length === 0 && <div className="empty">You have no open tasks. 🎉</div>}
      </div>
      {show && <FormModal entity="tasks" onClose={() => setShow(false)} onSaved={() => setKey((k) => k + 1)} />}
    </>
  );
}

// ------------------------------------------------------------------ org chart
export function OrgChartPage() {
  const { hasRole } = useAuth(); const { data, error, loading } = useAsync(() => api.get('/org/chart'), []);
  const [prev, setPrev] = useState({}); const [res, setRes] = useState(null); const [err, setErr] = useState(null); const [lab, setLab] = useState({});
  const tree = useMemo(() => { if (!data) return []; const by = {}; data.forEach((u) => { by[u.id] = { ...u, kids: [] }; }); const roots = []; data.forEach((u) => { if (u.manager_id && by[u.manager_id]) by[u.manager_id].kids.push(by[u.id]); else roots.push(by[u.id]); }); return roots; }, [data]);
  const Node = ({ n }) => <li><span className="node"><span className="avatar">{n.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span><span><b>{n.name}</b><div className="muted small">{n.job_title}{n.team ? ` · ${n.team}` : ''}{n.job_grade ? ` · ${n.job_grade}` : ''}</div></span></span>{n.kids.length > 0 && <ul>{n.kids.map((k) => <Node key={k.id} n={k} />)}</ul>}</li>;
  if (error) return <ErrorBox error={error} />; if (loading) return <Spinner />;
  return (
    <>
      <PageHead title="Organisation chart" sub="Reporting lines drive record visibility and dynamic approver resolution. Sensitive employee data is privacy-filtered." />
      {hasRole('ROL-ORGA', 'ROL-ADM') && (
        <Card title="Impact preview — what changes if an employee changes manager?">
          <div className="row wrap"><div style={{ width: 240 }}><FieldInput field={{ name: 'e', label: 'Employee', type: 'ref', ref: 'users' }} value={prev.employee_id} labelValue={lab.e} onChange={(n, v, l) => { setPrev({ ...prev, employee_id: v }); setLab({ ...lab, e: l }); }} /></div><div style={{ width: 240 }}><FieldInput field={{ name: 'm', label: 'New manager', type: 'ref', ref: 'users' }} value={prev.new_manager_id} labelValue={lab.m} onChange={(n, v, l) => { setPrev({ ...prev, new_manager_id: v }); setLab({ ...lab, m: l }); }} /></div>
            <button className="btn primary" style={{ marginTop: 18 }} disabled={!prev.employee_id} onClick={async () => { try { setRes(await api.post('/org/impact-preview', prev)); setErr(null); } catch (e) { setErr(e); setRes(null); } }}>Preview impact</button></div>
          <ErrorBox error={err} />
          {res && <Alert kind="info"><b>{res.employee}</b>: {res.direct_reports} direct reports · {res.open_opportunities} open opportunities · {res.open_tasks} open tasks · {res.pending_approval_steps_as_approver} pending approval steps · {res.pending_approvals_as_submitter} pending requests · {res.claims_in_approval} claims in approval.<div className="small">{res.note}</div></Alert>}
        </Card>
      )}
      <div style={{ height: 14 }} />
      <Card><div className="tree"><ul>{tree.map((n) => <Node key={n.id} n={n} />)}</ul></div></Card>
    </>
  );
}
