'use strict';
// Generic, metadata-driven REST layer for every registered entity.
const express = require('express');
const db = require('../db');
const { entities } = require('../entities');
const A = require('./access');
const { audit, diff } = require('./audit');
const { nextNumber } = require('./numbering');
const { bad, forbidden, notFound, conflict, wrap } = require('./errors');
const settings = require('./settings');
const hooks = require('./hooks');

const MOD_SENSITIVE = new Set(['M13', 'M14', 'M17', 'M35', 'M26']);

// --------------------------------------------------------------------- helpers
function getEntity(req) {
  const e = entities[req.params.key];
  if (!e) throw notFound(`Unknown entity '${req.params.key}'`);
  return e;
}
async function assertCan(ctx, e, action) {
  if (e.sec && !A.fieldAccess(ctx, e.sec).view) throw forbidden();
  if (!A.can(ctx, e.module, action)) {
    if (MOD_SENSITIVE.has(e.module)) await audit(ctx, { event: 'denied', entity: e.key, detail: `action ${action} denied` });
    throw forbidden();
  }
}

function coerce(f, v) {
  if (v === '' || v === undefined) return null;
  if (v === null) return null;
  switch (f.type) {
    case 'int': case 'ref': {
      const n = Number(v);
      if (!Number.isFinite(n)) throw bad(`${f.label} must be a number`);
      return Math.trunc(n);
    }
    case 'decimal': case 'money': case 'pct': {
      const n = Number(v);
      if (!Number.isFinite(n)) throw bad(`${f.label} must be a number`);
      return n;
    }
    case 'bool': return v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
    case 'json': return typeof v === 'string' ? JSON.parse(v) : v;
    case 'date': {
      const s = String(v).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) throw bad(`${f.label} must be a valid date (YYYY-MM-DD)`);
      return s;
    }
    case 'datetime': {
      const d = new Date(v);
      if (isNaN(d)) throw bad(`${f.label} must be a valid date/time`);
      return d.toISOString();
    }
    case 'email': {
      const s = String(v).trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw bad(`${f.label} must be a valid email address`);
      return s.toLowerCase();
    }
    case 'select': {
      const s = String(v);
      if (Array.isArray(f.options) && s !== '' && !f.options.includes(s)) throw bad(`${f.label}: '${s}' is not an allowed value`);
      return s;
    }
    default: return String(v).trim();
  }
}

/** Validates and coerces `input` against the writable fields; returns the values to persist. */
function buildValues(e, input, ctx, existing) {
  const values = {};
  const errors = [];
  const writable = A.writableFields(e.key, ctx, existing);
  for (const f of writable) {
    if (!(f.name in input) && !(f.virtual && f.name in input)) continue;
    try { values[f.name] = coerce(f, input[f.name]); } catch (err) { errors.push({ field: f.name, message: err.message }); }
  }
  return { values, errors };
}

function checkRequired(e, merged, errors, ctx) {
  for (const f of e.fields) {
    if (!f.req || f.virtual || f.readonly && !f.std) continue;
    if (f.sys || f.name === 'number') continue;
    if (f.sec && !A.fieldAccess(ctx, f.sec).edit) continue;
    const v = merged[f.name];
    if (v === null || v === undefined || v === '') errors.push({ field: f.name, message: `${f.label} is required` });
  }
}

async function resolveRefs(e, rows) {
  if (!rows.length) return rows;
  const need = {};
  for (const f of e.fields) if (f.type === 'ref') need[f.name] = f.ref;
  for (const [col, ref] of Object.entries(need)) {
    const ids = [...new Set(rows.map((r) => r[col]).filter((x) => x != null))];
    if (!ids.length) continue;
    const re = entities[ref];
    const tf = re.title === 'id' ? 'id::text' : re.title;
    const { rows: lr } = await db.query(`SELECT id, ${tf} AS label${re.prefix ? ', number' : ''} FROM ${re.table} WHERE id = ANY($1::bigint[])`, [ids]);
    const m = Object.fromEntries(lr.map((x) => [x.id, x.label == null ? (x.number || `#${x.id}`) : String(x.label)]));
    for (const r of rows) if (r[col] != null) r[`${col}__label`] = m[r[col]] || `#${r[col]}`;
  }
  return rows;
}

