import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './icons';
import { Link, useNavigate } from 'react-router-dom';
import { api, openAuthed, ApiError } from '../api';
import { useAuth, useMeta, useToast, loadMeta } from '../state';
import { fmtDate, fmtDateTime, fmtMoney, fmtPct } from '../util';
import { Alert, Badge, Confirm, Drawer, Empty, ErrorBox, ErrorSummary, Menu, Modal, Skeleton, Spinner, useDebounced } from './ui';
import { FieldInput } from './fields';

// ------------------------------------------------------------------ value rendering
export function renderValue(f, row, meta) {
  const v = row[f.name];
  if (row[`${f.name}__masked`]) return <span className="muted" title="Restricted field">••••</span>;
  if (v === null || v === undefined || v === '') return <span className="muted">—</span>;
  switch (f.type) {
    case 'ref': return <Link to={`/${f.ref}/${v}`} onClick={(e) => e.stopPropagation()}>{row[`${f.name}__label`] || `#${v}`}</Link>;
    case 'money': return <span className="mono">{fmtMoney(v)}</span>;
    case 'decimal': return <span className="mono">{Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 })}</span>;
    case 'pct': return <span className="mono">{fmtPct(v)}</span>;
    case 'date': return fmtDate(v);
    case 'datetime': return fmtDateTime(v);
    case 'bool': return v ? 'Yes' : 'No';
    case 'json': return <span className="muted small">{Array.isArray(v) ? `${v.length} item(s)` : '{…}'}</span>;
    case 'select': { const lbl = (f.picklist && meta?.labels?.[`${f.picklist}:${v}`]) || v; return f.name === 'status' || /status|stage|priority|outcome/.test(f.name) ? <Badge v={v}>{lbl}</Badge> : lbl; }
    case 'url': return <a href={v} target="_blank" rel="noreferrer">{v}</a>;
    case 'email': return <a href={`mailto:${v}`} onClick={(e) => e.stopPropagation()}>{v}</a>;
    default: return String(v).length > 80 ? `${String(v).slice(0, 80)}…` : String(v);
  }
}

// -------------------------------------------------------------------------- table
const NUMERIC = ['money', 'int', 'decimal', 'pct'];
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/**
 * List template for every record type: search, status chips, field filters, sortable columns,
 * row selection with a bulk bar, skeleton loading, empty states, pagination, phone-stacked rows.
 */
