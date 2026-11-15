import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { toInputDateTime } from '../util';
import { useDebounced } from './ui';

/** Autocomplete bound to /lookup/:entity */
export function Lookup({ entity, value, label, onChange, disabled, filters, placeholder, id, required }) {
  const [text, setText] = useState(label || '');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const dq = useDebounced(text, 220);
  const box = useRef(null);
  const typed = useRef(false);

  useEffect(() => { setText(label || ''); typed.current = false; }, [label, value]);
  useEffect(() => { if (value && !label) api.get(`/lookup/${entity}?id=${value}`).then((r) => { if (r[0]) setText(r[0].label); }).catch(() => {}); }, [value, label, entity]);
  useEffect(() => {
    if (!open) return; let on = true;
    const qs = new URLSearchParams({ q: typed.current ? dq : '', limit: '15', ...(filters || {}) });
    api.get(`/lookup/${entity}?${qs}`).then((r) => on && setItems(r)).catch(() => on && setItems([]));
    return () => { on = false; };
  }, [open, dq, entity, JSON.stringify(filters || {})]); // eslint-disable-line
  useEffect(() => { const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <input id={id} type="text" value={text} disabled={disabled} placeholder={placeholder || 'Search…'} autoComplete="off" required={required && !value}
        onFocus={() => setOpen(true)} onChange={(e) => { typed.current = true; setText(e.target.value); setOpen(true); if (!e.target.value) onChange(null, ''); }} />
      {open && !disabled && (
        <div className="search-results" role="listbox">
          {items.length === 0 && <div className="empty small">No matches</div>}
          {items.map((i) => <a key={i.id} href="#" role="option" onClick={(e) => { e.preventDefault(); onChange(i.id, i.label); setText(i.label); setOpen(false); }}><span className="grow">{i.label}</span><span className="muted small">{i.sub || ''}</span></a>)}
        </div>
      )}
    </div>
  );
}

const NUM = ['int', 'decimal', 'money', 'pct'];

export function FieldInput({ field, value, onChange, error, labelValue, meta, readOnly }) {
  const f = field; const id = `f_${f.name}`;
  const ro = readOnly || f.readonly;
  const set = (v) => onChange(f.name, v);
  let input;
  if (f.type === 'longtext') input = <textarea id={id} value={value ?? ''} disabled={ro} onChange={(e) => set(e.target.value)} />;
  else if (f.type === 'bool') return <label className="check"><input type="checkbox" id={id} checked={!!value} disabled={ro} onChange={(e) => set(e.target.checked)} />{f.label}{error && <span className="err">{error}</span>}</label>;
  else if (f.type === 'select') {
    const opts = f.options || [];
    input = (
      <select id={id} value={value ?? ''} disabled={ro} onChange={(e) => set(e.target.value)}>
        <option value="">{f.req ? 'Select…' : '—'}</option>
        {opts.map((o) => <option key={o} value={o}>{(f.picklist && meta?.labels?.[`${f.picklist}:${o}`]) || o}</option>)}
        {value && !opts.includes(value) && <option value={value}>{value}</option>}
      </select>
    );
  } else if (f.type === 'ref') input = <Lookup id={id} entity={f.ref} value={value} label={labelValue} disabled={ro} required={f.req} onChange={(v, l) => onChange(f.name, v, l)} />;
  else if (f.type === 'date') input = <input id={id} type="date" value={value ? String(value).slice(0, 10) : ''} disabled={ro} onChange={(e) => set(e.target.value)} />;
  else if (f.type === 'datetime') input = <input id={id} type="datetime-local" value={toInputDateTime(value)} disabled={ro} onChange={(e) => set(e.target.value ? new Date(e.target.value).toISOString() : '')} />;
  else if (NUM.includes(f.type)) input = <input id={id} type="number" step={f.type === 'int' ? '1' : 'any'} value={value ?? ''} disabled={ro} onChange={(e) => set(e.target.value === '' ? '' : e.target.value)} />;
  else if (f.type === 'email') input = <input id={id} type="email" value={value ?? ''} disabled={ro} onChange={(e) => set(e.target.value)} />;
  else if (f.type === 'phone') input = <input id={id} type="tel" value={value ?? ''} disabled={ro} onChange={(e) => set(e.target.value)} />;
  else if (f.type === 'url') input = <input id={id} type="url" value={value ?? ''} disabled={ro} onChange={(e) => set(e.target.value)} />;
  else if (f.type === 'json') input = <textarea id={id} value={typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)} disabled={ro} onChange={(e) => set(e.target.value)} />;
  else input = <input id={id} type={f.pwd ? 'password' : 'text'} value={value ?? ''} disabled={ro} autoComplete={f.pwd ? 'new-password' : 'off'} onChange={(e) => set(e.target.value)} />;
  return (
    <label className={`f ${['longtext', 'json'].includes(f.type) ? 'full' : ''}`} htmlFor={id}>
      <span>{f.label}{f.req && <span className="req"> *</span>}</span>
      {input}
      {f.help && <span className="help">{f.help}</span>}
      {error && <span className="err">{error}</span>}
    </label>
  );
}
