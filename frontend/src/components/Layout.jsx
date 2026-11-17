import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../state';
import { initials, fmtDateTime } from '../util';
import { useDebounced } from './ui';
import { Icon } from './icons';

const NAV = [
  { group: 'Home', items: [{ to: '/', icon: 'dashboard', label: 'Dashboard', mod: 'M01', end: true }, { to: '/my-work', icon: 'myWork', label: 'My work', mod: 'M30' }, { to: '/approvals', icon: 'approvals', label: 'Approvals', mod: 'M15', badge: 'approvals' }] },
  { group: 'Sales', items: [{ to: '/leads', icon: 'leads', label: 'Leads', mod: 'M02' }, { to: '/accounts', icon: 'accounts', label: 'Accounts', mod: 'M03' }, { to: '/contacts', icon: 'contacts', label: 'Contacts', mod: 'M04' }, { to: '/pipeline', icon: 'pipeline', label: 'Pipeline board', mod: 'M08' }, { to: '/opportunities', icon: 'opportunities', label: 'Opportunities', mod: 'M08' },
    { to: '/quotations', icon: 'quotations', label: 'Quotations', mod: 'M13' }, { to: '/deal_registrations', icon: 'dealRegistrations', label: 'Deal registrations', mod: 'M09' }, { to: '/projects', icon: 'projects', label: 'Projects', mod: 'M16' }, { to: '/forecast', icon: 'forecast', label: 'Forecast', mod: 'M18' }, { to: '/contracts', icon: 'contracts', label: 'Contracts & renewals', mod: 'M19' }, { to: '/campaigns', icon: 'campaigns', label: 'Campaigns', mod: 'M02' }] },
  { group: 'Channel & catalog', items: [{ to: '/partners', icon: 'partners', label: 'Partners', mod: 'M05' }, { to: '/vendors', icon: 'vendors', label: 'Vendors', mod: 'M06' }, { to: '/products', icon: 'products', label: 'Products', mod: 'M07' }, { to: '/price_records', icon: 'priceLists', label: 'Price lists', mod: 'M14' }, { to: '/cost_records', icon: 'vendorCosts', label: 'Vendor costs', mod: 'M14', needs: 'cost' },
    { to: '/tech_requirements', icon: 'requirements', label: 'Requirements', mod: 'M12' }, { to: '/solution_configs', icon: 'solutions', label: 'Solutions & BOM', mod: 'M12' }] },
  { group: 'Productivity', items: [{ to: '/tasks', icon: 'tasks', label: 'Tasks', mod: 'M30' }, { to: '/activities', icon: 'activities', label: 'Activities', mod: 'M10' }, { to: '/meetings', icon: 'meetings', label: 'Meetings', mod: 'M11' }, { to: '/calendar', icon: 'calendar', label: 'Calendar', mod: 'M31' }, { to: '/activity_reports', icon: 'activityReports', label: 'Activity reports', mod: 'M29' }, { to: '/events', icon: 'events', label: 'Events', mod: 'M34' }] },
  { group: 'Finance', items: [{ to: '/claims', icon: 'claims', label: 'Claims', mod: 'M35' }, { to: '/payments', icon: 'payments', label: 'Reimbursements', mod: 'M35', roles: ['ROL-PAY', 'ROL-FIN', 'ROL-ADM', 'ROL-FINV'] }, { to: '/sales_targets', icon: 'targets', label: 'Targets', mod: 'M17' }, { to: '/commission', icon: 'commission', label: 'Commission', mod: 'M17' }] },
  { group: 'Insight', items: [{ to: '/reports', icon: 'reports', label: 'Reports', mod: 'M22' }, { to: '/analytics', icon: 'analytics', label: 'Activity analytics', mod: 'M29' }, { to: '/org-chart', icon: 'orgChart', label: 'Org chart', mod: 'M33' }] },
  { group: 'Administration', items: [{ to: '/admin', icon: 'admin', label: 'Admin overview', mod: 'M24', roles: ['ROL-ADM'] }, { to: '/users', icon: 'users', label: 'Users', mod: 'M24' }, { to: '/admin/permissions', icon: 'permissions', label: 'Roles & permissions', mod: 'M24', roles: ['ROL-ADM', 'ROL-AUD'] }, { to: '/org', icon: 'organisation', label: 'Organisation', mod: 'M24' }, { to: '/picklists', icon: 'picklists', label: 'Picklists', mod: 'M24' },
    { to: '/stage_definitions', icon: 'stages', label: 'Pipeline stages', mod: 'M24' }, { to: '/exchange_rates', icon: 'fx', label: 'FX & tax', mod: 'M24' }, { to: '/approval_processes', icon: 'workflows', label: 'Workflows', mod: 'M15', roles: ['ROL-ADM', 'ROL-WFA'] }, { to: '/settings/app', icon: 'configuration', label: 'Configuration', mod: 'M32' }, { to: '/integrations', icon: 'integrations', label: 'Integrations', mod: 'M25' }, { to: '/admin/audit', icon: 'audit', label: 'Audit log', mod: 'M26' }, { to: '/import_jobs', icon: 'imports', label: 'Import history', mod: 'M23' }] },
];