function picklistOptions(e, f, PL) { return Array.isArray(f.options) ? f.options : (PL[f.options] || []); }

// -------------------------------------------------------------------- queries
async function listQuery(e, ctx, q, { forExport = false } = {}) {
  const params = [];
  const where = [e.plain ? 'true' : 't.is_deleted = false'];
  const sc = await A.scopeClause(e.key, ctx, params, forExport ? 'X' : 'V', 't');
  if (sc) where.push(sc);
  if (q.q) {
    const sf = e.fields.filter((f) => f.search && !f.virtual);
    if (sf.length) { params.push(`%${String(q.q).trim()}%`); where.push('(' + sf.map((f) => `t.${f.name}::text ILIKE $${params.length}`).join(' OR ') + ')'); }
  }
  for (const [k, v] of Object.entries(q)) {
    if (!k.startsWith('f_') || v === '' || v == null) continue;
    let name = k.slice(2); let op = '=';
    const m = name.match(/^(.*)_(gte|lte|ne|like|null)$/);
    if (m && !e.fieldMap[name]) { name = m[1]; op = { gte: '>=', lte: '<=', ne: '<>', like: 'ILIKE', null: 'NULL' }[m[2]]; }
    const f = e.fieldMap[name] || (['id', 'created_at', 'modified_at'].includes(name) ? { type: 'int' } : null);
    if (!f) continue;
    if (op === 'NULL') { where.push(`t.${name} IS ${v === '1' || v === 'true' ? '' : 'NOT '}NULL`); continue; }
    if (String(v).includes(',') && op === '=') { params.push(String(v).split(',')); where.push(`t.${name}::text = ANY($${params.length}::text[])`); continue; }
    params.push(op === 'ILIKE' ? `%${v}%` : v);
    if (op === 'ILIKE') where.push(`t.${name}::text ILIKE $${params.length}`);
    else if (op === '=') where.push(`t.${name}::text = $${params.length}`);
    else where.push(`t.${name} ${op} $${params.length}`);
  }
  if (q.mine === '1' && e.hasOwner) { params.push(ctx.id); where.push(`t.owner_id = $${params.length}`); }
  const sortOk = q.sort && (e.fieldMap[q.sort] || ['id', 'created_at', 'modified_at'].includes(q.sort));
  const sort = sortOk ? q.sort : (e.order || (e.plain ? 'id' : 'created_at'));
  const dir = String(q.dir || (sortOk ? 'asc' : 'desc')).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const size = forExport ? 50000 : Math.min(Math.max(parseInt(q.size || '25', 10) || 25, 1), 200);
  const page = Math.max(parseInt(q.page || '1', 10) || 1, 1);
  const whereSql = where.join(' AND ');
  const total = (await db.query(`SELECT count(*)::int n FROM ${e.table} t WHERE ${whereSql}`, params)).rows[0].n;
  const { rows } = await db.query(
    `SELECT t.* FROM ${e.table} t WHERE ${whereSql} ORDER BY t.${sort} ${dir}, t.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
  return { rows, total, page, size };
}

async function loadOne(e, id, ctx, action = 'V') {
  const params = [id];
  const where = ['t.id = $1'];
  if (!e.plain) where.push('t.is_deleted = false');
  const sc = await A.scopeClause(e.key, ctx, params, action, 't');
  if (sc) where.push(sc);
  const { rows } = await db.query(`SELECT t.* FROM ${e.table} t WHERE ${where.join(' AND ')}`, params);
  return rows[0] || null;
}

function lockInfo(e, row) {
  if (e.lockedWhen && e.lockedWhen(row)) return { locked: true, message: e.lockedMsg || 'Record is locked' };
  if (e.lockedFields && e.lockedFields.when(row)) return { locked: 'partial', fields: e.lockedFields.fields, message: e.lockedFields.msg };
  return { locked: false };
}

// ------------------------------------------------------------------ duplicates
async function findDuplicates(e, values, excludeId, ctx) {
  if (!e.dup) return [];
  const checks = [];
  const mk = (fields) => {
    if (!fields.every((f) => values[f] != null && values[f] !== '')) return null;
    return fields;
  };
  const primary = mk(e.dup.fields);
  const alt = e.dup.alt ? mk(e.dup.alt) : null;
  const out = new Map();
  for (const [fields, kind] of [[primary, 'match'], [alt, 'similar']]) {
    if (!fields) continue;
    const params = []; const where = [e.plain ? 'true' : 'is_deleted=false'];
    for (const f of fields) {
      const col = e.fieldMap[f];
      params.push(col.type === 'text' || col.type === 'email' ? String(values[f]).toLowerCase() : values[f]);
      where.push(col.type === 'text' || col.type === 'email' ? `lower(${f}) = $${params.length}` : `${f} = $${params.length}`);
    }
    if (excludeId) { params.push(excludeId); where.push(`id <> $${params.length}`); }
    const tf = e.title === 'id' ? 'id::text' : e.title;
    const { rows } = await db.query(`SELECT id, ${tf} AS label${e.prefix ? ', number' : ''} FROM ${e.table} WHERE ${where.join(' AND ')} LIMIT 5`, params);
    rows.forEach((r) => out.set(r.id, { id: r.id, label: r.label, number: r.number, kind }));
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------- router
const router = express.Router();

// Metadata for the UI (field definitions, options resolved from picklists)
async function entityMeta(e, ctx) {
  const PL = await picklists();
  return {
    key: e.key, label: e.label, plural: e.plural, module: e.module, title: e.title, hasOwner: !!e.owned, statusField: e.statusField || null,
    system: !!e.system, children: (e.children || []).filter((c) => entities[c.entity] && A.can(ctx, entities[c.entity].module, 'V')),
    actions: Object.entries(e.actions || {}).map(([k, a]) => ({ key: k, label: a.label, confirm: a.confirm, prompt: a.prompt, perm: a.perm })),
    perms: Object.fromEntries(['V', 'C', 'E', 'D', 'X', 'I', 'G', 'H', 'S', 'A', 'F'].map((a) => [a, A.can(ctx, e.module, a)])),
    fields: e.fields.filter((f) => !f.sec || A.fieldAccess(ctx, f.sec).view).filter((f) => !(f.secret)).map((f) => ({
      name: f.name, label: f.label, type: f.type, req: !!f.req, list: !!f.list, search: !!f.search, readonly: !!(f.readonly || f.sys || (f.sec && !A.fieldAccess(ctx, f.sec).edit)),
      ref: f.ref, help: f.help, section: f.section, hide: !!f.hide, virtual: !!f.virtual, def: f.def, pwd: !!f.pwd,
      options: f.type === 'select' ? picklistOptions(e, f, PL) : undefined, sensitive: f.sec || undefined,
    })),
  };
}
let plCache = { at: 0, v: {} };
async function picklists() {
  if (Date.now() - plCache.at < 10000) return plCache.v;
  const { rows } = await db.query('SELECT list, value, label FROM picklists WHERE active ORDER BY list, sort_order, label');
  const v = {};
  for (const r of rows) (v[r.list] ||= []).push(r.value);
  v._labels = Object.fromEntries(rows.map((r) => [`${r.list}:${r.value}`, r.label]));
  plCache = { at: Date.now(), v };
  return v;
}
const clearPicklists = () => { plCache.at = 0; };

router.get('/:key/meta', wrap(async (req, res) => {
  const e = getEntity(req);
  if (!A.can(req.ctx, e.module, 'V') && !A.can(req.ctx, e.module, 'C')) throw forbidden();
  const m = await entityMeta(e, req.ctx);
  const PL = await picklists();
  m.labels = PL._labels;
  res.json(m);
}));

router.get('/:key', wrap(async (req, res) => {
  const e = getEntity(req);
  await assertCan(req.ctx, e, 'V');
  const { rows, total, page, size } = await listQuery(e, req.ctx, req.query);
  const masked = rows.map((r) => A.maskRecord(e.key, r, req.ctx)).filter(Boolean);
  await resolveRefs(e, masked);
  if (hooks.get(e.key).decorateList) await hooks.get(e.key).decorateList(masked, req.ctx);
  res.json({ rows: masked, total, page, size });
}));

router.get('/:key/export.csv', wrap(async (req, res) => {
  const e = getEntity(req);
  await assertCan(req.ctx, e, 'X');
  const { rows } = await listQuery(e, req.ctx, req.query, { forExport: true });
  const masked = rows.map((r) => A.maskRecord(e.key, r, req.ctx)).filter(Boolean);
  await resolveRefs(e, masked);
  const fields = e.fields.filter((f) => !f.virtual && !f.hide && (!f.sec || A.fieldAccess(req.ctx, f.sec).view));
  const esc = (v) => { if (v == null) return ''; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [fields.map((f) => esc(f.label)).join(',')];
  for (const r of masked) lines.push(fields.map((f) => esc(f.type === 'ref' ? (r[`${f.name}__label`] ?? r[f.name]) : r[f.name])).join(','));
  await audit(req.ctx, { event: 'export', entity: e.key, detail: `${masked.length} rows exported` });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${e.key}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
}));

router.get('/:key/:id', wrap(async (req, res) => {
  const e = getEntity(req);
  await assertCan(req.ctx, e, 'V');
  const row = await loadOne(e, req.params.id, req.ctx);
  if (!row) throw notFound();
  let out = A.maskRecord(e.key, row, req.ctx);
  if (!out) throw forbidden();
  await resolveRefs(e, [out]);
  const h = hooks.get(e.key);
  if (h.decorateOne) out = (await h.decorateOne(out, req.ctx)) || out;
  const canEditRow = A.can(req.ctx, e.module, 'E') && !!(await loadOne(e, req.params.id, req.ctx, 'E'));
  out._lock = lockInfo(e, row);
  out._can = { edit: canEditRow && out._lock.locked !== true, delete: A.can(req.ctx, e.module, 'D') && !!(await loadOne(e, req.params.id, req.ctx, 'D')) };
  if (e.children) {
    out._counts = {};
    for (const c of e.children) {
      const ce = entities[c.entity];
      if (!ce || !A.can(req.ctx, ce.module, 'V')) continue;
      out._counts[c.entity] = (await db.query(`SELECT count(*)::int n FROM ${ce.table} WHERE ${c.fk} = $1${ce.plain ? '' : ' AND is_deleted=false'}`, [row.id])).rows[0].n;
    }
  }
  res.json(out);
}));

router.get('/:key/:id/history', wrap(async (req, res) => {
  const e = getEntity(req);
  await assertCan(req.ctx, e, 'V');
  const row = await loadOne(e, req.params.id, req.ctx);
  if (!row) throw notFound();
  const { rows } = await db.query(
    `SELECT a.id, a.ts, a.user_name, a.event, a.changes, a.detail FROM audit_log a WHERE a.entity=$1 AND a.record_id=$2 ORDER BY a.ts DESC LIMIT 200`, [e.key, row.id]);
  // hide sensitive field values from users without field access
  const sens = e.fields.filter((f) => f.sec && !A.fieldAccess(req.ctx, f.sec).view).map((f) => f.name);
  for (const r of rows) if (r.changes) for (const s of sens) delete r.changes[s];
  res.json(rows);
}));

// -------------------------------------------------------------------- create
router.post('/:key', wrap(async (req, res) => {
  const e = getEntity(req);
  if (e.system && !e.allowGenericCreate) throw forbidden('This record type is created by the system');
  await assertCan(req.ctx, e, 'C');
  const h = hooks.get(e.key);
  const { values, errors } = buildValues(e, req.body || {}, req.ctx, null);
  for (const f of e.fields) if (f.def !== undefined && values[f.name] === undefined && !f.virtual) values[f.name] = f.def;
  if (e.hasOwner) {
    let owner = req.body.owner_id ? Number(req.body.owner_id) : req.ctx.id;
    if (owner !== req.ctx.id && !A.can(req.ctx, e.module, 'G') && !req.ctx.isAdmin) owner = req.ctx.id;
    values.owner_id = owner;
  }
  if (h.beforeValidate) await h.beforeValidate(req.ctx, values, null, req.body);
  checkRequired(e, values, errors, req.ctx);
  if (errors.length) throw bad('Validation failed', { errors });
  if (h.validate) { const extra = await h.validate(req.ctx, values, null); if (extra && extra.length) throw bad('Validation failed', { errors: extra }); }
  const dups = await findDuplicates(e, values, null, req.ctx);
  if (dups.length && !req.body.override_reason) {
    throw conflict(e.dup.label || 'Possible duplicates found', { code: 'DUPLICATE', matches: dups });
  }
  const rec = await db.tx(async (c) => {
    if (h.beforeCreate) await h.beforeCreate(req.ctx, values, c);
    if (e.prefix) values.number = await nextNumber(typeof e.prefix === 'function' ? e.prefix(values) : e.prefix, c);
    values.created_by = req.ctx.id; values.modified_by = req.ctx.id;
    if (!e.plain) values.data_source = values.data_source || 'UI';
    const cols = Object.keys(values).filter((k) => !(e.fieldMap[k] && e.fieldMap[k].virtual) && (e.fieldMap[k] || ['number', 'created_by', 'modified_by', 'data_source', 'owner_id'].includes(k)));
    const finalCols = e.plain ? cols.filter((k) => !['created_by', 'modified_by', 'data_source'].includes(k)) : cols;
    const vals = finalCols.map((k) => (e.fieldMap[k] && e.fieldMap[k].type === 'json' && values[k] != null ? JSON.stringify(values[k]) : values[k]));
    const { rows } = await c.query(
      `INSERT INTO ${e.table} (${finalCols.join(',')}) VALUES (${finalCols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals);
    const created = rows[0];
    if (h.afterCreate) await h.afterCreate(req.ctx, created, c, req.body);
    await audit(req.ctx, { event: 'create', entity: e.key, recordId: created.id, label: created[e.title] || created.number, changes: diff(null, created, e.cols.filter((x) => !e.fieldMap[x].virtual)),
      detail: req.body.override_reason ? `duplicate override: ${req.body.override_reason}` : undefined }, c);
    return created;
  });
  const out = A.maskRecord(e.key, rec, req.ctx);
  await resolveRefs(e, [out]);
  res.status(201).json(out);
}));

