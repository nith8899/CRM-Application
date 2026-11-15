import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../state';
import { Alert } from '../components/ui';

const DEMO = [['admin', 'Administrator'], ['sd', 'Sales Director'], ['cm.kh', 'Country Mgr'], ['sm.kh', 'Sales Manager'], ['se1', 'Sales Exec'], ['pse1', 'Presales'], ['sop1', 'Sales Ops'], ['fin1', 'Finance'], ['finv1', 'Fin. Verifier'], ['pay1', 'Payments'], ['cpm1', 'Channel Mgr'], ['mkt1', 'Marketing'], ['aud1', 'Auditor'], ['ext1', 'Partner (ext)']];

export default function Login() {
  const { login } = useAuth(); const nav = useNavigate();
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { await login(u, p); nav('/'); } catch (ex) { setErr(ex.message); } finally { setBusy(false); } };
  return (
    <div className="login">
      <form className="box stack" onSubmit={submit}>
        <div className="row"><span className="avatar" style={{ background: 'var(--primary)', color: '#fff', width: 40, height: 40, borderRadius: 10 }}>C</span><div><h1>Enterprise CRM</h1><div className="muted">Sign in to continue</div></div></div>
        {err && <Alert kind="bad">{err}</Alert>}
        <label className="f">Login or email<input type="text" autoFocus autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} required /></label>
        <label className="f">Password<input type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required /></label>
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="muted small">Demo environment — pick a role, the password is <b>Crm@Demo2026</b>:</div>
        <div className="demo-users">{DEMO.map(([l, n]) => <button type="button" key={l} onClick={() => { setU(l); setP('Crm@Demo2026'); }} title={l}>{n}</button>)}</div>
      </form>
    </div>
  );
}
