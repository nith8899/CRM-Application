import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { badgeClass } from '../util';
import { Icon } from './icons';

// ───────────────────────────── status & feedback
export const Badge = ({ v, children }) => (v || children ? <span className={`badge ${badgeClass(v ?? children)}`}>{children ?? v}</span> : null);
const ALERT_ICON = { bad: 'error', warn: 'warning', good: 'success', info: 'info' };
export const Alert = ({ kind = 'info', children }) => <div className={`alert ${kind}`} role={kind === 'bad' ? 'alert' : 'status'}><Icon name={ALERT_ICON[kind] || 'info'} /><div className="alert-body">{children}</div></div>;

/** Empty state: icon + what this is + (optional) the next action. */
export function Empty({ icon = 'inbox', title, children, action, small }) {
  return <div className={`empty ${small ? 'small' : ''}`}><Icon name={icon} weight="duotone" />{title && <b className="empty-title">{title}</b>}{children && <span>{children}</span>}{action}</div>;
}

/** Loading placeholder shaped like content. `variant`: rows (table), cards, kv, page. */
export function Skeleton({ variant = 'rows', count = 5, label = 'Loading…' }) {
  const n = Array.from({ length: count });
  return (
    <div className={`skeleton-wrap ${variant}`} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {variant === 'rows' && n.map((_, i) => <div key={i} className="sk-row"><i className="sk" style={{ width: '18%' }} /><i className="sk" style={{ width: '32%' }} /><i className="sk" style={{ width: '20%' }} /><i className="sk" style={{ width: '12%' }} /></div>)}
      {variant === 'cards' && <div className="grid kpis">{n.slice(0, 4).map((_, i) => <div key={i} className="card kpi"><i className="sk" style={{ width: '50%' }} /><i className="sk sk-lg" style={{ width: '40%' }} /><i className="sk" style={{ width: '70%' }} /></div>)}</div>}
      {variant === 'kv' && <div className="kv">{n.map((_, i) => <div key={i}><i className="sk" style={{ width: '40%' }} /><i className="sk" style={{ width: '75%' }} /></div>)}</div>}
      {variant === 'page' && <><i className="sk sk-title" /><i className="sk" style={{ width: '30%' }} /><div style={{ height: 'var(--sp-6)' }} /><div className="card card-b">{n.map((_, i) => <div key={i} className="sk-row"><i className="sk" style={{ width: '25%' }} /><i className="sk" style={{ width: '45%' }} /><i className="sk" style={{ width: '15%' }} /></div>)}</div></>}
    </div>
  );
}
/** Kept for existing callers: page/section loads now show a skeleton instead of a "Loading…" line. */
export const Spinner = ({ label = 'Loading…', variant = 'page' }) => <Skeleton variant={variant} label={label} count={4} />;

/** Shown instead of a raw error when the user's role can't open something. */
export function PermissionState({ what = 'this page' }) {
  return (
    <div className="card card-b">
      <Empty icon="permissions" title={`You don't have access to ${what}`} action={<Link className="btn" to="/">Back to dashboard</Link>}>
        Your role doesn't include it. If you need it for your work, ask your manager or a system administrator to grant access.
      </Empty>
    </div>
  );
}

export function ErrorBox({ error, retry }) {
  if (!error) return null;
  if (error.status === 403) return <PermissionState />;
  if (error.status === 404) return <div className="card card-b"><Empty icon="inbox" title="Not found" action={<Link className="btn" to="/">Back to dashboard</Link>}>This record doesn't exist or was deleted.</Empty></div>;
  const d = error.data || {};
  return (
    <Alert kind="bad">
      <b>{error.message}</b>
      {Array.isArray(d.checklist) && <ul>{d.checklist.map((c, i) => <li key={i}>{c}</li>)}</ul>}
      {Array.isArray(d.errors) && <ul>{d.errors.map((c, i) => <li key={i}>{c.field ? `${c.field}: ` : ''}{c.message}</li>)}</ul>}
      {retry && <div style={{ marginTop: 'var(--sp-3)' }}><button className="btn sm" onClick={retry}>Try again</button></div>}
    </Alert>
  );
}

