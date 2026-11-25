import { useEffect, useState } from 'react';
import { VIZ, AXIS, GRID, TIP } from '../components/chart';
import { reducedMotion } from '../breakpoints';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, openAuthed } from '../api';
import { useAsync, useAuth, useToast } from '../state';
import { Card, ErrorBox, PageHead, Spinner, Empty } from '../components/ui';
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
        <nav className="card side-list" aria-label="Reports">{list.map((r) => <button key={r.id} className={`side-list-item ${r.id === id ? 'on' : ''}`} aria-current={r.id === id ? 'true' : undefined} onClick={() => setId(r.id)}><span className="name">{r.name}</span><span className="code">{r.id}</span></button>)}</nav>
        <Card title={rep?.name || 'Report'} actions={can('M22', 'X') && id && <button className="btn sm" onClick={() => openAuthed(`/reports/${id}?format=csv`, `${id}.csv`).catch((e) => toast(e.message, 'error'))}>Export CSV</button>}>
          <ErrorBox error={err} />{loading && <Spinner />}
          {rep && !loading && <div className="table-wrap"><table className="t"><thead><tr>{rep.columns.map((c) => <th key={c.key} className={['money', 'pct', 'int', 'num'].includes(c.type) ? 'num' : ''}>{c.label}</th>)}</tr></thead><tbody>{rep.rows.map((r, i) => <tr key={i}>{rep.columns.map((c) => <td key={c.key} className={['money', 'pct', 'int', 'num'].includes(c.type) ? 'num mono' : ''}>{cell(c, r[c.key])}</td>)}</tr>)}</tbody></table>{rep.rows.length === 0 && <Empty icon="reports">No data for your scope.</Empty>}</div>}
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
      <div className="grid g2" style={{ marginBottom: 'var(--sp-6)' }}>
        <Card title="Activities by type"><div style={{ height: 260 }}><ResponsiveContainer><BarChart data={data.by_type}><CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="activity_type" tick={AXIS} stroke={GRID} /><YAxis width={32} tick={AXIS} stroke={GRID} /><Tooltip cursor={{ fill: 'var(--bg-hover)' }} contentStyle={TIP} /><Legend wrapperStyle={{ fontSize: 13 }} /><Bar isAnimationActive={!reducedMotion()} dataKey="n" fill="var(--viz-brand)" name="Completed" radius={[2, 2, 0, 0]} /><Bar isAnimationActive={!reducedMotion()} dataKey="positive" fill="var(--viz-good)" name="Positive outcome" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
        <Card title="Weekly activity volume"><div style={{ height: 260 }}><ResponsiveContainer><BarChart data={data.by_week}><CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="week" tick={AXIS} stroke={GRID} /><YAxis width={32} tick={AXIS} stroke={GRID} /><Tooltip cursor={{ fill: 'var(--bg-hover)' }} contentStyle={TIP} /><Bar isAnimationActive={!reducedMotion()} dataKey="n" fill="var(--viz-1)" name="Activities" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
      </div>
      <Card title="Effort vs outcome by person" pad={false}><table className="t"><thead><tr><th>Person</th><th className="num">Activities</th><th className="num">Opps touched</th><th className="num">Positive</th><th className="num">Deals won</th><th className="num">Won value</th></tr></thead><tbody>{data.by_user.map((u) => <tr key={u.name}><td>{u.name}</td><td className="num">{u.activities}</td><td className="num">{u.opportunities_touched}</td><td className="num">{u.positive}</td><td className="num">{u.outcomes.won}</td><td className="num mono">{fmtMoney(u.outcomes.won_value)}</td></tr>)}</tbody></table>
        <div className="help" style={{ padding: 'var(--sp-5) var(--sp-6)' }}>High activity does not guarantee outcomes: this view keeps effort and results separate so managers coach rather than count (FR-ACTR).</div></Card>
    </>
  );
}
