import { useEffect, useRef, useState } from 'react';
import { badgeClass } from '../util';
import { Icon } from './icons';

export const Badge = ({ v, children }) => (v || children ? <span className={`badge ${badgeClass(v ?? children)}`}>{children ?? v}</span> : null);
export const Spinner = ({ label = 'Loading…' }) => <div className="empty" role="status"><span className="spinner" aria-hidden />{label}</div>;
const ALERT_ICON = { bad: 'error', warn: 'warning', good: 'success', info: 'info' };
export const Alert = ({ kind = 'info', children }) => <div className={`alert ${kind}`} role={kind === 'bad' ? 'alert' : 'status'}><Icon name={ALERT_ICON[kind] || 'info'} /><div className="alert-body">{children}</div></div>;
export const Empty = ({ icon = 'inbox', children, small }) => <div className={`empty ${small ? 'small' : ''}`}><Icon name={icon} weight="duotone" />{children}</div>;

export function ErrorBox({ error }) {
  if (!error) return null;
  const d = error.data || {};
  return (
    <Alert kind="bad">
      <b>{error.message}</b>
      {Array.isArray(d.checklist) && <ul>{d.checklist.map((c, i) => <li key={i}>{c}</li>)}</ul>}
      {Array.isArray(d.errors) && <ul>{d.errors.map((c, i) => <li key={i}>{c.field ? `${c.field}: ` : ''}{c.message}</li>)}</ul>}
    </Alert>
  );
}

export function Modal({ title, onClose, children, footer, size = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    document.addEventListener('keydown', onKey);
    const first = ref.current && ref.current.querySelector('input:not([readonly]), select, textarea, button.primary');
    if (first) first.focus();
    return () => { document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-h"><h2>{title}</h2><button className="iconbtn" style={{ border: 0 }} aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function PageHead({ title, sub, children }) {
  return <div className="page-head"><div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div><div className="row wrap">{children}</div></div>;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => <button key={t.key} role="tab" aria-selected={value === t.key} className={`tab ${value === t.key ? 'on' : ''}`} onClick={() => onChange(t.key)}>{t.label}{t.count != null && <span className="n">{t.count}</span>}</button>)}
    </div>
  );
}

export function KV({ items }) {
  return <div className="kv">{items.filter((i) => i).map((i) => <div key={i.k} className={i.full ? 'full' : ''}><div className="k">{i.k}</div><div className="v">{i.v ?? '—'}</div></div>)}</div>;
}

export function Card({ title, actions, children, pad = true }) {
  return <div className="card">{(title || actions) && <div className="card-h"><h3>{title}</h3><div className="row">{actions}</div></div>}<div className={pad ? 'card-b' : ''}>{children}</div></div>;
}

export function Confirm({ title = 'Please confirm', message, onYes, onNo, yesLabel = 'Confirm', danger }) {
  return <Modal title={title} onClose={onNo} size="narrow" footer={<><button className="btn" onClick={onNo}>Cancel</button><button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onYes}>{yesLabel}</button></>}><p>{message}</p></Modal>;
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