/** Form error summary: takes focus, lists each problem as a link to its field (WCAG 3.3.1). */
export function ErrorSummary({ errors, title = 'Please correct the highlighted fields' }) {
  const ref = useRef(null);
  const list = Object.entries(errors || {});
  useEffect(() => { if (list.length && ref.current) ref.current.focus(); }, [list.length]); // eslint-disable-line
  if (!list.length) return null;
  return (
    <div className="alert bad error-summary" role="alert" tabIndex={-1} ref={ref}>
      <Icon name="error" />
      <div className="alert-body"><b>{title}</b>
        <ul>{list.map(([field, msg]) => <li key={field}><a href={`#f_${field}`} onClick={(e) => { e.preventDefault(); const el = document.getElementById(`f_${field}`); if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); } }}>{msg}</a></li>)}</ul>
      </div>
    </div>
  );
}

// ───────────────────────────── overlays
function useFocusTrap(ref, onClose) {
  useEffect(() => {
    const prev = document.activeElement;
    const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose && onClose(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const f = [...ref.current.querySelectorAll(sel)].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    const first = ref.current && ref.current.querySelector('input:not([readonly]):not([type=hidden]), select, textarea, button.primary, button.accent');
    (first || ref.current)?.focus();
    return () => { document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
  }, []); // eslint-disable-line
}

export function Modal({ title, onClose, children, footer, size = '' }) {
  const ref = useRef(null); const hid = useId();
  useFocusTrap(ref, onClose);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-labelledby={hid} ref={ref} tabIndex={-1}>
        <div className="modal-h"><h2 id={hid}>{title}</h2><button className="iconbtn ghost" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

/** Side drawer for longer create/edit forms: the list stays visible behind it. */
export function Drawer({ title, sub, onClose, children, footer, wide }) {
  const ref = useRef(null); const hid = useId();
  useFocusTrap(ref, onClose);
  return (
    <div className="overlay drawer-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <aside className={`drawer ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={hid} ref={ref} tabIndex={-1}>
        <div className="drawer-h"><div><h2 id={hid}>{title}</h2>{sub && <div className="muted small">{sub}</div>}</div><button className="iconbtn ghost" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
        <div className="drawer-b">{children}</div>
        {footer && <div className="drawer-f">{footer}</div>}
      </aside>
    </div>
  );
}

/**
 * Confirmation for destructive or irreversible actions: what happens, what's affected, whether it can be undone,
 * and an optional required reason. The danger button is filled only here.
 */
export function Confirm({ title = 'Please confirm', message, consequences, undo, reasonLabel, onYes, onNo, yesLabel = 'Confirm', danger, busy }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={title} onClose={onNo} size="narrow" footer={<><button className="btn" onClick={onNo}>Cancel</button><button className={`btn ${danger ? 'danger solid' : 'primary'}`} disabled={busy || (reasonLabel && !reason.trim())} onClick={() => onYes(reason)}>{busy ? 'Working…' : yesLabel}</button></>}>
      <div className="stack">
        {message && <p style={{ margin: 0 }}>{message}</p>}
        {consequences?.length > 0 && <ul className="confirm-list">{consequences.map((c, i) => <li key={i}>{c}</li>)}</ul>}
        {undo != null && <div className="row gap-sm small"><Icon name={undo ? 'info' : 'warning'} size={16} /><span>{undo === true ? 'You can undo this later.' : undo === false ? 'This can’t be undone.' : undo}</span></div>}
        {reasonLabel && <label className="f"><span>{reasonLabel}<span className="req" aria-hidden> *</span></span><textarea value={reason} onChange={(e) => setReason(e.target.value)} required aria-required="true" /></label>}
      </div>
    </Modal>
  );
}

// ───────────────────────────── menus & actions
/**
 * Dropdown menu. items: [{ label, icon, onClick, to, danger, disabled, hint, divider }].
 * Keyboard: Enter/Space/↓ opens, ↑↓ move, Esc closes and returns focus.
 */
export function Menu({ label = 'More', icon = 'more', items, align = 'right', buttonClass = 'btn', iconOnly, size }) {
  const [open, setOpen] = useState(false); const box = useRef(null); const btn = useRef(null); const mid = useId();
  const list = items.filter(Boolean);
  useEffect(() => { if (!open) return; const h = (e) => box.current && !box.current.contains(e.target) && setOpen(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  useEffect(() => { if (open) box.current?.querySelector('[role=menuitem]:not([disabled])')?.focus(); }, [open]);
  const move = (e) => {
    const els = [...box.current.querySelectorAll('[role=menuitem]:not([disabled])')]; const i = els.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); }
    if (e.key === 'Tab') setOpen(false);
  };
  if (!list.length) return null;
  const run = (it) => { setOpen(false); if (it.onClick) it.onClick(); };
  return (
    <div className="menu-wrap" ref={box} onKeyDown={open ? move : undefined}>
      <button ref={btn} type="button" className={`${buttonClass} ${size || ''}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? mid : undefined} aria-label={iconOnly ? label : undefined}
        onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}>
        {icon && <Icon name={icon} size={16} />}{!iconOnly && label}{!iconOnly && <Icon name="chevronDown" size={16} />}
      </button>
      {open && (
        <div className={`menu dropdown ${align}`} role="menu" id={mid}>
          {list.map((it, i) => it.divider ? <hr key={`d${i}`} /> : it.to
            ? <Link key={i} role="menuitem" to={it.to} className={it.danger ? 'danger' : ''} onClick={() => setOpen(false)}>{it.icon && <Icon name={it.icon} size={16} />}<span className="grow">{it.label}{it.hint && <small>{it.hint}</small>}</span></Link>
            : <button key={i} type="button" role="menuitem" disabled={it.disabled} title={it.disabledReason} className={it.danger ? 'danger' : ''} onClick={() => run(it)}>{it.icon && <Icon name={it.icon} size={16} />}<span className="grow">{it.label}{it.hint && <small>{it.hint}</small>}</span></button>)}
        </div>
      )}
    </div>
  );
}

/**
 * Record action bar: one primary, at most one secondary, the rest in "More" (destructive items last).
 * actions: [{ label, onClick, icon, kind: 'primary'|'accent'|'secondary', danger }] in priority order.
 */
export function ActionBar({ actions, max = 2 }) {
  const list = actions.filter(Boolean);
  const safe = list.filter((a) => !a.danger); const risky = list.filter((a) => a.danger);
  const shown = safe.slice(0, max); const rest = [...safe.slice(max), ...(risky.length && safe.slice(max).length ? [{ divider: true }] : []), ...risky];
  return (
    <div className="row wrap action-bar">
      {shown.map((a, i) => <button key={a.label} type="button" className={`btn ${a.kind || (i === 0 ? 'primary' : '')}`} onClick={a.onClick} disabled={a.disabled}>{a.icon && <Icon name={a.icon} size={16} />}{a.label}</button>)}
      {rest.length > 0 && <Menu label="More" icon={null} items={rest} />}
    </div>
  );
}

// ───────────────────────────── page structure
export function Breadcrumbs({ items }) {
  if (!items?.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <ol>{items.map((c, i) => <li key={i}>{i === items.length - 1 ? <span aria-current="page">{c.label}</span> : <Link to={c.to}>{c.label}</Link>}{i < items.length - 1 && <Icon name="chevronRight" size={16} />}</li>)}</ol>
    </nav>
  );
}

/** Page header: breadcrumbs · eyebrow · title (+status) · meta line · actions on the right. */
export function PageHead({ title, sub, children, crumbs, eyebrow, count }) {
  return (
    <header className="page-head">
      <div className="page-head-main">
        <Breadcrumbs items={crumbs} />
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}{count != null && <span className="title-count">{count}</span>}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children && <div className="row wrap page-actions">{children}</div>}
    </header>
  );
}

/** Key facts of a record, shown once. items: [{ k, v }] */
export function SummaryStrip({ items }) {
  const list = items.filter((i) => i && i.v != null && i.v !== '');
  if (!list.length) return null;
  return <dl className="summary-strip">{list.map((i) => <div key={i.k}><dt>{i.k}</dt><dd>{i.v}</dd></div>)}</dl>;
}

/** Tabs; when there are more than `max`, the rest go into a "More" menu (with counts). */
export function Tabs({ tabs, value, onChange, max = 7 }) {
  const visible = tabs.length > max ? tabs.slice(0, max - 1) : tabs;
  const overflow = tabs.length > max ? tabs.slice(max - 1) : [];
  const active = overflow.find((t) => t.key === value);
  return (
    <div className="tabs" role="tablist">
      {visible.map((t) => <button key={t.key} role="tab" aria-selected={value === t.key} className={`tab ${value === t.key ? 'on' : ''}`} onClick={() => onChange(t.key)}>{t.label}{t.count != null && <span className="n">{t.count}</span>}</button>)}
      {active && <button role="tab" aria-selected className="tab on">{active.label}{active.count != null && <span className="n">{active.count}</span>}</button>}
      {overflow.length > 0 && <Menu label={`More (${overflow.length})`} icon={null} buttonClass="tab tab-more" align="left" items={overflow.filter((t) => t.key !== value).map((t) => ({ label: `${t.label}${t.count != null ? ` · ${t.count}` : ''}`, onClick: () => onChange(t.key) }))} />}
    </div>
  );
}

/** Segmented control for views of the same data (List · Board). */
export function Segmented({ items, value }) {
  return <div className="segmented" role="group" aria-label="View">{items.map((i) => <Link key={i.to} to={i.to} className={value === i.key ? 'on' : ''} aria-current={value === i.key ? 'page' : undefined}>{i.icon && <Icon name={i.icon} size={16} />}{i.label}</Link>)}</div>;
}

export function KV({ items }) {
  return <dl className="kv">{items.filter((i) => i).map((i) => <div key={i.k} className={i.full ? 'full' : ''}><dt className="k">{i.k}</dt><dd className="v">{i.v ?? '—'}</dd></div>)}</dl>;
}

export function Card({ title, actions, children, pad = true, sub }) {
  return <section className="card">{(title || actions) && <div className="card-h"><div>{title && <h3>{title}</h3>}{sub && <div className="muted small">{sub}</div>}</div><div className="row">{actions}</div></div>}<div className={pad ? 'card-b' : ''}>{children}</div></section>;
}

/**
 * Tooltip layer: shows any element's `title` as an accessible tooltip on hover *and keyboard focus*
 * (native titles never show on focus or touch). Mounted once in the layout.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState(null); const timer = useRef(null);
  useLayoutEffect(() => {
    const show = (e) => {
      const el = e.target.closest && e.target.closest('[title], [data-tip]');
      if (!el || el.closest('svg')) return;
      if (el.hasAttribute('title')) { const t = el.getAttribute('title'); if (!t) return; el.setAttribute('data-tip', t); el.removeAttribute('title'); if (!el.getAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', t); }
      const text = el.getAttribute('data-tip'); if (!text) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { const r = el.getBoundingClientRect(); setTip({ text, x: r.left + r.width / 2, y: r.bottom + 6, top: r.top }); }, e.type === 'focusin' ? 0 : 350);
    };
    const hide = () => { clearTimeout(timer.current); setTip(null); };
    const key = (e) => e.key === 'Escape' && hide();
    document.addEventListener('mouseover', show); document.addEventListener('focusin', show);
    document.addEventListener('mouseout', hide); document.addEventListener('focusout', hide); document.addEventListener('keydown', key); window.addEventListener('scroll', hide, true);
    return () => { document.removeEventListener('mouseover', show); document.removeEventListener('focusin', show); document.removeEventListener('mouseout', hide); document.removeEventListener('focusout', hide); document.removeEventListener('keydown', key); window.removeEventListener('scroll', hide, true); };
  }, []);
  if (!tip) return null;
  const below = tip.y + 40 < window.innerHeight;
  return <div className="tooltip" role="tooltip" style={{ left: Math.min(Math.max(tip.x, 120), window.innerWidth - 120), top: below ? tip.y : tip.top - 6, transform: `translate(-50%, ${below ? '0' : '-100%'})` }}>{tip.text}</div>;
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export { Fragment };
