import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, openAuthed } from '../api';
import { useAsync, useAuth, useToast } from '../state';
import { Card, ErrorBox, PageHead, Spinner } from '../components/ui';
import { fmtDate, fmtMoney, fmtPct } from '../util';

const cell = (c, v) => { if (v == null) return '—'; if (c.type === 'money') return fmtMoney(v); if (c.type === 'pct') return fmtPct(v); if (c.type === 'int') return Number(v).toLocaleString(); if (c.type === 'num') return Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 }); if (/_at$|date|valid_until|due/.test(c.key)) return fmtDate(v); return String(v); };

export function ReportsPage() {
  const { can } = useAuth(); const toast = useToast();
  const { data: list, error } = useAsync(() => api.get('/reports'), []);
  const [id, setId] = useState(null); const [rep, setRep] = useState(null); const [err, setErr] = useState(null); const [loading, setLoading] = useState(false);
  useEffect(() => { if (!id) return; setLoading(true); setErr(null); api.get(`/reports/${id}`).then(setRep).catch(setErr).finally(() => setLoading(false)); }, [id]);
  useEffect(() => { if (list && list.length && !id) setId(list[0].id); }, [list, id]);
  if (error) return <ErrorBox error={error} />; if (!list) return <Spinner />;
  return (
    <>
      <PageHead title="Reports" sub="Standard reports respect your record visibility and field-level security. Exports are audited." />
      <div className="grid" style={{ gridTemplateColumns: '260px minmax(0,1fr)', alignItems: 'start' }}>
        <div className="card" style={{ padding: 6 }}>{list.map((r) => <button key={r.id} className="btn ghost" style={{ display: 'block', width: '100%', textAlign: 'left', background: r.id === id ? 'var(--primary-soft)' : undefined }} onClick={() => setId(r.id)}><span className="muted small">{r.id}</span><div>{r.name}</div></button>)}</div>
        <Card title={rep?.name || 'Report'} actions={can('M22', 'X') && id && <button className="btn sm" onClick={() => openAuthed(`/reports/${id}?format=csv`, `${id}.csv`).catch((e) => toast(e.message, 'error'))}>Export CSV</button>}>
          <ErrorBox error={err} />{loading && <Spinner />}
          {rep && !loading && <div className="table-wrap"><table className="t"><thead><tr>{rep.columns.map((c) => <th key={c.key} className={['money', 'pct', 'int', 'num'].includes(c.type) ? 'num' : ''}>{c.label}</th>)}</tr></thead><tbody>{rep.rows.map((r, i) => <tr key={i}>{rep.columns.map((c) => <td key={c.key} className={['money', 'pct', 'int', 'num'].includes(c.type) ? 'num mono' : ''}>{cell(c, r[c.key])}</td>)}</tr>)}</tbody></table>{rep.rows.length === 0 && <div className="empty">No data for your scope.</div>}</div>}
        </Card>
      </div>
    </>
  );
}

export function AnalyticsPage() {
  const { data, error, loading } = useAsync(() => api.get('/analytics/activities'), []);
  if (loading) return <Spinner />; if (error) return <ErrorBox error={error} />;
  return (
    <>
      <PageHead title="Activity analytics" sub={`Effort versus outcomes since ${data.from}, scoped to your reporting line / team / organisation.`} />
      <div className="grid g2" style={{ marginBottom: 14 }}>
        <Card title="Activities by type"><div style={{ height: 260 }}><ResponsiveContainer><BarChart data={data.by_type}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="activity_type" tick={{ fontSize: 12 }} /><YAxis width={32} /><Tooltip /><Legend /><Bar dataKey="n" fill="#2563eb" name="Completed" radius={[4, 4, 0, 0]} /><Bar dataKey="positive" fill="#16a34a" name="Positive outcome" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
        <Card title="Weekly activity volume"><div style={{ height: 260 }}><ResponsiveContainer><BarChart data={data.by_week}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="week" tick={{ fontSize: 11 }} /><YAxis width={32} /><Tooltip /><Bar dataKey="n" fill="#8b5cf6" name="Activities" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
      </div>
      <Card title="Effort vs outcome by person" pad={false}><table className="t"><thead><tr><th>Person</th><th className="num">Activities</th><th className="num">Opps touched</th><th className="num">Positive</th><th className="num">Deals won</th><th className="num">Won value</th></tr></thead><tbody>{data.by_user.map((u) => <tr key={u.name}><td>{u.name}</td><td className="num">{u.activities}</td><td className="num">{u.opportunities_touched}</td><td className="num">{u.positive}</td><td className="num">{u.outcomes.won}</td><td className="num mono">{fmtMoney(u.outcomes.won_value)}</td></tr>)}</tbody></table>
        <div className="help" style={{ padding: 12 }}>High activity does not guarantee outcomes: this view keeps effort and results separate so managers coach rather than count (FR-ACTR).</div></Card>
    </>
  );
}
