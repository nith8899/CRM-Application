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
      <section className="hero krama" aria-hidden>
        <div className="brand"><span className="logo">C</span>Enterprise CRM</div>
        <div>
          <h2>Every deal, quote and approval — <em>in one place.</em></h2>
          <p>Pipeline, quotations, claims and approvals for the sales, presales and finance teams across Cambodia and Vietnam.</p>
        </div>
        <div className="facts"><span><b>35</b>modules</span><span><b>13</b>workflows</span><span><b>2</b>countries</span></div>
      </section>
      <div className="panel">
        <form className="box stack" onSubmit={submit}>
          <div><h1>Sign in</h1><div className="muted">Use your company login or email.</div></div>
          {err && <Alert kind="bad">{err}</Alert>}
          <label className="f">Login or email<input type="text" autoFocus autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} required /></label>
          <label className="f">Password<input type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required /></label>
          <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="demo">
            <div className="muted small">Demo environment: pick a role. The password is <b>Crm@Demo2026</b>.</div>
            <div className="demo-users">{DEMO.map(([l, n]) => <button type="button" key={l} onClick={() => { setU(l); setP('Crm@Demo2026'); }} aria-label={`Use the ${n} demo login (${l})`}>{n}</button>)}</div>
          </div>
        </form>
      </div>
    </div>
  );
}