// -------------------------------------------------------------------- update
router.put('/:key/:id', wrap(async (req, res) => {
  const e = getEntity(req);
  if (e.system && !e.allowGenericUpdate) throw forbidden('This record type is maintained by the system');
  await assertCan(req.ctx, e, 'E');
  const existing = await loadOne(e, req.params.id, req.ctx, 'E');
  if (!existing) throw notFound();
  const h = hooks.get(e.key);
  const lk = lockInfo(e, existing);
  if (lk.locked === true) throw forbidden(lk.message);
  if (req.body.version != null && Number(req.body.version) !== existing.version) throw conflict('This record was changed by another user. Reload and try again.', { code: 'STALE' });
  let { values, errors } = buildValues(e, req.body || {}, req.ctx, existing);
  if (lk.locked === 'partial') {
    const touched = lk.fields.filter((f) => f in values && String(values[f] ?? '') !== String(existing[f] ?? ''));
    if (touched.length) throw forbidden(`${lk.message} (${touched.join(', ')})`);
  }
  if (e.hasOwner && 'owner_id' in (req.body || {}) && Number(req.body.owner_id) !== existing.owner_id) {
    if (!A.can(req.ctx, e.module, 'G') && !req.ctx.isAdmin) throw forbidden('You cannot reassign ownership');
    values.owner_id = Number(req.body.owner_id);
  }
  const merged = { ...existing, ...values };
  if (h.beforeValidate) await h.beforeValidate(req.ctx, values, existing, req.body);
  checkRequired(e, { ...existing, ...values }, errors, req.ctx);
  if (errors.length) throw bad('Validation failed', { errors });
  if (h.validate) { const extra = await h.validate(req.ctx, { ...merged, ...values }, existing); if (extra && extra.length) throw bad('Validation failed', { errors: extra }); }
  const cols = Object.keys(values).filter((k) => e.fieldMap[k] && !e.fieldMap[k].virtual);
  const rec = await db.tx(async (c) => {
    if (h.beforeUpdate) await h.beforeUpdate(req.ctx, values, existing, c);
    const upd = Object.keys(values).filter((k) => (e.fieldMap[k] && !e.fieldMap[k].virtual) || ['owner_id'].includes(k));
    const sets = upd.map((k, i) => `${k} = $${i + 1}`);
    const vals = upd.map((k) => (e.fieldMap[k] && e.fieldMap[k].type === 'json' && values[k] != null ? JSON.stringify(values[k]) : values[k]));
    if (!e.plain) { sets.push(`modified_by = $${vals.length + 1}`, 'modified_at = now()', 'version = version + 1'); vals.push(req.ctx.id); }
    if (!sets.length) return existing;
    vals.push(existing.id);
    const { rows } = await c.query(`UPDATE ${e.table} SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    const updated = rows[0];
    const changes = diff(existing, updated, e.cols.filter((x) => !e.fieldMap[x].virtual));
    if (Object.keys(changes).length) {
      await audit(req.ctx, { event: 'update', entity: e.key, recordId: updated.id, label: updated[e.title] || updated.number, changes }, c);
      for (const [f, [o, n]] of Object.entries(changes)) {
        if (e.fieldMap[f] && e.fieldMap[f].type !== 'json' && e.fieldMap[f].type !== 'longtext')
          await c.query('INSERT INTO field_history (entity, record_id, field, old_value, new_value, changed_by) VALUES ($1,$2,$3,$4,$5,$6)', [e.key, updated.id, f, o == null ? null : String(o), n == null ? null : String(n), req.ctx.id]);
      }
    }
    if (h.afterUpdate) await h.afterUpdate(req.ctx, updated, existing, c, changes);
    return updated;
  });
  const out = A.maskRecord(e.key, rec, req.ctx);
  await resolveRefs(e, [out]);
  res.json(out);
}));

// -------------------------------------------------------------------- delete
router.delete('/:key/:id', wrap(async (req, res) => {
  const e = getEntity(req);
  if (e.system && !e.allowGenericDelete) throw forbidden('This record type cannot be deleted');
  await assertCan(req.ctx, e, 'D');
  const existing = await loadOne(e, req.params.id, req.ctx, 'D');
  if (!existing) throw notFound();
  const lk = lockInfo(e, existing);
  if (lk.locked === true) throw forbidden(lk.message);
  const h = hooks.get(e.key);
  await db.tx(async (c) => {
    if (h.beforeDelete) await h.beforeDelete(req.ctx, existing, c);
    if (e.plain) await c.query(`DELETE FROM ${e.table} WHERE id=$1`, [existing.id]);
    else await c.query(`UPDATE ${e.table} SET is_deleted=true, deleted_by=$2, deleted_at=now(), modified_at=now() WHERE id=$1`, [existing.id, req.ctx.id]);
    await audit(req.ctx, { event: 'delete', entity: e.key, recordId: existing.id, label: existing[e.title] || existing.number, detail: req.body && req.body.reason }, c);
    if (h.afterDelete) await h.afterDelete(req.ctx, existing, c);
  });
  res.json({ ok: true });
}));

// ------------------------------------------------------------ assign & share
router.post('/:key/:id/assign', wrap(async (req, res) => {
  const e = getEntity(req);
  if (!e.hasOwner) throw bad('Entity has no owner');
  await assertCan(req.ctx, e, 'G');
  const existing = await loadOne(e, req.params.id, req.ctx, 'G');
  if (!existing) throw notFound();
  const newOwner = Number(req.body.owner_id);
  if (!req.body.reason) throw bad('A reason is required for reassignment');
  const { rows: u } = await db.query(`SELECT id, name, status FROM users WHERE id=$1 AND is_deleted=false`, [newOwner]);
  if (!u[0] || u[0].status !== 'Active') throw bad('New owner must be an active user (BRULE-OPP-001)');
  await db.tx(async (c) => {
    await c.query(`UPDATE ${e.table} SET owner_id=$1, modified_by=$2, modified_at=now(), version=version+1 WHERE id=$3`, [newOwner, req.ctx.id, existing.id]);
    await audit(req.ctx, { event: 'reassign', entity: e.key, recordId: existing.id, label: existing[e.title] || existing.number, changes: { owner_id: [existing.owner_id, newOwner] }, detail: req.body.reason }, c);
    if (req.body.transfer_children && e.key === 'accounts') {
      await c.query(`UPDATE opportunities SET owner_id=$1 WHERE account_id=$2 AND status='Open' AND is_deleted=false`, [newOwner, existing.id]);
      await c.query(`UPDATE contacts SET owner_id=$1 WHERE account_id=$2 AND is_deleted=false`, [newOwner, existing.id]);
    }
    const { notify } = require('./notify');
    await notify(newOwner, { type: 'assignment', title: `${e.label} assigned to you`, body: existing[e.title] || existing.number, entity: e.key, recordId: existing.id }, c);
  });
  res.json({ ok: true });
}));

router.post('/:key/:id/share', wrap(async (req, res) => {
  const e = getEntity(req);
  await assertCan(req.ctx, e, 'H');
  const existing = await loadOne(e, req.params.id, req.ctx, 'H');
  if (!existing) throw notFound();
  const { user_id, team_id, partner_id, access = 'read', expires_at } = req.body;
  if (!user_id && !team_id && !partner_id) throw bad('Select a user, team or partner');
  await db.query('INSERT INTO record_shares (entity, record_id, user_id, team_id, partner_id, access, expires_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [e.key, existing.id, user_id || null, team_id || null, partner_id || null, access, expires_at || null, req.ctx.id]);
  await audit(req.ctx, { event: 'share', entity: e.key, recordId: existing.id, label: existing[e.title] || existing.number, detail: JSON.stringify({ user_id, team_id, partner_id, access, expires_at }) });
  res.json({ ok: true });
}));
router.get('/:key/:id/shares', wrap(async (req, res) => {
  const e = getEntity(req);
  await assertCan(req.ctx, e, 'V');
  const { rows } = await db.query(`SELECT s.*, u.name user_name, t.name team_name FROM record_shares s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN teams t ON t.id=s.team_id WHERE s.entity=$1 AND s.record_id=$2 ORDER BY s.id DESC`, [e.key, req.params.id]);
  res.json(rows);
}));
router.delete('/:key/:id/shares/:sid', wrap(async (req, res) => {
  const e = getEntity(req);
  await assertCan(req.ctx, e, 'H');
  await db.query('DELETE FROM record_shares WHERE id=$1 AND entity=$2', [req.params.sid, e.key]);
  await audit(req.ctx, { event: 'unshare', entity: e.key, recordId: Number(req.params.id) });
  res.json({ ok: true });
}));

// -------------------------------------------------------------- custom actions
router.post('/:key/:id/actions/:action', wrap(async (req, res) => {
  const e = getEntity(req);
  const act = (e.actions || {})[req.params.action];
  if (!act) throw notFound('Unknown action');
  await assertCan(req.ctx, e, act.perm || 'E');
  const row = await loadOne(e, req.params.id, req.ctx, act.perm || 'E');
  if (!row) throw notFound();
  const result = await act.run(req.ctx, row, req.body || {}, req);
  res.json(result === undefined ? { ok: true } : result);
}));

// ------------------------------------------------------------------- import
router.post('/:key/import', wrap(async (req, res) => {
  const e = getEntity(req);
  await assertCan(req.ctx, e, 'I');
  if (e.system) throw forbidden();
  const { rows = [], mode = 'Validate only', filename } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) throw bad('No rows supplied');
  if (rows.length > 5000) throw bad('Maximum 5000 rows per import');
  const labelToName = Object.fromEntries(e.fields.map((f) => [f.label.toLowerCase(), f.name]));
  const report = []; let ok = 0; const h = hooks.get(e.key);
  const toCommit = [];
  for (let i = 0; i < rows.length; i++) {
    const raw = {};
    for (const [k, v] of Object.entries(rows[i])) { const name = e.fieldMap[k] ? k : labelToName[String(k).toLowerCase()]; if (name) raw[name] = v; }
    try {
      const { values, errors } = buildValues(e, raw, req.ctx, null);
      for (const f of e.fields) if (f.def !== undefined && values[f.name] === undefined && !f.virtual) values[f.name] = f.def;
      if (e.hasOwner) values.owner_id = values.owner_id || req.ctx.id;
      if (h.beforeValidate) await h.beforeValidate(req.ctx, values, null, raw);
      checkRequired(e, values, errors, req.ctx);
      if (h.validate) errors.push(...((await h.validate(req.ctx, values, null)) || []));
      const dups = await findDuplicates(e, values, null, req.ctx);
      if (dups.length) errors.push({ field: '*', message: `Possible duplicate of ${dups[0].number || dups[0].label}` });
      if (errors.length) report.push({ row: i + 2, errors: errors.map((x) => `${x.field}: ${x.message}`) });
      else { ok++; toCommit.push(values); }
    } catch (err) { report.push({ row: i + 2, errors: [err.message] }); }
  }
  let committed = 0;
  if (mode === 'Commit' && toCommit.length) {
    await db.tx(async (c) => {
      for (const values of toCommit) {
        if (h.beforeCreate) await h.beforeCreate(req.ctx, values, c);
        if (e.prefix) values.number = await nextNumber(typeof e.prefix === 'function' ? e.prefix(values) : e.prefix, c);
        values.created_by = req.ctx.id; values.modified_by = req.ctx.id; values.data_source = 'import';
        const cols = Object.keys(values).filter((k) => (e.fieldMap[k] && !e.fieldMap[k].virtual) || ['number', 'created_by', 'modified_by', 'data_source'].includes(k));
        const vals = cols.map((k) => (e.fieldMap[k] && e.fieldMap[k].type === 'json' && values[k] != null ? JSON.stringify(values[k]) : values[k]));
        const { rows: r } = await c.query(`INSERT INTO ${e.table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals);
        if (h.afterCreate) await h.afterCreate(req.ctx, r[0], c, {});
        committed++;
      }
      await audit(req.ctx, { event: 'import', entity: e.key, detail: `${committed} records imported from ${filename || 'file'}`, source: 'import' }, c);
    });
  }
  const num = await nextNumber('IMP');
  await db.query(`INSERT INTO import_jobs (number, owner_id, entity, filename, mode, rows_total, rows_ok, rows_failed, status, errors, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$2)`,
    [num, req.ctx.id, e.key, filename || null, mode, rows.length, ok, report.length, mode === 'Commit' ? 'Completed' : 'Validated', JSON.stringify(report.slice(0, 200))]);
  res.json({ total: rows.length, valid: ok, failed: report.length, committed, errors: report.slice(0, 200), job: num });
}));

module.exports = { router, entityMeta, resolveRefs, listQuery, loadOne, picklists, clearPicklists, buildValues, getEntity };