export function EntityTable({ entity, filters = {}, columns, embedded, onNew, refreshKey, title, onRowClick, size = 25, hideToolbar, extraActions, onCount }) {
  const { meta, error } = useMeta(entity);
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [page, setPage] = useState(1); const [sort, setSort] = useState(null); const [status, setStatus] = useState('');
  const [data, setData] = useState({ rows: [], total: 0 }); const [loading, setLoading] = useState(true); const [err, setErr] = useState(null);
  const [showImport, setShowImport] = useState(false); const [mine, setMine] = useState(false);
  const [showFilters, setShowFilters] = useState(false); const [ff, setFf] = useState({});
  const [sel, setSel] = useState(() => new Set()); const [owner, setOwner] = useState(null); const [bulkBusy, setBulkBusy] = useState(false);
  const fkey = JSON.stringify(filters); const ffkey = JSON.stringify(ff);

  const load = useCallback(() => {
    if (!meta) return; setLoading(true);
    const p = new URLSearchParams({ page, size });
    if (dq) p.set('q', dq); if (sort) { p.set('sort', sort.name); p.set('dir', sort.dir); } if (status && meta.statusField) p.set(`f_${meta.statusField}`, status); if (mine) p.set('mine', '1');
    Object.entries({ ...ff, ...filters }).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && p.set(k.startsWith('f_') ? k : `f_${k}`, v));
    api.get(`/e/${entity}?${p}`).then((d) => { setData(d); setErr(null); onCount && onCount(d.total); }).catch(setErr).finally(() => setLoading(false));
  }, [meta, entity, page, dq, sort, status, mine, fkey, ffkey, size, refreshKey]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); setSel(new Set()); }, [dq, status, entity, fkey, ffkey, mine]);

  if (error) return <ErrorBox error={error} />;
  if (!meta) return <div className={embedded ? '' : 'card'}><Skeleton variant="rows" /></div>;
  // Column priority: identifier and title first, then status (so it never scrolls out of view), then the rest; max 8.
  const listCols = columns ? columns.map((n) => meta.fields.find((f) => f.name === n)).filter(Boolean) : meta.fields.filter((f) => f.list);
  const st = !columns && meta.statusField && listCols.find((f) => f.name === meta.statusField);
  const lead = listCols.filter((f) => f !== st && (f.name === 'number' || f.name === meta.title));
  const cols = (st ? [...lead, st, ...listCols.filter((f) => f !== st && !lead.includes(f))] : listCols).slice(0, embedded ? 6 : 8);
  const statusField = meta.statusField && meta.fields.find((f) => f.name === meta.statusField);
  const filterable = meta.fields.filter((f) => f.list && f.type === 'select' && f.options?.length && f.name !== meta.statusField).slice(0, 4);
  const activeFilters = Object.entries(ff).filter(([, v]) => v);
  const filtered = !!(dq || status || mine || activeFilters.length);
  const pages = Math.max(1, Math.ceil(data.total / size));
  const click = (r) => (onRowClick ? onRowClick(r) : nav(`/${entity}/${r.id}`));
  const selectable = !embedded && !onRowClick;
  const allOnPage = data.rows.length > 0 && data.rows.every((r) => sel.has(r.id));
  const toggleRow = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSel(allOnPage ? new Set() : new Set(data.rows.map((r) => r.id)));
  const clearFilters = () => { setQ(''); setStatus(''); setMine(false); setFf({}); };
  const label = (f, v) => (f.picklist && meta.labels?.[`${f.picklist}:${v}`]) || v;

  const exportSelected = () => {
    const rows = data.rows.filter((r) => sel.has(r.id));
    const csv = [cols.map((f) => csvCell(f.label)).join(','), ...rows.map((r) => cols.map((f) => csvCell(r[`${f.name}__label`] ?? r[f.name])).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv' })); a.download = `${entity}-selected.csv`; a.click(); URL.revokeObjectURL(a.href);
    toast(`${rows.length} ${rows.length === 1 ? meta.label.toLowerCase() : meta.plural.toLowerCase()} exported`, 'success');
  };
  const reassign = async () => {
    setBulkBusy(true); let ok = 0; const fails = [];
    for (const r of data.rows.filter((x) => sel.has(x.id))) {
      try { await api.put(`/e/${entity}/${r.id}`, { owner_id: owner.id, version: r.version }); ok += 1; } catch (e) { fails.push(`${r.number || r.id}: ${e.message}`); }
    }
    setBulkBusy(false); setOwner(null); setSel(new Set()); load();
    if (ok) toast(`Owner changed on ${ok} record${ok === 1 ? '' : 's'}`, 'success');
    if (fails.length) toast(`${fails.length} not changed — ${fails.slice(0, 2).join('; ')}`, 'error');
  };

  const createBtn = onNew && meta.perms.C && !meta.system && embedded ? <button className="btn sm" onClick={onNew}><Icon name="add" size={16} />New {meta.label.toLowerCase()}</button> : null;
  const dataMenu = !embedded && [
    meta.perms.X && { label: 'Export all to CSV', icon: 'download', onClick: () => openAuthed(`/e/${entity}/export.csv`, `${entity}.csv`).catch((e) => toast(e.message, 'error')) },
    meta.perms.I && !meta.system && { label: 'Import from CSV', icon: 'imports', onClick: () => setShowImport(true) },
  ].filter(Boolean);

  return (
    <div className={embedded ? 'embedded-list' : 'card'}>
      {!hideToolbar && (
        <div className="list-toolbar">
          {title && <h3 style={{ marginRight: 'var(--sp-4)' }}>{title}</h3>}
          <div className="search-field"><Icon name="search" size={16} /><input type="search" placeholder={`Search ${meta.plural.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${meta.plural.toLowerCase()}`} /></div>
          {statusField && statusField.options && !embedded && (
            <div className="row wrap gap-sm status-chips" role="group" aria-label="Filter by status">
              <button className={`chip ${!status ? 'on' : ''}`} aria-pressed={!status} onClick={() => setStatus('')}>All</button>
              {statusField.options.slice(0, 7).map((o) => <button key={o} className={`chip ${status === o ? 'on' : ''}`} aria-pressed={status === o} onClick={() => setStatus(status === o ? '' : o)}>{label(statusField, o)}</button>)}
            </div>
          )}
          {!embedded && filterable.length > 0 && <button className={`btn sm ${showFilters || activeFilters.length ? 'on' : 'ghost'}`} aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}><Icon name="filter" size={16} />Filter{activeFilters.length ? ` · ${activeFilters.length}` : ''}</button>}
          {meta.hasOwner && !embedded && <label className="row small"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine only</label>}
          <div className="grow" />
          {extraActions}
          {dataMenu && dataMenu.length > 0 && <Menu label="Data" icon="download" buttonClass="btn ghost" size="sm" items={dataMenu} />}
          {createBtn}
        </div>
      )}
      {showFilters && !embedded && (
        <div className="filter-row">
          {filterable.map((f) => <label key={f.name} className="f">{f.label}<select value={ff[f.name] || ''} onChange={(e) => setFf((x) => ({ ...x, [f.name]: e.target.value }))}><option value="">Any</option>{f.options.map((o) => <option key={o} value={o}>{label(f, o)}</option>)}</select></label>)}
          {activeFilters.length > 0 && <button className="btn sm ghost" onClick={() => setFf({})}>Clear filters</button>}
        </div>
      )}
      {!showFilters && activeFilters.length > 0 && (
        <div className="filter-row">{activeFilters.map(([k, v]) => { const f = meta.fields.find((x) => x.name === k); return <button key={k} className="chip active-filter" onClick={() => setFf((x) => ({ ...x, [k]: '' }))} aria-label={`Remove filter ${f?.label}: ${v}`}>{f?.label}: {label(f, v)}<Icon name="close" size={16} /></button>; })}</div>
      )}
      {sel.size > 0 && (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <span>{sel.size} selected</span>
          <button className="btn sm" onClick={exportSelected}><Icon name="download" size={16} />Export selected</button>
          {meta.hasOwner && meta.perms.G && <button className="btn sm" onClick={() => setOwner({ id: null, label: '' })}><Icon name="reassign" size={16} />Change owner</button>}
          <div className="grow" /><button className="btn sm ghost" onClick={() => setSel(new Set())}>Clear selection</button>
        </div>
      )}
      <ErrorBox error={err} retry={load} />
      <div className="table-wrap">
        {(data.rows.length > 0 || !loading) && (
          <table className={`t list stack-sm ${selectable ? 'has-sel' : ''}`}>
            <thead><tr>
              {selectable && <th className="sel"><input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Select all on this page" /></th>}
              {cols.map((f) => <th key={f.name} scope="col" className={`sortable ${NUMERIC.includes(f.type) ? 'num' : ''}`} aria-sort={sort && sort.name === f.name ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="th-sort" onClick={() => setSort(sort && sort.name === f.name ? { name: f.name, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { name: f.name, dir: 'asc' })}>{f.label}<Icon name={sort && sort.name === f.name ? (sort.dir === 'asc' ? 'sortAsc' : 'sortDesc') : 'sortable'} size={16} /></button></th>)}
            </tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className={`click ${sel.has(r.id) ? 'selected' : ''}`} tabIndex={0} onClick={() => click(r)} onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && click(r)}>
                  {selectable && <td className="sel" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleRow(r.id)} aria-label={`Select ${r.number || r[meta.title] || r.id}`} /></td>}
                  {cols.map((f) => <td key={f.name} data-label={f.label} title={typeof r[f.name] === 'string' && r[f.name].length > 40 ? r[f.name] : undefined} className={NUMERIC.includes(f.type) ? 'num nowrap' : ['date', 'datetime'].includes(f.type) ? 'nowrap' : ''}>{renderValue(f, r, meta)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && data.rows.length === 0 && (filtered
          ? <Empty icon="search" title={`No ${meta.plural.toLowerCase()} match`} action={<button className="btn sm" onClick={clearFilters}>Clear search and filters</button>}>Try fewer filters or a different search.</Empty>
          : <Empty icon={embedded ? 'inbox' : 'inbox'} title={`No ${meta.plural.toLowerCase()} yet`} action={onNew && meta.perms.C && !meta.system ? <button className="btn sm" onClick={onNew}><Icon name="add" size={16} />New {meta.label.toLowerCase()}</button> : null}>{meta.system ? 'Records of this type are created by workflows.' : embedded ? 'Nothing linked to this record yet.' : 'Records you can see will appear here.'}</Empty>)}
        {loading && data.rows.length === 0 && <Skeleton variant="rows" />}
      </div>
      {data.total > 0 && (
        <div className="pager">
          <span>{data.total <= size ? `${data.total} record${data.total === 1 ? '' : 's'}` : `${(page - 1) * size + 1}–${Math.min(page * size, data.total)} of ${data.total}`}</span>
          {pages > 1 && <div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span aria-live="polite">Page {page} of {pages}</span><button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>}
        </div>
      )}
      {showImport && <ImportModal entity={entity} meta={meta} onClose={() => { setShowImport(false); load(); }} />}
      {owner && (
        <Modal title={`Change owner of ${sel.size} ${sel.size === 1 ? meta.label.toLowerCase() : meta.plural.toLowerCase()}`} size="narrow" onClose={() => setOwner(null)} footer={<><button className="btn" onClick={() => setOwner(null)}>Cancel</button><button className="btn primary" disabled={!owner.id || bulkBusy} onClick={reassign}>{bulkBusy ? 'Changing…' : 'Change owner'}</button></>}>
          <div className="stack"><FieldInput field={{ name: 'bulk_owner', label: 'New owner', type: 'ref', ref: 'users', req: true }} value={owner.id} labelValue={owner.label} onChange={(n, v, l) => setOwner({ id: v, label: l })} /><div className="help">Each record is updated separately, with the same rules and audit as a single edit. Records you can't reassign are listed afterwards.</div></div>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------- form
/** Group fields into sections; fields before the first section heading go under `defaultTitle`. */
function sectionize(fields, defaultTitle) {
  const out = []; let cur = null;
  for (const f of fields) { const s = f.section || (cur ? cur.title : defaultTitle); if (!cur || cur.title !== s) { cur = { title: s, items: [] }; out.push(cur); } cur.items.push(f); }
  return out;
}
export const formFields = (meta) => meta.fields.filter((f) => !f.hide && !(f.readonly && f.name !== 'owner_id') && !(f.name === 'owner_id' && !meta.perms.G) && !(f.name === 'number'));

export function EntityForm({ entity, record, defaults = {}, onSaved, onCancel }) {
  const { meta, error } = useMeta(entity);
  const toast = useToast();
  const [vals, setVals] = useState(null); const [labels, setLabels] = useState({});
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false); const [dups, setDups] = useState(null); const [reason, setReason] = useState('');

  useEffect(() => {
    if (!meta) return;
    const init = {};
    for (const f of meta.fields) if (f.def !== undefined && !record) init[f.name] = f.def;
    Object.assign(init, record ? Object.fromEntries(Object.entries(record).filter(([k]) => !k.endsWith('__label'))) : {}, defaults);
    setVals(init);
    setLabels(Object.fromEntries(Object.entries(record || {}).filter(([k]) => k.endsWith('__label')).map(([k, v]) => [k.replace('__label', ''), v])));
  }, [meta]); // eslint-disable-line
  if (error) return <ErrorBox error={error} />;
  if (!meta || !vals) return <Skeleton variant="kv" count={6} />;

  const fields = formFields(meta);
  const fieldErrors = Object.fromEntries(((err && err.data && err.data.errors) || []).filter((e) => e.field).map((e) => [e.field, e.message]));
  const onChange = (name, v, label) => { setVals((x) => ({ ...x, [name]: v })); if (label !== undefined) setLabels((x) => ({ ...x, [name]: label })); };

  const submit = async (e, override) => {
    e && e.preventDefault(); setBusy(true); setErr(null);
    try {
      const body = {};
      for (const f of fields) if (f.name in vals) body[f.name] = vals[f.name];
      if (record) body.version = record.version;
      if (override) body.override_reason = override;
      const saved = record ? await api.put(`/e/${entity}/${record.id}`, body) : await api.post(`/e/${entity}`, body);
      toast(`${meta.label} ${record ? 'saved' : 'created'}`, 'success');
      onSaved(saved);
    } catch (ex) {
      if (ex instanceof ApiError && ex.status === 409 && ex.data.code === 'DUPLICATE') setDups(ex.data);
      else setErr(ex);
    } finally { setBusy(false); }
  };

  const sections = sectionize(fields, record ? 'Details' : `${meta.label} details`);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  return (
    <form onSubmit={submit} noValidate>
      {hasFieldErrors ? <ErrorSummary errors={fieldErrors} /> : <ErrorBox error={err} />}
      <div className="form-grid">
        {sections.map((s) => (
          <Fragment key={s.title}>
            {sections.length > 1 && <div className="form-section">{s.title}</div>}
            {s.items.map((f) => <FieldInput key={f.name} field={f} meta={meta} value={vals[f.name]} labelValue={labels[f.name]} onChange={onChange} error={fieldErrors[f.name]} />)}
          </Fragment>
        ))}
      </div>
      <p className="help" style={{ marginTop: 'var(--sp-5)' }}>Fields marked <span className="req">*</span> are required.</p>
      <div className="form-actions">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : record ? 'Save changes' : `Create ${meta.label.toLowerCase()}`}</button>
      </div>
      {dups && (
        <Modal title="Possible duplicates found" size="narrow" onClose={() => setDups(null)} footer={<><button className="btn" onClick={() => setDups(null)}>Review</button><button className="btn primary" disabled={!reason.trim()} onClick={(e) => { setDups(null); submit(e, reason); }}>Create anyway</button></>}>
          <p>{dups.error}</p>
          <ul>{dups.matches.map((m) => <li key={m.id}><Link to={`/${entity}/${m.id}`} target="_blank">{m.number || ''} {m.label}</Link> <span className="muted small">({m.kind === 'match' ? 'same key' : 'similar'})</span></li>)}</ul>
          <label className="f"><span>Reason to create anyway<span className="req" aria-hidden> *</span></span><input type="text" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        </Modal>
      )}
    </form>
  );
}

/** Create/edit container: short forms (≤ 8 fields) open in a dialog, longer ones in a side drawer. */
export function FormModal({ entity, record, defaults, title, onClose, onSaved }) {
  const { meta } = useMeta(entity);
  const heading = title || `${record ? 'Edit' : 'New'} ${meta ? meta.label.toLowerCase() : ''}`;
  const body = <EntityForm entity={entity} record={record} defaults={defaults} onCancel={onClose} onSaved={(r) => { onSaved && onSaved(r); onClose(); }} />;
  if (meta && formFields(meta).length <= 8) return <Modal title={heading} size="wide" onClose={onClose}>{body}</Modal>;
  return <Drawer title={heading} sub={record ? (record.number || undefined) : undefined} wide={meta && formFields(meta).length > 20} onClose={onClose}>{body}</Drawer>;
}

// ------------------------------------------------------------------ action runner
const REASON = [{ name: 'reason', label: 'Reason', type: 'text', req: true }];
export const ACTION_SPECS = {
  'leads.disqualify': { fields: [{ name: 'reason', label: 'Reason', type: 'select', picklist: 'disqualify_reasons', req: true }, { name: 'comment', label: 'Comment (required for "Other")', type: 'longtext' }] },
  'leads.convert': { title: 'Convert lead', fields: [{ name: 'account_id', label: 'Link to existing account (leave empty to create one)', type: 'ref', ref: 'accounts' }, { name: 'create_opportunity', label: 'Create an opportunity', type: 'bool', def: true },
    { name: 'opp_name', label: 'Opportunity name', type: 'text' }, { name: 'opp_amount', label: 'Opportunity amount', type: 'money' }, { name: 'opp_close', label: 'Expected close date', type: 'date' }],
    build: (v) => ({ account_id: v.account_id || undefined, create_opportunity: v.create_opportunity !== false, opportunity: { name: v.opp_name || undefined, amount: v.opp_amount || undefined, close_date: v.opp_close || undefined } }) },
  'opportunities.cancel': { fields: REASON }, 'opportunities.reopen': { fields: [...REASON, { name: 'to', label: 'Reopen at stage', type: 'select', picklist: 'opp_stages', def: 'S09' }] },
  'opportunities.set_probability': { fields: [{ name: 'probability', label: 'Probability %', type: 'pct', req: true }, { name: 'reason', label: 'Reason (required outside ± range)', type: 'text' }] },
  'opportunities.set_forecast_category': { fields: [{ name: 'category', label: 'Category', type: 'select', options: ['Pipeline', 'Best case', 'Commit', 'Omitted'], req: true }] },
  'opportunities.snooze_stall': { fields: [{ name: 'reason', label: 'Reason', type: 'text', req: true }, { name: 'days', label: 'Days (max 7)', type: 'int', def: 7 }] },
  'deal_registrations.decide_conflict': { fields: [{ name: 'winner_id', label: 'Winning registration', type: 'ref', ref: 'deal_registrations', req: true }, { name: 'rationale', label: 'Rationale', type: 'longtext', req: true }] },
  'deal_registrations.record_vendor_decision': { fields: [{ name: 'approved', label: 'Vendor approved the registration', type: 'bool', def: true }, { name: 'vendor_ref', label: 'Vendor registration reference', type: 'text' }, { name: 'protection_start', label: 'Protection start', type: 'date' }, { name: 'protection_end', label: 'Protection expiry', type: 'date' }, { name: 'notes', label: 'Notes / rejection reason', type: 'text' }] },
  'deal_registrations.extend': { fields: [{ name: 'new_end', label: 'New expiry date', type: 'date', req: true }, { name: 'exception_reason', label: 'Vendor exception reason (if renewal limit reached)', type: 'text' }] },
  'deal_registrations.cancel': { fields: REASON }, 'partners.suspend': { fields: REASON }, 'solution_configs.reject': { fields: REASON }, 'events.cancel': { fields: REASON },
  'solution_configs.vendor_validate': { fields: [{ name: 'ref', label: 'Vendor validation reference', type: 'text', req: true }] },
  'accounts.merge': { title: 'Merge into another account', fields: [{ name: 'target_id', label: 'Target account (this account will be merged into it)', type: 'ref', ref: 'accounts', req: true }] },
  'activity_reports.return': { fields: [{ name: 'comment', label: 'Comment', type: 'longtext', req: true }] },
  'meeting_participants.respond': { fields: [{ name: 'response', label: 'Response', type: 'select', options: ['Accepted', 'Tentative', 'Declined'], req: true }] },
  'meeting_participants.mark_attendance': { fields: [{ name: 'attendance', label: 'Attendance', type: 'select', options: ['Attended', 'No-show', 'Excused'], req: true }] },
  'forecast_submissions.review': { fields: [{ name: 'manager_adjustment', label: 'Adjusted amount (optional)', type: 'money' }, { name: 'reason', label: 'Reason for adjustment', type: 'text' }] },
  'reopen.leads': { fields: [] },
};
const HIDDEN_ACTIONS = new Set(['opportunities.change_stage', 'opportunities.resume', 'opportunities.cancel', 'opportunities.reopen', 'opportunities.set_probability', 'opportunities.set_forecast_category', 'opportunities.snooze_stall', 'claims.adjust', 'claims.submit', 'claims.cancel']);
// Show an action only when it can apply to the record's current state (the server still enforces every rule)
const ACTION_WHEN = {
  'leads.accept': (r) => r.status === 'Pending acceptance', 'leads.qualify': (r) => ['New', 'Working', 'Pending acceptance'].includes(r.status), 'leads.disqualify': (r) => !['Converted', 'Disqualified'].includes(r.status),
  'leads.reopen': (r) => r.status === 'Disqualified', 'leads.convert': (r) => !['Converted', 'Disqualified'].includes(r.status),
  'partners.submit_onboarding': (r) => ['Applied', 'Returned'].includes(r.status), 'partners.suspend': (r) => r.status === 'Active', 'partners.reactivate': (r) => r.status === 'Suspended',
  'deal_registrations.submit_internal': (r) => ['Draft', 'Returned'].includes(r.status), 'deal_registrations.decide_conflict': (r) => r.conflict_status === 'Open', 'deal_registrations.submit_to_vendor': (r) => r.status === 'Approved for submission',
  'deal_registrations.record_vendor_decision': (r) => ['Submitted to vendor', 'Extension requested'].includes(r.status), 'deal_registrations.extend': (r) => r.status === 'Vendor approved', 'deal_registrations.cancel': (r) => !['Cancelled', 'Expired', 'Vendor rejected'].includes(r.status),
  'solution_configs.submit_review': (r) => ['Draft', 'Rejected'].includes(r.status), 'solution_configs.validate': (r) => r.status === 'In review', 'solution_configs.reject': (r) => r.status === 'In review', 'solution_configs.vendor_validate': (r) => r.status === 'Validated', 'solution_configs.new_version': (r) => r.status !== 'Superseded',
  'sales_targets.submit': (r) => r.status === 'Draft', 'events.submit_budget': (r) => r.status === 'Draft', 'events.open_registration': (r) => r.status === 'Approved', 'events.start': (r) => r.status === 'Open for registration', 'events.complete': (r) => ['In progress', 'Open for registration'].includes(r.status),
  'events.cancel': (r) => !['Completed', 'Cancelled'].includes(r.status), 'events.leads_from_attendees': (r) => ['In progress', 'Completed'].includes(r.status),
  'activity_reports.submit': (r) => ['Draft', 'Returned', 'Reopened'].includes(r.status), 'activity_reports.approve': (r) => r.status === 'Submitted', 'activity_reports.return': (r) => r.status === 'Submitted', 'activity_reports.reopen': (r) => r.status === 'Approved',
  'commission_records.approve': (r) => ['Estimated', 'Under review'].includes(r.status), 'commission_records.export': (r) => r.status === 'Approved', 'renewals.create_opportunity': (r) => !r.opportunity_id,
  'tasks.complete': (r) => !['Completed', 'Cancelled'].includes(r.status), 'tasks.claim': (r) => !!r.queue, 'forecast_submissions.submit': (r) => r.status === 'Draft', 'forecast_submissions.review': (r) => r.status === 'Submitted',
  'contacts.anonymise': (r) => !r.anonymised, 'approval_processes.activate': (r) => r.status === 'Draft',
};

export function ActionDialog({ entity, recordId, action, onClose, onDone }) {
  const key = `${entity}.${action.key}`;
  const spec = ACTION_SPECS[key] || (action.prompt ? { fields: [{ name: action.prompt, label: action.prompt === 'reason' ? 'Reason' : action.prompt, type: 'text', req: true }] } : { fields: [] });
  const [vals, setVals] = useState(() => Object.fromEntries(spec.fields.filter((f) => f.def !== undefined).map((f) => [f.name, f.def])));
  const [labels, setLabels] = useState({}); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false); const [override, setOverride] = useState(false);
  const toast = useToast();
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      let body = spec.build ? spec.build(vals) : { ...vals };
      if (override) body = { ...body, override: true };
      const r = await api.post(`/e/${entity}/${recordId}/actions/${action.key}`, body);
      toast(`${action.label}: done`, 'success'); onDone && onDone(r); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const canOverride = err && err.data && err.data.can_override;
  return (
    <Modal title={spec.title || action.label} size="narrow" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={run}>{busy ? 'Working…' : action.label}</button></>}>
      {spec.fields.length === 0 && <p>{action.confirm || `Run “${action.label}”?`}</p>}
      <div className="stack">
        {spec.fields.map((f) => <FieldInput key={f.name} field={{ ...f, options: f.options }} meta={{ labels: undefined }} value={vals[f.name]} labelValue={labels[f.name]} onChange={(n, v, l) => { setVals((x) => ({ ...x, [n]: v })); if (l !== undefined) setLabels((x) => ({ ...x, [n]: l })); }} />)}
        <ErrorBox error={err} />
        {canOverride && <label className="check" style={{ paddingTop: 0 }}><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />Manager override (a reason is required)</label>}
        {canOverride && override && <label className="f">Override reason<input type="text" value={vals.reason || ''} onChange={(e) => setVals((x) => ({ ...x, reason: e.target.value }))} /></label>}
      </div>
    </Modal>
  );
}
export const visibleActions = (entity, meta, rec) => (meta.actions || []).filter((a) => !HIDDEN_ACTIONS.has(`${entity}.${a.key}`) && (!rec || !ACTION_WHEN[`${entity}.${a.key}`] || ACTION_WHEN[`${entity}.${a.key}`](rec)));

// ---------------------------------------------------------------- side panels
export function DocumentsPanel({ entity, recordId, canUpload }) {
  const [docs, setDocs] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false); const toast = useToast();
  const [cat, setCat] = useState('General'); const [conf, setConf] = useState('Internal'); const [file, setFile] = useState(null); const [exp, setExp] = useState('');
  const load = useCallback(() => api.get(`/documents?entity=${entity}&record_id=${recordId}`).then(setDocs).catch(setErr), [entity, recordId]);
  useEffect(() => { load(); }, [load]);
  const upload = async (parent) => {
    if (!file) return; setBusy(true);
    try { const f = new FormData(); f.append('file', file); f.append('entity', entity); f.append('record_id', recordId); f.append('category', cat); f.append('confidentiality', conf); if (exp) f.append('expiry_date', exp); if (parent) f.append('parent_document_id', parent); await api.upload('/documents', f); setFile(null); toast('Document uploaded', 'success'); load(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  if (err) return <ErrorBox error={err} />;
  if (!docs) return <Spinner />;
  return (
    <div className="stack">
      {canUpload && (
        <div className="row wrap">
          <input type="file" aria-label="File" onChange={(e) => setFile(e.target.files[0])} style={{ maxWidth: 260 }} />
          <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 150 }} aria-label="Category">{['General', 'Contract', 'Proposal', 'Meeting minutes', 'Technical', 'Customer PO', 'Evidence', 'Receipt'].map((c) => <option key={c}>{c}</option>)}</select>
          <select value={conf} onChange={(e) => setConf(e.target.value)} style={{ width: 130 }} aria-label="Confidentiality">{['Internal', 'Restricted'].map((c) => <option key={c}>{c}</option>)}</select>
          <input type="date" value={exp} onChange={(e) => setExp(e.target.value)} style={{ width: 150 }} aria-label="Expiry date" title="Expiry date (optional)" />
          <button className="btn primary" disabled={!file || busy} onClick={() => upload()}>{busy ? 'Uploading…' : 'Upload'}</button>
        </div>
      )}
      <table className="t"><thead><tr><th>File</th><th>Category</th><th>Version</th><th>Uploaded</th><th /></tr></thead>
        <tbody>{docs.map((d) => <tr key={d.id}><td><b>{d.title}</b><div className="muted small">{(d.size / 1024).toFixed(1)} KB · {d.confidentiality}{d.status !== 'Active' ? ` · ${d.status}` : ''}</div></td><td>{d.category}</td><td>v{d.version_no}</td><td>{d.uploaded_by_name}<div className="muted small">{fmtDateTime(d.uploaded_at)}</div></td>
          <td className="right nowrap"><button className="btn sm" onClick={() => openAuthed(`/documents/${d.id}/download`, d.filename).catch((e) => toast(e.message, 'error'))}>Download</button>{canUpload && file && d.status === 'Active' && <button className="btn sm" onClick={() => upload(d.id)}>New version</button>}</td></tr>)}</tbody></table>
      {docs.length === 0 && <Empty small icon="quotations">No documents attached yet.{canUpload ? ' Choose a file above to upload one.' : ''}</Empty>}
    </div>
  );
}

export function HistoryPanel({ entity, recordId }) {
  const [rows, setRows] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => { api.get(`/e/${entity}/${recordId}/history`).then(setRows).catch(setErr); }, [entity, recordId]);
  if (err) return <ErrorBox error={err} />; if (!rows) return <Spinner />;
  return (
    <ul className="timeline">
      {rows.map((r) => (
        <li key={r.id}>
          <b>{r.event.replace(/_/g, ' ')}</b> <span className="muted small">by {r.user_name || 'system'} · {fmtDateTime(r.ts)}</span>
          {r.detail && <div className="small">{r.detail}</div>}
          {r.changes && Object.entries(r.changes).filter(([k]) => !['modified_at', 'version', 'modified_by'].includes(k)).map(([k, [o, n]]) => <div key={k} className="small"><span className="muted">{k}:</span> {o == null ? '∅' : String(o).slice(0, 60)} → <b>{n == null ? '∅' : String(n).slice(0, 60)}</b></div>)}
        </li>
      ))}
      {rows.length === 0 && <Empty small icon="audit">No changes recorded yet.</Empty>}
    </ul>
  );
}

export function SharePanel({ entity, recordId }) {
  const [rows, setRows] = useState([]); const [revoke, setRevoke] = useState(null); const [user, setUser] = useState(null); const [ulabel, setUlabel] = useState(''); const [access, setAccess] = useState('read'); const [exp, setExp] = useState(''); const [err, setErr] = useState(null); const toast = useToast();
  const load = useCallback(() => api.get(`/e/${entity}/${recordId}/shares`).then(setRows).catch(setErr), [entity, recordId]);
  useEffect(() => { load(); }, [load]);
  const add = async () => { try { await api.post(`/e/${entity}/${recordId}/share`, { user_id: user, access, expires_at: exp || null }); setUser(null); setUlabel(''); load(); toast('Shared', 'success'); } catch (e) { setErr(e); } };
  return (
    <div className="stack">
      <ErrorBox error={err} />
      <div className="row wrap"><div style={{ width: 260 }}><FieldInput field={{ name: 'u', label: 'Share with user', type: 'ref', ref: 'users' }} value={user} labelValue={ulabel} onChange={(n, v, l) => { setUser(v); setUlabel(l); }} /></div>
        <label className="f">Access<select value={access} onChange={(e) => setAccess(e.target.value)}><option value="read">Read</option><option value="write">Read-write</option></select></label>
        <label className="f">Expires<input type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></label>
        <button className="btn primary" style={{ marginTop: 18 }} disabled={!user} onClick={add}>Share</button></div>
      <table className="t"><thead><tr><th>Shared with</th><th>Access</th><th>Expires</th><th /></tr></thead>
        <tbody>{rows.map((s) => <tr key={s.id}><td>{s.user_name || s.team_name || `Partner #${s.partner_id}`}</td><td>{s.access}</td><td>{fmtDate(s.expires_at)}</td><td className="right"><button className="btn sm danger" onClick={() => setRevoke(s)}>Revoke</button></td></tr>)}</tbody></table>
      {rows.length === 0 && <Empty small icon="users">Not shared with anyone. Only people with access through their role can see it.</Empty>}
      {revoke && <Confirm danger title="Revoke access?" message={`${revoke.user_name || revoke.team_name || 'This partner'} will lose ${revoke.access} access to this record.`} undo="You can share it again later." yesLabel="Revoke access" onNo={() => setRevoke(null)} onYes={async () => { try { await api.del(`/e/${entity}/${recordId}/shares/${revoke.id}`); toast('Access revoked', 'success'); load(); } catch (e) { toast(e.message, 'error'); } setRevoke(null); }} />}
    </div>
  );
}

// -------------------------------------------------------------------- import
function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some((x) => x !== '')) rows.push(row); }
  return rows;
}
export function ImportModal({ entity, meta, onClose }) {
  const [rows, setRows] = useState(null); const [name, setName] = useState(''); const [res, setRes] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const onFile = async (f) => { if (!f) return; setName(f.name); const t = (await f.text()).replace(/^﻿/, ''); const p = parseCsv(t); const head = p[0] || []; setRows(p.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i]])))); setRes(null); };
  const run = async (mode) => { setBusy(true); setErr(null); try { setRes(await api.post(`/e/${entity}/import`, { rows, mode, filename: name })); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const tpl = meta.fields.filter((f) => !f.readonly && !f.hide && !f.virtual).map((f) => f.label).join(',');
  return (
    <Modal title={`Import ${meta.plural.toLowerCase()}`} size="wide" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn" disabled={!rows || busy} onClick={() => run('Validate only')}>Validate</button><button className="btn primary" disabled={!rows || busy || (res && res.valid === 0)} onClick={() => run('Commit')}>Import valid rows</button></>}>
      <div className="stack">
        <Alert kind="info">Upload a CSV whose headers match field labels (e.g. <span className="mono small">{tpl.slice(0, 120)}…</span>). Duplicates are rejected; invalid rows are reported and skipped. Validate first, then import.</Alert>
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => onFile(e.target.files[0])} />
        {rows && <div className="muted">{rows.length} row(s) read from {name}</div>}
        <ErrorBox error={err} />
        {res && <Alert kind={res.failed ? 'warn' : 'good'}><b>{res.valid} valid, {res.failed} failed{res.committed ? `, ${res.committed} imported` : ''}.</b>{res.errors.length > 0 && <ul>{res.errors.slice(0, 15).map((e) => <li key={e.row}>Row {e.row}: {e.errors.join('; ')}</li>)}</ul>}</Alert>}
      </div>
    </Modal>
  );
}
