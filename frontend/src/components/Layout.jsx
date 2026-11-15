import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../state';
import { initials, fmtDateTime } from '../util';
import { useDebounced } from './ui';

const NAV = [
  { group: 'Home', items: [{ to: '/', label: 'Dashboard', mod: 'M01', end: true }, { to: '/my-work', label: 'My work', mod: 'M30' }, { to: '/approvals', label: 'Approvals', mod: 'M15', badge: 'approvals' }] },
  { group: 'Sales', items: [{ to: '/leads', label: 'Leads', mod: 'M02' }, { to: '/accounts', label: 'Accounts', mod: 'M03' }, { to: '/contacts', label: 'Contacts', mod: 'M04' }, { to: '/pipeline', label: 'Pipeline board', mod: 'M08' }, { to: '/opportunities', label: 'Opportunities', mod: 'M08' },
    { to: '/quotations', label: 'Quotations', mod: 'M13' }, { to: '/deal_registrations', label: 'Deal registrations', mod: 'M09' }, { to: '/projects', label: 'Projects', mod: 'M16' }, { to: '/forecast', label: 'Forecast', mod: 'M18' }, { to: '/contracts', label: 'Contracts & renewals', mod: 'M19' }, { to: '/campaigns', label: 'Campaigns', mod: 'M02' }] },
  { group: 'Channel & catalog', items: [{ to: '/partners', label: 'Partners', mod: 'M05' }, { to: '/vendors', label: 'Vendors', mod: 'M06' }, { to: '/products', label: 'Products', mod: 'M07' }, { to: '/price_records', label: 'Price lists', mod: 'M14' }, { to: '/cost_records', label: 'Vendor costs', mod: 'M14', needs: 'cost' },
    { to: '/tech_requirements', label: 'Requirements', mod: 'M12' }, { to: '/solution_configs', label: 'Solutions & BOM', mod: 'M12' }] },
  { group: 'Productivity', items: [{ to: '/tasks', label: 'Tasks', mod: 'M30' }, { to: '/activities', label: 'Activities', mod: 'M10' }, { to: '/meetings', label: 'Meetings', mod: 'M11' }, { to: '/calendar', label: 'Calendar', mod: 'M31' }, { to: '/activity_reports', label: 'Activity reports', mod: 'M29' }, { to: '/events', label: 'Events', mod: 'M34' }] },
  { group: 'Finance', items: [{ to: '/claims', label: 'Claims', mod: 'M35' }, { to: '/payments', label: 'Reimbursements', mod: 'M35', roles: ['ROL-PAY', 'ROL-FIN', 'ROL-ADM', 'ROL-FINV'] }, { to: '/sales_targets', label: 'Targets', mod: 'M17' }, { to: '/commission', label: 'Commission', mod: 'M17' }] },
  { group: 'Insight', items: [{ to: '/reports', label: 'Reports', mod: 'M22' }, { to: '/analytics', label: 'Activity analytics', mod: 'M29' }, { to: '/org-chart', label: 'Org chart', mod: 'M33' }] },
  { group: 'Administration', items: [{ to: '/admin', label: 'Admin overview', mod: 'M24', roles: ['ROL-ADM'] }, { to: '/users', label: 'Users', mod: 'M24' }, { to: '/admin/permissions', label: 'Roles & permissions', mod: 'M24', roles: ['ROL-ADM', 'ROL-AUD'] }, { to: '/org', label: 'Organisation', mod: 'M24' }, { to: '/picklists', label: 'Picklists', mod: 'M24' },
    { to: '/stage_definitions', label: 'Pipeline stages', mod: 'M24' }, { to: '/exchange_rates', label: 'FX & tax', mod: 'M24' }, { to: '/approval_processes', label: 'Workflows', mod: 'M15', roles: ['ROL-ADM', 'ROL-WFA'] }, { to: '/settings/app', label: 'Configuration', mod: 'M32' }, { to: '/integrations', label: 'Integrations', mod: 'M25' }, { to: '/admin/audit', label: 'Audit log', mod: 'M26' }, { to: '/import_jobs', label: 'Import history', mod: 'M23' }] },
];

