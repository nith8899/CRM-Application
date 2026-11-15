import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { useAsync, useAuth, useToast } from '../state';
import { Badge, Card, ErrorBox, PageHead, Spinner } from '../components/ui';
import { EntityTable, FormModal } from '../components/entity';
import { fmtCompact, fmtDate, fmtMoney } from '../util';

const cur = () => { const d = new Date(); return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };
const shift = (p, n) => { const [y, q] = p.split('-Q').map(Number); const t = y * 4 + (q - 1) + n; return `${Math.floor(t / 4)}-Q${(t % 4) + 1}`; };

export default function ForecastPage() {
  const { can } = useAuth(); const toast = useToast(); const [period, setPeriod] = useState(cur()); const [key, setKey] = useState(0); const [show, setShow] = useState(false);
  const { data, error, loading, reload } = useAsync(() => api.get(`/forecast/summary?period=${period}`), [period, key]);
  const snap = async () => { try { await api.post('/forecast/snapshots', { period_label: period }); toast('Immutable snapshot taken', 'success'); reload(); } catch (e) { toast(e.message, 'error'); } };
  if (error) return <ErrorBox error={error} />;
  const cats = data?.categories || [];
  return (
    <>
      <PageHead title="Forecast" sub="Open pipeline by forecast category for the selected period; snapshots are immutable evidence for accuracy tracking.">
        <button className="btn" onClick={() => setPeriod(shift(period, -1))} aria-label="Previous period">‹</button><b>{period}</b><button className="btn" onClick={() => setPeriod(shift(period, 1))} aria-label="Next period">›</button>
        {can('M18', 'E') && <button className="btn" onClick={snap}>Take snapshot</button>}{can('M18', 'C') || can('M18', 'E') ? <button className="btn primary" onClick={() => setShow(true)}>My submission</button> : null}
      </PageHead>
      {loading || !data ? <Spinner /> : (
        <>
          <div className="grid g4" style={{ marginBottom: 14 }}>
            <div className="card kpi"><div className="label">Closed won</div><div className="value">{fmtCompact(data.closed_won.amount)}</div><div className="hint">{data.closed_won.n} deals</div></div>
            {cats.map((c) => <div key={c.category} className="card kpi"><div className="label">{c.category}</div><div className="value">{fmtCompact(c.amount)}</div><div className="hint">{c.count} deals · weighted {fmtCompact(c.weighted)}</div></div>)}
          </div>
          {data.accuracy && <div className="alert info" style={{ marginBottom: 14 }}>Accuracy vs “{data.accuracy.snapshot}”: committed {fmtMoney(data.accuracy.forecast_commit)}, won {fmtMoney(data.accuracy.actual_won)} → <b>{data.accuracy.pct ?? '—'}%</b></div>}
          <div className="grid g2" style={{ marginBottom: 14 }}>
            <Card title="By owner"><div style={{ height: 260 }}><ResponsiveContainer><BarChart data={data.by_owner}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="owner_name" tick={{ fontSize: 11 }} /><YAxis tickFormatter={fmtCompact} width={48} tick={{ fontSize: 12 }} /><Tooltip formatter={(v) => fmtMoney(v)} /><Legend /><Bar dataKey="commit" stackId="a" fill="#16a34a" name="Commit" /><Bar dataKey="best_case" stackId="a" fill="#f59e0b" name="Best case" /><Bar dataKey="pipeline" stackId="a" fill="#94a3b8" name="Pipeline" /></BarChart></ResponsiveContainer></div></Card>
            <Card title="Forecast submissions" pad={false}>
              <table className="t"><thead><tr><th>Owner</th><th className="num">Commit</th><th className="num">Best case</th><th className="num">System commit</th><th>Status</th></tr></thead><tbody>{data.submissions.map((s) => <tr key={s.id}><td><Link to={`/forecast_submissions/${s.id}`}>{s.owner_name}</Link></td><td className="num mono">{fmtMoney(s.commit_amount)}</td><td className="num mono">{fmtMoney(s.best_case_amount)}</td><td className="num mono muted">{fmtMoney(s.system_commit)}</td><td><Badge v={s.status} />{s.manager_adjustment ? <div className="small muted">adj {fmtMoney(s.manager_adjustment)}</div> : null}</td></tr>)}</tbody></table>
              {data.submissions.length === 0 && <div className="empty small">No submissions for this period.</div>}
            </Card>
          </div>
          <Card title={`Open opportunities closing in ${period}`} pad={false}>
            <div className="table-wrap"><table className="t"><thead><tr><th>Opportunity</th><th>Account</th><th>Owner</th><th>Stage</th><th>Category</th><th className="num">Amount</th><th className="num">Prob</th><th>Close</th></tr></thead><tbody>
              {data.opportunities.map((o) => <tr key={o.id}><td><Link to={`/opportunities/${o.id}`}>{o.name}</Link></td><td>{o.account_name}</td><td>{o.owner_name}</td><td>{o.stage}</td><td><Badge v={o.forecast_category} /></td><td className="num mono">{fmtMoney(o.amount_base)}</td><td className="num">{o.probability}%</td><td>{fmtDate(o.close_date)}</td></tr>)}</tbody></table>
              {data.opportunities.length === 0 && <div className="empty">No open opportunities with a close date in this period.</div>}</div>
          </Card>
        </>
      )}
      {show && <FormModal entity="forecast_submissions" defaults={{ period_label: period, currency: 'USD' }} title="Forecast submission" onClose={() => setShow(false)} onSaved={() => setKey((k) => k + 1)} />}
    </>
  );
}