function GlobalSearch() {
  const [q, setQ] = useState(''); const dq = useDebounced(q, 250); const [res, setRes] = useState([]); const [open, setOpen] = useState(false); const box = useRef(null); const nav = useNavigate();
  useEffect(() => { if (dq.length < 2) { setRes([]); return; } api.get(`/search?q=${encodeURIComponent(dq)}`).then(setRes).catch(() => setRes([])); }, [dq]);
  useEffect(() => { const h = (e) => box.current && !box.current.contains(e.target) && setOpen(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  return (
    <div className="search" ref={box}>
      <Icon name="search" className="ico" />
      <input type="search" placeholder="Search accounts, contacts, deals, quotations…" aria-label="Global search" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && q.length >= 2 && (
        <div className="search-results">
          {res.length === 0 && <div className="empty small">No matches for “{q}”</div>}
          {res.map((r) => <a key={`${r.entity}${r.id}`} href="#" onClick={(e) => { e.preventDefault(); setOpen(false); setQ(''); nav(`/${r.entity}/${r.id}`); }}><span className="badge plain">{r.type}</span><span className="grow">{r.label}</span><span className="muted small">{r.number || ''}</span></a>)}
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
      <button className="iconbtn" aria-label={`Notifications (${d.unread} unread)`} onClick={() => { setOpen(!open); load(); }}><Icon name="notifications" />{d.unread > 0 && <span className="dot">{d.unread > 99 ? '99+' : d.unread}</span>}</button>
      {open && (
        <div className="menu" style={{ width: 360, maxHeight: 440, overflow: 'auto' }}>
          <div className="row spread menu-head"><h4>Notifications</h4><button className="btn sm ghost" onClick={async () => { await api.post('/notifications/read', { all: true }); load(); }}>Mark all read</button></div>
          <hr />
          {d.rows.length === 0 && <div className="empty small"><Icon name="success" weight="duotone" />You're all caught up.</div>}
          {d.rows.slice(0, 25).map((n) => <button key={n.id} onClick={() => go(n)} style={{ alignItems: 'flex-start' }}><span className="badge plain" style={{ visibility: n.read_at ? 'hidden' : 'visible', width: 8, height: 8, padding: 0, marginTop: 6, background: 'var(--action-accent)' }} aria-label={n.read_at ? undefined : 'Unread'} /><span className="grow"><span style={{ display: 'block', fontWeight: n.read_at ? 400 : 600 }}>{n.title}</span>{n.body && <span className="muted small" style={{ display: 'block' }}>{n.body}</span>}<span className="muted small" style={{ display: 'block' }}>{fmtDateTime(n.created_at)}</span></span></button>)}
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
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="topbar krama">
        <button className="iconbtn menu-btn" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name={open ? 'close' : 'menu'} /></button>
        <Link to="/" className="brand" aria-label="Enterprise CRM home"><span className="logo" aria-hidden>C</span><span className="brand-name">Enterprise CRM</span><span className="env">UAT</span></Link>
        <GlobalSearch />
        <div className="grow" />
        <Bell />
        <div style={{ position: 'relative' }}>
          <button className="iconbtn account-btn" onClick={() => setMenu(!menu)} aria-label="Account menu" aria-expanded={menu}><span className="avatar">{initials(me.name)}</span><span className="who hide-sm">{me.name}<small>{me.job_title}</small></span></button>
          {menu && (
            <div className="menu">
              <div className="menu-head"><b>{me.name}</b><div className="muted small">{me.job_title}</div><div className="muted small">{me.roles.filter((r) => r !== 'ROL-EMP' && r !== 'ROL-DM').join(', ')}</div></div><hr />
              <Link to="/settings/me"><Icon name="settings" />My settings</Link><Link to="/settings/me#delegation"><Icon name="approvals" />Approval delegation</Link><Link to="/design-system"><Icon name="solutions" />Design system</Link><hr />
              <button onClick={async () => { await logout(); nav('/login'); }}><Icon name="signOut" />Sign out</button>
            </div>
          )}
        </div>
      </header>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden />}
      <nav className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        {NAV.map((g) => {
          const items = g.items.filter((i) => can(i.mod, 'V') && (!i.roles || hasRole(...i.roles)) && !(i.needs === 'cost' && !hasRole('ROL-ADM', 'ROL-FIN', 'ROL-SOP', 'ROL-PRC', 'ROL-CM', 'ROL-SD', 'ROL-SM', 'ROL-AUD', 'ROL-ROE')));
          if (!items.length) return null;
          return <div key={g.group}><div className="nav-group">{g.group}</div>{items.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>{({ isActive }) => <><Icon name={i.icon} weight={isActive ? 'fill' : 'regular'} />{i.label}{i.badge === 'approvals' && pending > 0 && <span className="count" aria-label={`${pending} pending`}>{pending}</span>}</>}</NavLink>)}</div>;
        })}
      </nav>
      <div className="main">
        <main className="content" id="main" key={loc.pathname}>{me.must_change_password && <div className="alert warn" style={{ marginBottom: 'var(--sp-6)' }}><Icon name="warning" /><div className="alert-body"><b>Please change your temporary password.</b> <Link to="/settings/me">Open my settings</Link></div></div>}<Outlet /></main>
      </div>
    </div>
  );
}
