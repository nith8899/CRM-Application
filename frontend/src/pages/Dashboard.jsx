// Dashboard v2 (pilot): next action first → 4 decision KPIs → trends → my lists.
// docs/redesign/01-audit-and-strategy.md DB-1…DB-3. Uses only data the /dashboard API already returns.
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { useAsync, useAuth } from '../state';
import { Badge, Card, Empty, ErrorBox, PageHead, Skeleton } from '../components/ui';
import { Icon } from '../components/icons';
import { AXIS, GRID, TIP, VIZ } from '../components/chart';
import { reducedMotion } from '../breakpoints';
import { fmtCompact, fmtDate, fmtDateTime, fmtMoney } from '../util';
import { roleName } from '../nav';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

function Kpi({ icon, label, value, hint, to }) {
  const body = <div className="card kpi"><div className="label"><Icon name={icon} size={16} />{label}</div><div className="value">{value}</div>{hint && <div className="hint">{hint}</div>}</div>;
  return to ? <Link to={to} className="kpi-link" aria-label={`${label}: ${value}. ${hint || ''}`}>{body}</Link> : body;
}

function List({ rows, render, empty, emptyIcon = 'inbox' }) {
  return rows && rows.length ? <ul className="list">{rows.map((r, i) => <li key={r.id ?? i}>{render(r)}</li>)}</ul> : <Empty small icon={emptyIcon}>{empty}</Empty>;
}

