import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { useAsync, useAuth } from '../state';
import { Badge, Card, Empty, ErrorBox, PageHead, Spinner } from '../components/ui';
import { Icon } from '../components/icons';
import { VIZ, AXIS, GRID, TIP } from '../components/chart';
import { fmtCompact, fmtDate, fmtDateTime, fmtMoney } from '../util';

const Kpi = ({ label, value, hint, to, icon }) => { const body = <div className="card kpi"><div className="label">{icon && <Icon name={icon} size={16} />}{label}</div><div className="value">{value}</div>{hint && <div className="hint">{hint}</div>}</div>; return to ? <Link to={to} className="kpi-link">{body}</Link> : body; };
const List = ({ rows, render, empty = 'Nothing to show', emptyIcon = 'inbox' }) => (rows && rows.length ? <ul className="list">{rows.map((r, i) => <li key={r.id ?? i}>{render(r)}</li>)}</ul> : <Empty small icon={emptyIcon}>{empty}</Empty>);

export default function Dashboard() {
  const { me } = useAuth();
  const { data, error, loading } = useAsync(() => api.get('/dashboard'), []);
  if (loading) return <Spinner />; if (error) return <ErrorBox error={error} />;
  const W = data.widgets; const k = W.kpis;
  return (
    <>
      <PageHead title={`Welcome back, ${me.name.split(' ')[0]}`} sub={`${me.job_title || ''}${me.team ? ' · ' + me.team : ''}`} />
      <div className="grid kpis" style={{ marginBottom: 'var(--sp-6)' }}>
        {k && <Kpi icon="pipeline" label="Open pipeline" value={fmtCompact(k.pipeline)} hint={`${k.open_count} opportunities · avg ${fmtCompact(k.avg_deal)}`} to="/pipeline" />}
        {k && <Kpi icon="opportunities" label="Weighted pipeline" value={fmtCompact(k.weighted)} hint="Σ amount × probability" />}
        {k && <Kpi icon="targets" label="Won this quarter" value={fmtCompact(k.won_qtd)} hint={`${k.won_count} won · ${k.lost_count} lost${k.win_rate != null ? ` · win rate ${k.win_rate}%` : ''}`} />}
        {W.forecast && <Kpi icon="forecast" label={`Forecast ${W.forecast.period}`} value={fmtCompact(W.forecast.commit)} hint={`Commit · best case ${fmtCompact(W.forecast.best_case)}`} to="/forecast" />}
        <Kpi icon="tasks" label="My tasks" value={W.tasks.open} hint={`${W.tasks.due_today} due today · ${W.tasks.overdue} overdue`} to="/tasks" />
        {W.approvals.pending > 0 || me.modules.M15 ? <Kpi icon="approvals" label="Awaiting my approval" value={W.approvals.pending} to="/approvals" hint="Open the approvals inbox" /> : null}
      </div>
      <div className="grid g2" style={{ marginBottom: 'var(--sp-6)' }}>
        {W.by_stage && (
          <Card title="Pipeline by stage">
            <div style={{ height: 260 }}><ResponsiveContainer><BarChart data={W.by_stage}><CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="code" tick={AXIS} stroke={GRID} /><YAxis tickFormatter={fmtCompact} width={48} tick={AXIS} stroke={GRID} /><Tooltip cursor={{ fill: 'var(--bg-hover)' }} contentStyle={TIP} formatter={(v) => fmtMoney(v)} labelFormatter={(l) => W.by_stage.find((s) => s.code === l)?.name || l} /><Bar dataKey="amount" name="Amount" fill="var(--viz-brand)" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer></div>
          </Card>
        )}
        {W.monthly_won && (
          <Card title="Closed won — last 6 months">
            {W.monthly_won.length ? <div style={{ height: 260 }}><ResponsiveContainer><BarChart data={W.monthly_won}><CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="month" tick={AXIS} stroke={GRID} /><YAxis tickFormatter={fmtCompact} width={48} tick={AXIS} stroke={GRID} /><Tooltip cursor={{ fill: 'var(--bg-hover)' }} contentStyle={TIP} formatter={(v) => fmtMoney(v)} /><Bar dataKey="won" name="Won" fill="var(--viz-good)" radius={[2, 2, 0, 0]} maxBarSize={56} /></BarChart></ResponsiveContainer></div> : <Empty small icon="targets">No closed-won deals yet</Empty>}
          </Card>
        )}
      </div>
      <div className="grid g3">
        <Card title="My tasks" actions={<Link to="/tasks" className="small">All tasks</Link>}><List rows={W.my_tasks} render={(t) => <div className="row spread"><Link to={`/tasks/${t.id}`}>{t.subject}</Link><span className="nowrap small"><Badge v={t.priority} /> <span className={t.due_at && new Date(t.due_at) < new Date() ? 'err' : 'muted'}>{fmtDate(t.due_at)}</span></span></div>} empty="No open tasks. You're clear." emptyIcon="success" /></Card>
        <Card title="Upcoming meetings" actions={<Link to="/calendar" className="small">Calendar</Link>}><List rows={W.my_meetings} render={(m) => <div><Link to={`/meetings/${m.id}`}>{m.subject}</Link><div className="muted small">{fmtDateTime(m.start_at)} {m.location ? `· ${m.location}` : ''}</div></div>} /></Card>
        {W.top_deals && <Card title="Top open deals" actions={<Link to="/opportunities" className="small">All</Link>}><List rows={W.top_deals} render={(d) => <div className="row spread"><div><Link to={`/opportunities/${d.id}`}>{d.name}</Link><div className="muted small">{d.account} · closes {fmtDate(d.close_date)}</div></div><div className="right"><b className="mono">{fmtCompact(d.amount_base)}</b><div className="muted small">{d.probability}%</div></div></div>} /></Card>}
        {W.stalled && <Card title="Needs attention — stalled deals"><List rows={W.stalled} render={(d) => <div className="row spread"><Link to={`/opportunities/${d.id}`}>{d.name}</Link><Badge v="Overdue">stalled</Badge></div>} empty="No stalled opportunities" /></Card>}
        {W.expiring_quotes && <Card title="Quotations expiring (14 days)"><List rows={W.expiring_quotes} render={(q) => <div className="row spread"><Link to={`/quotations/${q.id}`}>{q.number}</Link><span className="muted small">{fmtDate(q.valid_until)} · {fmtMoney(q.grand_total, q.currency)}</span></div>} /></Card>}
        {W.renewals && <Card title="Renewals due (90 days)"><List rows={W.renewals} render={(r) => <div className="row spread"><Link to={`/renewals/${r.id}`}>{r.contract}</Link><span className="muted small">{fmtDate(r.due_date)}</span></div>} /></Card>}
        {W.leads && <Card title="Leads by status"><div style={{ height: 200 }}><ResponsiveContainer><PieChart><Pie data={W.leads} stroke="var(--bg-surface)" dataKey="n" nameKey="status" innerRadius={42} outerRadius={78} label={(e) => `${e.status} ${e.n}`}>{W.leads.map((e, i) => <Cell key={e.status} fill={VIZ[i % VIZ.length]} />)}</Pie><Tooltip contentStyle={TIP} /></PieChart></ResponsiveContainer></div></Card>}
        {W.dreg_expiring && <Card title="Deal registrations expiring"><List rows={W.dreg_expiring} render={(d) => <div className="row spread"><Link to={`/deal_registrations/${d.id}`}>{d.number}</Link><span className="muted small">{fmtDate(d.protection_end)}</span></div>} /></Card>}
        {W.my_claims && W.my_claims.length > 0 && <Card title="My claims" actions={<Link to="/claims" className="small">All claims</Link>}><List rows={W.my_claims} render={(c) => <div className="row spread"><span><Badge v={c.status} /> <Badge v={c.payment_status} /></span><span className="mono">{c.n} · {fmtMoney(c.total)}</span></div>} /></Card>}
      </div>
    </>
  );
}
