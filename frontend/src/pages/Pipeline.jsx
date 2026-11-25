import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../state';
import { Badge, ErrorBox, Modal, PageHead, Segmented, Spinner } from '../components/ui';
import { fmtCompact, fmtDate, fmtMoney } from '../util';

export default function Pipeline() {
  const [data, setData] = useState(null); const [err, setErr] = useState(null); const [mine, setMine] = useState(false); const [q, setQ] = useState(''); const [drag, setDrag] = useState(null); const [over, setOver] = useState(null); const [fail, setFail] = useState(null); const nav = useNavigate(); const toast = useToast();
  const load = () => api.get(`/pipeline${mine ? '?mine=1' : ''}`).then((d) => { setData(d); setErr(null); }).catch(setErr);
  useEffect(() => { load(); }, [mine]); // eslint-disable-line
  const drop = async (stage) => {
    setOver(null); if (!drag || drag.stage === stage.code) return;
    try { await api.post(`/e/opportunities/${drag.id}/actions/change_stage`, { to: stage.code }); toast(`${drag.name} → ${stage.name}`, 'success'); load(); }
    catch (e) { setFail({ e, deal: drag, stage }); } finally { setDrag(null); }
  };
  if (err) return <ErrorBox error={err} />; if (!data) return <Spinner />;
  const total = data.stages.reduce((a, s) => a + s.total, 0);
  const match = (d) => !q || `${d.name} ${d.account_name} ${d.number}`.toLowerCase().includes(q.toLowerCase());
  return (
    <>
      <PageHead title="Opportunities" sub={`${data.stages.reduce((a, s) => a + s.items.length, 0)} open opportunities · ${fmtCompact(total)} total. Drag a card to change its stage — governance rules still apply.`}>
        <input type="search" placeholder="Filter deals…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} aria-label="Filter deals on the board" />
        <label className="row small"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> My deals</label>
        <Segmented value="board" items={[{ key: 'list', label: 'List', icon: 'listView', to: '/opportunities' }, { key: 'board', label: 'Board', icon: 'boardView', to: '/pipeline' }]} />
      </PageHead>
      <div className="kanban">
        {data.stages.map((s) => (
          <div key={s.code} className={`col ${over === s.code ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(s.code); }} onDragLeave={() => setOver(null)} onDrop={() => drop(s)}>
            <h4><span>{s.code} · {s.name}</span><span className="muted">{s.items.filter(match).length}</span></h4>
            <div className="sum">{fmtCompact(s.total)} · {s.probability}%</div>
            {s.items.filter(match).map((d) => (
              <div key={d.id} className="deal" draggable onDragStart={() => setDrag(d)} onClick={() => nav(`/opportunities/${d.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/opportunities/${d.id}`)}>
                <div className="nm">{d.name}</div>
                <div className="muted small">{d.account_name}</div>
                <div className="row spread" style={{ marginTop: 6 }}><b className="mono">{fmtMoney(d.amount_base)}</b><span className="muted small">{fmtDate(d.close_date)}</span></div>
                <div className="row spread small muted" style={{ marginTop: 4 }}><span>{d.owner_name}</span><span>{d.probability}%</span></div>
                {d.risk_flags?.length > 0 && <div style={{ marginTop: 6 }}>{d.risk_flags.slice(0, 2).map((f) => <span key={f.code} className="badge warn" style={{ marginRight: 4 }} title={f.label}>{f.code.replace('_', ' ')}</span>)}</div>}
              </div>
            ))}
          </div>
        ))}
      </div>
      {fail && <Modal title={`Cannot move “${fail.deal.name}” to ${fail.stage.name}`} size="narrow" onClose={() => setFail(null)} footer={<><button className="btn" onClick={() => setFail(null)}>Close</button><button className="btn primary" onClick={() => nav(`/opportunities/${fail.deal.id}`)}>Open opportunity</button></>}><ErrorBox error={fail.e} /></Modal>}
    </>
  );
}