function GlobalSearch() {
  const [q, setQ] = useState(''); const dq = useDebounced(q, 250); const [res, setRes] = useState([]); const [open, setOpen] = useState(false); const box = useRef(null); const nav = useNavigate();
  useEffect(() => { if (dq.length < 2) { setRes([]); return; } api.get(`/search?q=${encodeURIComponent(dq)}`).then(setRes).catch(() => setRes([])); }, [dq]);
  useEffect(() => { const h = (e) => box.current && !box.current.contains(e.target) && setOpen(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  return (
    <div className="search" ref={box}>
      <span className="ico" aria-hidden>⌕</span>
      <input type="search" placeholder="Search accounts, contacts, deals, quotations…" aria-label="Global search" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && q.length >= 2 && (
        <div className="search-results">
          {res.length === 0 && <div className="empty small">No results</div>}
          {res.map((r) => <a key={`${r.entity}${r.id}`} href="#" onClick={(e) => { e.preventDefault(); setOpen(false); setQ(''); nav(`/${r.entity}/${r.id}`); }}><span className="badge">{r.type}</span><span className="grow">{r.label}</span><span className="muted small">{r.number || ''}</span></a>)}
        </div>
      )}
    </div>
  );
}

function Bell() {
  const [open, setOpen] = useState(false); const [d, setD] = useState({ rows: [], unread: 0 }); const nav = useNavigate(); const ref = useRef(null);
  const load = () => api.get('/notifications').then(setD).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  useEffect(() => { const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const go = async (n) => { await api.post('/notifications/read', { ids: [n.id] }); setOpen(false); load(); if (n.entity && n.record_id) nav(n.entity === 'approval_requests' ? `/approvals/${n.record_id}` : `/${n.entity}/${n.record_id}`); };
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="iconbtn" aria-label={`Notifications (${d.unread} unread)`} onClick={() => { setOpen(!open); load(); }}>🔔{d.unread > 0 && <span className="dot">{d.unread > 99 ? '99+' : d.unread}</span>}</button>
      {open && (
        <div className="menu" style={{ width: 360, maxHeight: 440, overflow: 'auto' }}>
          <div className="row spread" style={{ padding: '4px 8px' }}><b>Notifications</b><button className="btn sm ghost" onClick={async () => { await api.post('/notifications/read', { all: true }); load(); }}>Mark all read</button></div>
          <hr />
          {d.rows.length === 0 && <div className="empty small">You're all caught up.</div>}
          {d.rows.slice(0, 25).map((n) => <button key={n.id} onClick={() => go(n)} style={{ opacity: n.read_at ? 0.6 : 1 }}><div style={{ fontWeight: n.read_at ? 400 : 600 }}>{n.title}</div>{n.body && <div className="muted small">{n.body}</div>}<div className="muted small">{fmtDateTime(n.created_at)}</div></button>)}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { me, can, hasRole, logout } = useAuth(); const [open, setOpen] = useState(false); const [menu, setMenu] = useState(false); const [pending, setPending] = useState(0); const loc = useLocation(); const nav = useNavigate();
  useEffect(() => { setOpen(false); setMenu(false); }, [loc.pathname]);
  useEffect(() => { if (!can('M15', 'V')) return; const f = () => api.get('/approvals/count').then((r) => setPending(r.pending)).catch(() => {}); f(); const t = setInterval(f, 60000); return () => clearInterval(t); }, [can, loc.pathname]);
  const theme = (me.settings && me.settings.theme) || '';
  useEffect(() => { document.documentElement.dataset.theme = theme === 'dark' || theme === 'light' ? theme : ''; if (!theme) delete document.documentElement.dataset.theme; }, [theme]);
  return (
    <div className="app">
      <a href="#main" style={{ position: 'absolute', left: -999 }} onFocus={(e) => { e.target.style.left = '8px'; }}>Skip to content</a>
      <nav className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <div className="brand"><span className="logo">C</span>Enterprise CRM</div>
        {NAV.map((g) => {
          const items = g.items.filter((i) => can(i.mod, 'V') && (!i.roles || hasRole(...i.roles)) && !(i.needs === 'cost' && !hasRole('ROL-ADM', 'ROL-FIN', 'ROL-SOP', 'ROL-PRC', 'ROL-CM', 'ROL-SD', 'ROL-SM', 'ROL-AUD', 'ROL-ROE')));
          if (!items.length) return null;
          return <div key={g.group}><div className="nav-group">{g.group}</div>{items.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>{i.label}{i.badge === 'approvals' && pending > 0 && <span className="count">{pending}</span>}</NavLink>)}</div>;
        })}
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="iconbtn menu-btn" aria-label="Menu" onClick={() => setOpen(!open)}>☰</button>
          <GlobalSearch />
          <div className="grow" />
          <Bell />
          <div style={{ position: 'relative' }}>
            <button className="iconbtn" style={{ width: 'auto', padding: '0 8px', gap: 8, display: 'flex' }} onClick={() => setMenu(!menu)} aria-label="Account menu"><span className="avatar">{initials(me.name)}</span><span className="hide-sm">{me.name}</span></button>
            {menu && (
              <div className="menu">
                <div style={{ padding: '6px 10px' }}><b>{me.name}</b><div className="muted small">{me.job_title}</div><div className="muted small">{me.roles.filter((r) => r !== 'ROL-EMP' && r !== 'ROL-DM').join(', ')}</div></div><hr />
                <Link to="/settings/me">My settings</Link><Link to="/settings/me#delegation">Approval delegation</Link><hr />
                <button onClick={async () => { await logout(); nav('/login'); }}>Sign out</button>
              </div>
            )}
          </div>
        </header>
        <main className="content" id="main">{me.must_change_password && <div className="alert warn" style={{ marginBottom: 14 }}><b>Please change your temporary password.</b> <Link to="/settings/me">Open my settings</Link></div>}<Outlet /></main>
      </div>
    </div>
  );
}
