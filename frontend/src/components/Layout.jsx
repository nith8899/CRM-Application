import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../state';
import { initials, fmtDateTime } from '../util';
import { Menu, TooltipLayer, useDebounced } from './ui';
import { Icon } from './icons';
import { FormModal } from './entity';
import { ADMIN_NAV, CREATE_ITEMS, WORK_NAV, defaultOpenGroups, isAdminPath, roleName, visibleNav } from '../nav';

function GlobalSearch() {
  const [q, setQ] = useState(''); const dq = useDebounced(q, 250); const [res, setRes] = useState([]); const [open, setOpen] = useState(false); const box = useRef(null); const input = useRef(null); const nav = useNavigate();
  useEffect(() => { if (dq.length < 2) { setRes([]); return; } api.get(`/search?q=${encodeURIComponent(dq)}`).then(setRes).catch(() => setRes([])); }, [dq]);
  useEffect(() => { const h = (e) => box.current && !box.current.contains(e.target) && setOpen(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  useEffect(() => { const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); } }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, []);
  return (
    <div className="search" ref={box} role="search">
      <Icon name="search" className="ico" />
      <input ref={input} type="search" placeholder="Search accounts, contacts, deals, quotations…  ⌘K" aria-label="Search the CRM" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      {open && q.length >= 2 && (
        <div className="search-results" role="listbox" aria-label="Search results">
          {res.length === 0 && <div className="empty small">No matches for “{q}”. Try a name, number or email.</div>}
          {res.map((r) => <a key={`${r.entity}${r.id}`} role="option" href={`/${r.entity}/${r.id}`} onClick={(e) => { e.preventDefault(); setOpen(false); setQ(''); nav(`/${r.entity}/${r.id}`); }}><span className="badge plain">{r.type}</span><span className="grow">{r.label}</span><span className="muted small">{r.number || ''}</span></a>)}
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
    <div style={{ position: 'relative' }} ref={ref} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button className="iconbtn" aria-label={`Notifications, ${d.unread} unread`} aria-expanded={open} onClick={() => { setOpen(!open); load(); }}><Icon name="notifications" />{d.unread > 0 && <span className="dot" aria-hidden>{d.unread > 99 ? '99+' : d.unread}</span>}</button>
      {open && (
        <div className="menu" style={{ width: 360, maxHeight: 440, overflow: 'auto' }}>
          <div className="row spread menu-head"><h4>Notifications</h4>{d.unread > 0 && <button className="btn sm ghost" onClick={async () => { await api.post('/notifications/read', { all: true }); load(); }}>Mark all read</button>}</div>
          <hr />
          {d.rows.length === 0 && <div className="empty small"><Icon name="success" weight="duotone" />You're all caught up.</div>}
          {d.rows.slice(0, 25).map((n) => <button key={n.id} onClick={() => go(n)} style={{ alignItems: 'flex-start' }}><span className="unread-dot" style={{ visibility: n.read_at ? 'hidden' : 'visible' }} aria-label={n.read_at ? undefined : 'Unread'} /><span className="grow"><span style={{ display: 'block', fontWeight: n.read_at ? 400 : 600 }}>{n.title}</span>{n.body && <span className="muted small" style={{ display: 'block' }}>{n.body}</span>}<span className="muted small" style={{ display: 'block' }}>{fmtDateTime(n.created_at)}</span></span></button>)}
        </div>
      )}
    </div>
  );
}

const OPEN_KEY = 'crm_nav_open';
function NavGroups({ groups, pending, openSet, toggle }) {
  const loc = useLocation();
  return groups.map((g) => {
    const containsActive = g.items.some((i) => loc.pathname === i.to || (!i.end && loc.pathname.startsWith(`${i.to}/`)) || (i.also || []).some((p) => loc.pathname.startsWith(p)));
    const open = openSet.has(g.group) || containsActive;
    const gid = `navg-${g.group.replace(/\W+/g, '-')}`;
    return (
      <div key={g.group}>
        <button type="button" className="nav-group" aria-expanded={open} aria-controls={gid} onClick={() => toggle(g.group)}>{g.group}<Icon name="chevronDown" size={16} /></button>
        <div id={gid} hidden={!open}>
          {g.items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `nav-link ${isActive || (i.also || []).some((p) => loc.pathname.startsWith(p)) ? 'active' : ''}`}>
              {({ isActive }) => <><Icon name={i.icon} weight={isActive ? 'fill' : 'regular'} />{i.label}{i.badge === 'approvals' && pending > 0 && <span className="count" aria-label={`${pending} waiting`}>{pending}</span>}</>}
            </NavLink>
          ))}
        </div>
      </div>
    );
  });
}

export default function Layout() {
  const { me, can, hasRole, logout } = useAuth(); const [open, setOpen] = useState(false); const [menu, setMenu] = useState(false); const [pending, setPending] = useState(0); const [create, setCreate] = useState(null);
  const loc = useLocation(); const nav = useNavigate(); const acct = useRef(null);
  useEffect(() => { setOpen(false); setMenu(false); }, [loc.pathname]);
  useEffect(() => { if (!can('M15', 'V')) return; const f = () => api.get('/approvals/count').then((r) => setPending(r.pending)).catch(() => {}); f(); const t = setInterval(f, 60000); return () => clearInterval(t); }, [can, loc.pathname]);
  useEffect(() => { if (!menu) return; const h = (e) => acct.current && !acct.current.contains(e.target) && setMenu(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [menu]);
  const theme = (me.settings && me.settings.theme) || '';
  useEffect(() => { document.documentElement.dataset.theme = theme === 'dark' || theme === 'light' ? theme : ''; if (!theme) delete document.documentElement.dataset.theme; }, [theme]);

  const work = useMemo(() => visibleNav(WORK_NAV, { can, hasRole }), [can, hasRole]);
  const admin = useMemo(() => visibleNav(ADMIN_NAV, { can, hasRole }), [can, hasRole]);
  const inAdmin = admin.length > 0 && isAdminPath(loc.pathname);
  const [openSet, setOpenSet] = useState(() => { try { const s = JSON.parse(localStorage.getItem(OPEN_KEY)); if (Array.isArray(s)) return new Set(s); } catch { /* none saved */ } return defaultOpenGroups(me.roles); });
  const toggle = (g) => setOpenSet((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); try { localStorage.setItem(OPEN_KEY, JSON.stringify([...n])); } catch { /* private mode */ } return n; });
  const creatable = CREATE_ITEMS.filter((c) => can(c.mod, 'C'));
  const adminHome = admin[0]?.items[0]?.to;

  return (
    <div className="app">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="topbar">
        <button className="iconbtn menu-btn" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name={open ? 'close' : 'menu'} /></button>
        <Link to="/" className="brand" aria-label="Enterprise CRM home"><span className="logo" aria-hidden>C</span><span className="brand-name">Enterprise CRM</span><span className="env">UAT</span></Link>
        <GlobalSearch />
        <div className="grow" />
        {creatable.length > 0 && <div className="create-menu hide-sm"><Menu label="Create" icon="add" buttonClass="btn primary" size="sm" items={creatable.map((c) => ({ label: c.label, icon: c.icon, onClick: () => setCreate(c.entity) }))} /></div>}
        <Bell />
        {adminHome && <Link to={inAdmin ? '/' : adminHome} className={`iconbtn ${inAdmin ? 'on' : ''}`} title={inAdmin ? 'Back to work' : 'Admin & settings'} aria-label={inAdmin ? 'Back to work' : 'Admin & settings'}><Icon name="admin_area" /></Link>}
        <div style={{ position: 'relative' }} ref={acct} onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}>
          <button className="iconbtn account-btn" onClick={() => setMenu(!menu)} aria-label="Account menu" aria-expanded={menu}><span className="avatar">{initials(me.name)}</span><span className="who hide-sm">{me.name}<small>{me.job_title}</small></span></button>
          {menu && (
            <div className="menu">
              <div className="menu-head"><b>{me.name}</b><div className="muted small">{me.job_title}</div><div className="muted small">{me.roles.filter((r) => r !== 'ROL-EMP' && r !== 'ROL-DM').map(roleName).join(', ')}</div></div><hr />
              <Link to="/settings/me"><Icon name="settings" />My settings</Link><Link to="/settings/me#delegation"><Icon name="approvals" />Approval delegation</Link><Link to="/design-system"><Icon name="solutions" />Design system</Link><hr />
              <button onClick={async () => { await logout(); nav('/login'); }}><Icon name="signOut" />Sign out</button>
            </div>
          )}
        </div>
      </header>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden />}
      <nav className={`sidebar ${open ? 'open' : ''}`} aria-label={inAdmin ? 'Admin and settings' : 'Main navigation'}>
        {inAdmin ? (
          <>
            <Link to="/" className="nav-back"><Icon name="back" size={16} />Back to work</Link>
            <div className="nav-area-title">Admin & settings</div>
            <NavGroups groups={admin} pending={0} openSet={new Set(admin.map((g) => g.group))} toggle={() => {}} />
          </>
        ) : (
          <>
            <NavGroups groups={work} pending={pending} openSet={openSet} toggle={toggle} />
            {adminHome && <><div className="nav-sep" /><Link to={adminHome} className="nav-link"><Icon name="admin_area" />Admin & settings</Link></>}
          </>
        )}
      </nav>
      <div className="main">
        <main className="content" id="main" key={loc.pathname}>{me.must_change_password && <div className="alert warn" style={{ marginBottom: 'var(--sp-6)' }}><Icon name="warning" /><div className="alert-body"><b>Please change your temporary password.</b> <Link to="/settings/me">Open my settings</Link></div></div>}<Outlet /></main>
      </div>
      {create && <FormModal entity={create} onClose={() => setCreate(null)} onSaved={(r) => nav(`/${create}/${r.id}`)} />}
      <TooltipLayer />
    </div>
  );
}