export default function Dashboard() {
  const { me } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.get('/dashboard'), []);
  if (loading) return <><PageHead title={`${greeting()}, ${me.name.split(' ')[0]}`} /><Skeleton variant="cards" /><div style={{ height: 'var(--sp-6)' }} /><Skeleton variant="rows" /></>;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const W = data.widgets; const k = W.kpis; const anim = !reducedMotion();
  const asOf = `Updated ${fmtDateTime(new Date())}`;

  // "Needs your action": only items that exist for this role and are non-zero, most urgent first.
  const actions = [
    W.approvals?.pending > 0 && { icon: 'approvals', tone: 'warn', n: W.approvals.pending, label: 'Approvals waiting for your decision', to: '/approvals' },
    W.tasks?.overdue > 0 && { icon: 'tasks', tone: 'bad', n: W.tasks.overdue, label: 'Overdue tasks', to: '/my-work' },
    W.stalled?.length > 0 && { icon: 'warning', tone: 'bad', n: W.stalled.length, label: 'Stalled opportunities with no recent progress', to: '/opportunities' },
    W.expiring_quotes?.length > 0 && { icon: 'quotations', tone: 'warn', n: W.expiring_quotes.length, label: 'Quotations expiring in the next 14 days', to: '/quotations' },
    W.tasks?.due_today > 0 && { icon: 'calendar', tone: 'info', n: W.tasks.due_today, label: 'Tasks due today', to: '/my-work' },
    W.renewals?.length > 0 && { icon: 'contracts', tone: 'info', n: W.renewals.length, label: 'Renewals due in the next 90 days', to: '/contracts' },
    W.dreg_expiring?.length > 0 && { icon: 'dealRegistrations', tone: 'info', n: W.dreg_expiring.length, label: 'Deal registrations nearing protection expiry', to: '/deal_registrations' },
  ].filter(Boolean);

  const stageData = (W.by_stage || []).filter((s) => s.amount > 0 || s.count > 0);
  const maxLead = Math.max(1, ...(W.leads || []).map((l) => l.n));

  return (
    <>
      <PageHead eyebrow={new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} title={`${greeting()}, ${me.name.split(' ')[0]}`}
        sub={[me.job_title || me.roles.filter((r) => !['ROL-EMP', 'ROL-DM'].includes(r)).map(roleName)[0], me.team].filter(Boolean).join(' · ')} />

      <div className="dash">
        <div className="dash-main">
          <Card title="Needs your action" sub={actions.length ? `${actions.reduce((a, x) => a + x.n, 0)} items across ${actions.length} areas` : undefined} pad={false}>
            {actions.length ? (
              <ul className="action-list">
                {actions.map((a) => <li key={a.label}><Link to={a.to}><span className={`ai ${a.tone}`}><Icon name={a.icon} size={16} /></span><span className="grow">{a.label}</span><span className="n">{a.n}</span><Icon name="chevronRight" size={16} /></Link></li>)}
              </ul>
            ) : <Empty icon="success" title="You're all caught up">No approvals, overdue tasks or expiring items right now.</Empty>}
          </Card>

          {(k || W.forecast) && (
            <section aria-labelledby="kpi-h">
              <div className="row spread" style={{ marginBottom: 'var(--sp-4)' }}><h2 id="kpi-h" style={{ fontSize: 'var(--fs-card)' }}>Pipeline at a glance</h2><span className="asof">{asOf}</span></div>
              <div className="grid kpis">
                {k && <Kpi icon="pipeline" label="Open pipeline" value={fmtCompact(k.pipeline)} hint={`${k.open_count} open opportunities · avg ${fmtCompact(k.avg_deal)}`} to="/opportunities" />}
                {k && <Kpi icon="opportunities" label="Weighted pipeline" value={fmtCompact(k.weighted)} hint="Amount × probability" />}
                {k && <Kpi icon="targets" label="Won this quarter" value={fmtCompact(k.won_qtd)} hint={`${k.won_count} won · ${k.lost_count} lost${k.win_rate != null ? ` · ${k.win_rate}% win rate` : ''}`} />}
                {W.forecast && <Kpi icon="forecast" label={`Commit forecast · ${W.forecast.period}`} value={fmtCompact(W.forecast.commit)} hint={`Best case ${fmtCompact(W.forecast.best_case)}`} to="/forecast" />}
              </div>
            </section>
          )}

          {stageData.length > 0 && (
            <Card title="Open pipeline by stage" sub="Total amount of open opportunities in each stage (base currency)">
              <div style={{ height: Math.max(180, stageData.length * 34) }}>
                <ResponsiveContainer>
                  <BarChart data={stageData} layout="vertical" margin={{ left: 8, right: 48 }}>
                    <CartesianGrid stroke={GRID} horizontal={false} />
                    <XAxis type="number" tickFormatter={fmtCompact} tick={AXIS} stroke={GRID} />
                    <YAxis type="category" dataKey="name" width={150} tick={AXIS} stroke={GRID} />
                    <Tooltip cursor={{ fill: 'var(--bg-hover)' }} contentStyle={TIP} formatter={(v, n, p) => [`${fmtMoney(v)} · ${p.payload.count} opportunit${p.payload.count === 1 ? 'y' : 'ies'}`, 'Amount']} />
                    <Bar dataKey="amount" name="Amount" fill="var(--viz-brand)" radius={[0, 2, 2, 0]} isAnimationActive={anim} label={{ position: 'right', formatter: fmtCompact, fill: 'var(--text-secondary)', fontSize: 12 }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {W.monthly_won && (
            <Card title="Closed won by month" sub="Last 6 months, base currency">
              {W.monthly_won.length ? (
                <div style={{ height: 220 }}>
                  <ResponsiveContainer>
                    <BarChart data={W.monthly_won} margin={{ top: 20 }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="month" tick={AXIS} stroke={GRID} />
                      <YAxis tickFormatter={fmtCompact} width={48} tick={AXIS} stroke={GRID} />
                      <Tooltip cursor={{ fill: 'var(--bg-hover)' }} contentStyle={TIP} formatter={(v) => fmtMoney(v)} />
                      <Bar dataKey="won" name="Won" fill="var(--viz-good)" radius={[2, 2, 0, 0]} maxBarSize={56} isAnimationActive={anim} label={{ position: 'top', formatter: fmtCompact, fill: 'var(--text-secondary)', fontSize: 12 }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <Empty small icon="targets">No deals closed in the last 6 months.</Empty>}
            </Card>
          )}

          {W.top_deals && (
            <Card title="Top open deals" actions={<Link to="/opportunities" className="small">All opportunities</Link>}>
              <List rows={W.top_deals} empty="No open opportunities." render={(d) => <div className="row spread"><div style={{ minWidth: 0 }}><Link to={`/opportunities/${d.id}`}>{d.name}</Link><div className="muted small">{d.account} · closes {fmtDate(d.close_date)}</div></div><div className="right"><b className="mono">{fmtCompact(d.amount_base)}</b><div className="muted small">{d.probability}%</div></div></div>} />
            </Card>
          )}
        </div>

        <aside className="dash-side" aria-label="My lists">
          <Card title="My tasks" sub={W.tasks ? `${W.tasks.open} open · ${W.tasks.due_today} due today` : undefined} actions={<Link to="/my-work" className="small">My work</Link>}>
            <List rows={W.my_tasks} emptyIcon="success" empty="No open tasks. You're clear." render={(t) => { const late = t.due_at && new Date(t.due_at) < new Date(); return <div className="row spread"><Link to={`/tasks/${t.id}`}>{t.subject}</Link><span className="nowrap small"><Badge v={t.priority} /> <span className={late ? 'err' : 'muted'}>{late ? 'Overdue · ' : ''}{fmtDate(t.due_at)}</span></span></div>; }} />
          </Card>
          <Card title="Upcoming meetings" actions={<Link to="/calendar" className="small">Calendar</Link>}>
            <List rows={W.my_meetings} emptyIcon="calendar" empty="No meetings coming up." render={(m) => <div><Link to={`/meetings/${m.id}`}>{m.subject}</Link><div className="muted small">{fmtDateTime(m.start_at)}{m.location ? ` · ${m.location}` : ''}</div></div>} />
          </Card>
          {W.stalled && W.stalled.length > 0 && (
            <Card title="Stalled deals" sub="No stage change or activity for a while">
              <List rows={W.stalled} render={(d) => <div className="row spread"><Link to={`/opportunities/${d.id}`}>{d.name}</Link><Badge v="Overdue">Stalled</Badge></div>} />
            </Card>
          )}
          {W.expiring_quotes && W.expiring_quotes.length > 0 && <Card title="Quotations expiring soon"><List rows={W.expiring_quotes} render={(q) => <div className="row spread"><Link to={`/quotations/${q.id}`}>{q.number}</Link><span className="muted small">{fmtDate(q.valid_until)} · {fmtMoney(q.grand_total, q.currency)}</span></div>} /></Card>}
          {W.renewals && W.renewals.length > 0 && <Card title="Renewals due"><List rows={W.renewals} render={(r) => <div className="row spread"><Link to={`/renewals/${r.id}`}>{r.contract}</Link><span className="muted small">{fmtDate(r.due_date)}</span></div>} /></Card>}
          {W.dreg_expiring && W.dreg_expiring.length > 0 && <Card title="Deal registrations expiring"><List rows={W.dreg_expiring} render={(d) => <div className="row spread"><Link to={`/deal_registrations/${d.id}`}>{d.number}</Link><span className="muted small">{fmtDate(d.protection_end)}</span></div>} /></Card>}
          {W.leads && W.leads.length > 0 && (
            <Card title="Leads by status" actions={<Link to="/leads" className="small">All leads</Link>}>
              <ul className="list">{W.leads.map((l, i) => <li key={l.status}><div className="row spread small"><span>{l.status}</span><b className="mono">{l.n}</b></div><div className="bar" style={{ marginTop: 'var(--sp-2)' }} aria-hidden><i style={{ width: `${(l.n / maxLead) * 100}%`, background: VIZ[i % VIZ.length] }} /></div></li>)}</ul>
            </Card>
          )}
          {W.my_claims && W.my_claims.length > 0 && <Card title="My claims" actions={<Link to="/claims" className="small">All claims</Link>}><List rows={W.my_claims} render={(c) => <div className="row spread"><span><Badge v={c.status} /> <Badge v={c.payment_status} /></span><span className="mono">{c.n} · {fmtMoney(c.total)}</span></div>} /></Card>}
        </aside>
      </div>
    </>
  );
}

