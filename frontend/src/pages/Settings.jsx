import { useEffect, useState } from 'react';
import { api, setToken } from '../api';
import { useAsync, useAuth, useToast } from '../state';
import { Alert, Card, ErrorBox, PageHead, Spinner } from '../components/ui';
import { FieldInput } from '../components/fields';
import { fmtDate } from '../util';

const MUTE = [['approval', 'Approval requests'], ['task', 'Task assignments'], ['stalled', 'Stalled deal alerts'], ['quote_expiring', 'Quotation expiry'], ['lead_assigned', 'Lead assignments'], ['dreg_expiring', 'Deal registration expiry']];

export function MySettingsPage() {
  const { me, refresh } = useAuth(); const toast = useToast();
  const { data, error, reload } = useAsync(() => api.get('/me/settings'), []); const [s, setS] = useState(null); const [pw, setPw] = useState({}); const [pwErr, setPwErr] = useState(null);
  const { data: dels, reload: rd } = useAsync(() => api.get('/approvals-delegations'), []); const [d, setD] = useState({}); const [dl, setDl] = useState(''); const [derr, setDerr] = useState(null);
  useEffect(() => { if (data) setS({ time_zone: data.time_zone, locale: data.locale, theme: data.settings.theme || '', calendar_sharing: data.settings.calendar_sharing || 'full', muted: (data.settings.notification_prefs || {}).muted || [] }); }, [data]);
  if (error) return <ErrorBox error={error} />; if (!s) return <Spinner />;
  const save = async () => { try { await api.put('/me/settings', { time_zone: s.time_zone, locale: s.locale, theme: s.theme, calendar_sharing: s.calendar_sharing, notification_prefs: { muted: s.muted } }); toast('Settings saved', 'success'); refresh(); } catch (e) { toast(e.message, 'error'); } };
  const changePw = async () => { try { const r = await api.post('/auth/change-password', { current_password: pw.cur, new_password: pw.next }); setToken(r.token); setPw({}); setPwErr(null); toast('Password changed', 'success'); } catch (e) { setPwErr(e); } };
  const addDel = async () => { try { await api.post('/approvals-delegations', d); setD({}); setDl(''); setDerr(null); rd(); toast('Delegation created', 'success'); } catch (e) { setDerr(e); } };
  return (
    <>
      <PageHead title="My settings" sub={`${me.name} · ${me.email}`} />
      <div className="grid g2">
        <Card title="Preferences" actions={<button className="btn primary sm" onClick={save}>Save</button>}>
          <div className="stack">
            <label className="f">Time zone<select value={s.time_zone} onChange={(e) => setS({ ...s, time_zone: e.target.value })}>{['UTC', 'Asia/Phnom_Penh', 'Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York'].map((z) => <option key={z}>{z}</option>)}</select></label>
            <label className="f">Language<select value={s.locale} onChange={(e) => setS({ ...s, locale: e.target.value })}><option value="en">English</option><option value="km">ខ្មែរ (Khmer)</option><option value="vi">Tiếng Việt</option><option value="th">ไทย</option></select></label>
            <label className="f">Theme<select value={s.theme} onChange={(e) => setS({ ...s, theme: e.target.value })}><option value="">Match system</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
            <label className="f">Calendar sharing (affects free/busy for colleagues)<select value={s.calendar_sharing} onChange={(e) => setS({ ...s, calendar_sharing: e.target.value })}><option value="full">Share details</option><option value="busy-only">Busy/free only</option><option value="none">Do not share (shown as unknown)</option></select></label>
            <div><div className="muted small" style={{ marginBottom: 6 }}>Notify me about</div>{MUTE.map(([k, l]) => <label key={k} className="row small" style={{ marginBottom: 4 }}><input type="checkbox" checked={!s.muted.includes(k)} onChange={(e) => setS({ ...s, muted: e.target.checked ? s.muted.filter((x) => x !== k) : [...s.muted, k] })} />{l}</label>)}</div>
          </div>
        </Card>
        <div className="stack">
          <Card title="Change password" actions={<button className="btn primary sm" onClick={changePw} disabled={!pw.cur || !pw.next}>Update</button>}>
            <div className="stack"><label className="f">Current password<input type="password" autoComplete="current-password" value={pw.cur || ''} onChange={(e) => setPw({ ...pw, cur: e.target.value })} /></label><label className="f">New password (min 10 chars, upper, lower, digit)<input type="password" autoComplete="new-password" value={pw.next || ''} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label><ErrorBox error={pwErr} /></div>
          </Card>
          <Card title="Approval delegation" actions={<button className="btn primary sm" onClick={addDel} disabled={!d.delegate_id || !d.start_date || !d.end_date}>Delegate</button>}>
            <div className="stack" id="delegation">
              <FieldInput field={{ name: 'u', label: 'Delegate to (equal or higher authority)', type: 'ref', ref: 'users' }} value={d.delegate_id} labelValue={dl} onChange={(n, v, l) => { setD({ ...d, delegate_id: v }); setDl(l); }} />
              <div className="row"><label className="f grow">From<input type="date" value={d.start_date || ''} onChange={(e) => setD({ ...d, start_date: e.target.value })} /></label><label className="f grow">To<input type="date" value={d.end_date || ''} onChange={(e) => setD({ ...d, end_date: e.target.value })} /></label></div>
              <label className="f">Reason<input type="text" value={d.reason || ''} onChange={(e) => setD({ ...d, reason: e.target.value })} /></label><ErrorBox error={derr} />
              {(dels || []).length > 0 && <table className="t"><tbody>{dels.map((x) => <tr key={x.id}><td>{x.delegator_name} → {x.delegate_name}</td><td className="small muted">{fmtDate(x.start_date)} – {fmtDate(x.end_date)}</td><td>{x.active && x.delegator_id === me.id && <button className="btn sm danger" onClick={async () => { await api.del(`/approvals-delegations/${x.id}`); rd(); }}>End</button>}</td></tr>)}</tbody></table>}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
