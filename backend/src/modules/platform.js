'use strict';
// Platform services: lookups, global search, notifications, documents (M20), audit viewer (M26),
// user & application settings (M32), integrations monitor (M25).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const db = require('../db');
const A = require('../core/access');
const crud = require('../core/crud');
const hooks = require('../core/hooks');
const settings = require('../core/settings');
const { audit } = require('../core/audit');
const { notify, notifyRole } = require('../core/notify');
const { nextNumber } = require('../core/numbering');
const { bad, forbidden, notFound, wrap } = require('../core/errors');
const { entities } = require('../entities');
const approvals = require('./approvals');

const router = express.Router();
fs.mkdirSync(config.uploadDir, { recursive: true });

// ---------------------------------------------------------------------- lookup
const DIRECTORY = new Set(['users', 'teams', 'business_units', 'branches', 'org_units', 'territories', 'product_categories', 'claim_categories']);
router.get('/lookup/:entity', wrap(async (req, res) => {
  const e = entities[req.params.entity];
  if (!e) throw notFound('Unknown entity');
  const ctx = req.ctx; const q = String(req.query.q || '').trim(); const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);
  const params = []; const where = [e.plain ? 'true' : 't.is_deleted=false'];
  if (!DIRECTORY.has(e.key)) {
    if (!A.can(ctx, e.module, 'V') && !A.can(ctx, e.module, 'C')) throw forbidden();
    const sc = await A.scopeClause(e.key, ctx, params, A.can(ctx, e.module, 'V') ? 'V' : 'C', 't'); if (sc) where.push(sc);
  }
  if (e.key === 'users') { where.push(`t.status='Active'`); if (ctx.isExternal) where.push('false'); if (req.query.role) { params.push(req.query.role); where.push(`t.id IN (SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE r.code=$${params.length})`); } }
  if (e.statusField && req.query.active === '1' && e.key !== 'users') { /* active filter is advisory */ }
  const tf = e.title === 'id' ? 't.id::text' : `t.${e.title}`;
  if (q) {
    params.push(`%${q}%`);
    const extra = e.fields.filter((f) => f.search && !f.virtual && f.name !== e.title).slice(0, 3).map((f) => ` OR t.${f.name}::text ILIKE $${params.length}`).join('');
    where.push(`(${tf}::text ILIKE $${params.length}${e.prefix ? ` OR t.number ILIKE $${params.length}` : ''}${extra})`);
  }
  if (req.query.id) { params.push(req.query.id); where.push(`t.id=$${params.length}`); }
  for (const [k, v] of Object.entries(req.query)) if (k.startsWith('f_') && e.fieldMap[k.slice(2)]) { params.push(v); where.push(`t.${k.slice(2)}::text=$${params.length}`); }
  const sub = e.key === 'users' ? 't.job_title' : e.key === 'accounts' ? 't.country' : e.key === 'products' ? 't.sku' : e.prefix ? 't.number' : 'NULL';
  const { rows } = await db.query(`SELECT t.id, ${tf} AS label, ${sub} AS sub ${e.prefix ? ', t.number' : ''} FROM ${e.table} t WHERE ${where.join(' AND ')} ORDER BY ${tf} LIMIT ${limit}`, params);
  res.json(rows.map((r) => ({ id: r.id, label: r.label == null ? r.number : String(r.label), sub: r.sub, number: r.number })));
}));

router.get('/picklists/:list', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT value, label FROM picklists WHERE list=$1 AND active ORDER BY sort_order, label', [req.params.list]);
  res.json(rows);
}));
router.get('/lookups/bootstrap', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT list, value, label FROM picklists WHERE active ORDER BY list, sort_order, label');
  const out = {}; for (const r of rows) (out[r.list] ||= []).push({ value: r.value, label: r.label });
  const { rows: bu } = await db.query('SELECT id, name FROM business_units WHERE is_deleted=false ORDER BY name');
  const { rows: br } = await db.query('SELECT id, name FROM branches WHERE is_deleted=false ORDER BY name');
  res.json({ picklists: out, business_units: bu, branches: br, base_currency: await settings.get('base_currency', 'USD') });
}));

// ----------------------------------------------------------------- global search
router.get('/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim(); if (q.length < 2) return res.json([]);
  const ctx = req.ctx;
  const specs = [['accounts', 'legal_name', 'Account'], ['contacts', 'full_name', 'Contact'], ['leads', 'company', 'Lead'], ['opportunities', 'name', 'Opportunity'], ['quotations', 'number', 'Quotation'], ['partners', 'name', 'Partner'], ['products', 'name', 'Product'], ['events', 'name', 'Event']];
  const out = [];
  for (const [key, field, label] of specs) {
    const e = entities[key]; if (!A.can(ctx, e.module, 'V')) continue;
    const params = []; const sc = await A.scopeClause(key, ctx, params, 'V', 't');
    params.push(`%${q}%`);
    const { rows } = await db.query(`SELECT t.id, t.${field} AS label${e.prefix ? ', t.number' : ''} FROM ${e.table} t WHERE t.is_deleted=false ${sc ? 'AND ' + sc : ''} AND (t.${field}::text ILIKE $${params.length}${e.prefix ? ` OR t.number ILIKE $${params.length}` : ''}) ORDER BY t.${field} LIMIT 5`, params);
    for (const r of rows) out.push({ entity: key, type: label, id: r.id, label: r.label, number: r.number });
  }
  res.json(out);
}));

// ----------------------------------------------------------------- notifications
router.get('/notifications', wrap(async (req, res) => {
  const unread = req.query.unread === '1';
  const { rows } = await db.query(`SELECT * FROM notifications WHERE user_id=$1 AND status IN ('Sent','Read') ${unread ? 'AND read_at IS NULL' : ''} ORDER BY created_at DESC LIMIT 100`, [req.ctx.id]);
  const { rows: n } = await db.query(`SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND status='Sent' AND read_at IS NULL`, [req.ctx.id]);
  res.json({ rows, unread: n[0].n });
}));
router.post('/notifications/read', wrap(async (req, res) => {
  const { ids, all } = req.body || {};
  if (all) await db.query(`UPDATE notifications SET read_at=now(), status='Read' WHERE user_id=$1 AND read_at IS NULL`, [req.ctx.id]);
  else if (Array.isArray(ids)) await db.query(`UPDATE notifications SET read_at=now(), status='Read' WHERE user_id=$1 AND id=ANY($2)`, [req.ctx.id, ids]);
  res.json({ ok: true });
}));

// -------------------------------------------------------------------- documents
const ALLOWED = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.msg', '.eml']);
const upload = multer({
  storage: multer.diskStorage({ destination: config.uploadDir, filename: (req, f, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(f.originalname).toLowerCase()}`) }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, f, cb) => (ALLOWED.has(path.extname(f.originalname).toLowerCase()) ? cb(null, true) : cb(Object.assign(new Error('File type not allowed'), { status: 400 }))),
});
async function assertRecordAccess(ctx, entity, recordId, action = 'V') {
  const e = entities[entity];
  if (!e) throw bad('Unknown record type');
  const r = await crud.loadOne(e, recordId, ctx, action === 'V' ? 'V' : 'E').catch(() => null);
  if (!r) throw forbidden('You do not have access to the related record');
  return r;
}
const RESTRICTED_VIEW = ['ROL-ADM', 'ROL-CM', 'ROL-SD', 'ROL-AUD', 'ROL-FIN'];
function canSeeDoc(ctx, d) { return d.confidentiality !== 'Restricted' || d.uploaded_by === ctx.id || A.roleHas(ctx, ...RESTRICTED_VIEW); }

router.post('/documents', upload.single('file'), wrap(async (req, res) => {
  const ctx = req.ctx; const b = req.body;
  if (!A.can(ctx, 'M20', 'C')) { if (req.file) fs.unlink(req.file.path, () => {}); throw forbidden(); }
  if (!req.file) throw bad('No file uploaded');
  try { if (b.entity && b.record_id) await assertRecordAccess(ctx, b.entity, b.record_id, 'E'); } catch (e) { fs.unlink(req.file.path, () => {}); throw e; }
  const sha = crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex');
  let version = 1; let parent = null;
  if (b.parent_document_id) {
    const { rows } = await db.query('SELECT id, version_no FROM documents WHERE id=$1', [b.parent_document_id]);
    if (rows[0]) { version = rows[0].version_no + 1; parent = rows[0].id; await db.query(`UPDATE documents SET status='Archived' WHERE id=$1`, [parent]); }
  }
  const { rows } = await db.query(`INSERT INTO documents (filename, title, mime, size, sha256, storage_path, category, confidentiality, version_no, parent_document_id, entity, record_id, expiry_date, portal_share, uploaded_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [req.file.originalname, b.title || req.file.originalname, req.file.mimetype, req.file.size, sha, path.basename(req.file.path), b.category || 'General', b.confidentiality || 'Internal', version, parent, b.entity || null, b.record_id || null, b.expiry_date || null, b.portal_share === 'true', ctx.id]);
  await audit(ctx, { event: 'document_upload', entity: b.entity || 'documents', recordId: b.record_id ? Number(b.record_id) : rows[0].id, label: req.file.originalname, detail: `v${version} ${req.file.size} bytes` });
  res.status(201).json(rows[0]);
}));
router.get('/documents', wrap(async (req, res) => {
  const ctx = req.ctx; const { entity, record_id } = req.query;
  if (!A.can(ctx, 'M20', 'V')) throw forbidden();
  let rows;
  if (entity && record_id) {
    await assertRecordAccess(ctx, entity, record_id);
    rows = (await db.query(`SELECT d.*, u.name uploaded_by_name FROM documents d JOIN users u ON u.id=d.uploaded_by WHERE d.entity=$1 AND d.record_id=$2 AND d.is_deleted=false AND d.status<>'Deleted' ORDER BY d.uploaded_at DESC`, [entity, record_id])).rows;
  } else rows = (await db.query(`SELECT d.*, u.name uploaded_by_name FROM documents d JOIN users u ON u.id=d.uploaded_by WHERE d.is_deleted=false AND d.uploaded_by=$1 ORDER BY d.uploaded_at DESC LIMIT 100`, [ctx.id])).rows;
  res.json(rows.filter((d) => canSeeDoc(ctx, d)).map((d) => { delete d.storage_path; return d; }));
}));
router.get('/documents/:id/download', wrap(async (req, res) => {
  const ctx = req.ctx;
  const { rows } = await db.query('SELECT * FROM documents WHERE id=$1 AND is_deleted=false', [req.params.id]);
  const d = rows[0]; if (!d) throw notFound();
  if (!A.can(ctx, 'M20', 'F') && d.uploaded_by !== ctx.id) throw forbidden('You do not have permission to download files');
  if (d.entity && d.record_id) await assertRecordAccess(ctx, d.entity, d.record_id);
  if (!canSeeDoc(ctx, d)) throw forbidden('Restricted document');
  if (ctx.isExternal && !d.portal_share) throw forbidden();
  await audit(ctx, { event: 'document_download', entity: d.entity || 'documents', recordId: d.record_id || d.id, label: d.filename });
  res.download(path.join(config.uploadDir, d.storage_path), d.filename);
}));
router.delete('/documents/:id', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM documents WHERE id=$1 AND is_deleted=false', [req.params.id]);
  const d = rows[0]; if (!d) throw notFound();
  if (d.uploaded_by !== req.ctx.id && !A.can(req.ctx, 'M20', 'D')) throw forbidden();
  await db.query(`UPDATE documents SET is_deleted=true, status='Deleted', deleted_by=$2, deleted_at=now() WHERE id=$1`, [d.id, req.ctx.id]);   // file retained per retention policy
  await audit(req.ctx, { event: 'document_delete', entity: d.entity || 'documents', recordId: d.record_id || d.id, label: d.filename });
  res.json({ ok: true });
}));

// -------------------------------------------------------------------- audit (M26)
router.get('/audit', wrap(async (req, res) => {
  const ctx = req.ctx;
  if (!A.can(ctx, 'M26', 'V') && !ctx.isAdmin) throw forbidden();
  const { entity, record_id, user_id, event, from, to, q } = req.query; const params = []; const where = ['true'];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (entity) add('a.entity = ?', entity); if (record_id) add('a.record_id = ?', record_id); if (user_id) add('a.user_id = ?', user_id);
  if (event) add('a.event = ?', event); if (from) add('a.ts >= ?', from); if (to) add(`a.ts < (?::date + 1)`, to);
  if (q) add('(a.record_label ILIKE ? OR a.detail ILIKE ?)'.replace('?', '$' + (params.length + 1)).replace('?', '$' + (params.length + 1)), `%${q}%`);
  const scopes = A.scopesFor(ctx, 'M26', 'V');
  if (!ctx.isAdmin && !scopes.has('G')) add(`(a.user_id IN (SELECT id FROM users WHERE country = ?))`, ctx.user.country);
  const size = Math.min(parseInt(req.query.size || '50', 10), 200); const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const total = (await db.query(`SELECT count(*)::int n FROM audit_log a WHERE ${where.join(' AND ')}`, params)).rows[0].n;
  const { rows } = await db.query(`SELECT a.* FROM audit_log a WHERE ${where.join(' AND ')} ORDER BY a.ts DESC, a.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
  if (req.query.format === 'csv') {
    if (!A.can(ctx, 'M26', 'X') && !ctx.isAdmin) throw forbidden();
    const esc = (v) => (v == null ? '' : `"${String(typeof v === 'object' ? JSON.stringify(v) : v).replace(/"/g, '""')}"`);
    await audit(ctx, { event: 'export', entity: 'audit_log', detail: `${rows.length} audit rows exported` });
    res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', 'attachment; filename="audit.csv"');
    return res.send(['id,timestamp,user,event,entity,record,label,detail,changes', ...rows.map((r) => [r.id, r.ts.toISOString(), r.user_name, r.event, r.entity, r.record_id, r.record_label, r.detail, r.changes].map(esc).join(','))].join('\n'));
  }
  res.json({ rows, total, page, size });
}));

// ------------------------------------------------------------------ user settings
const USER_KEYS = ['language', 'date_format', 'theme', 'notification_prefs', 'calendar_sharing', 'default_dashboard', 'start_page', 'signature'];
router.get('/me/settings', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT key, value FROM user_settings WHERE user_id=$1', [req.ctx.id]);
  res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])), time_zone: req.ctx.user.time_zone, locale: req.ctx.user.locale });
}));
router.put('/me/settings', wrap(async (req, res) => {
  const b = req.body || {};
  for (const k of USER_KEYS) if (k in b) {
    if (k === 'calendar_sharing' && !['full', 'busy-only', 'none'].includes(b[k])) throw bad('Invalid calendar sharing option');
    await db.query(`INSERT INTO user_settings (user_id, key, value) VALUES ($1,$2,$3) ON CONFLICT (user_id,key) DO UPDATE SET value=$3`, [req.ctx.id, k, JSON.stringify(b[k])]);
  }
  if (b.time_zone) await db.query('UPDATE users SET time_zone=$2 WHERE id=$1', [req.ctx.id, b.time_zone]);
  if (b.locale) await db.query('UPDATE users SET locale=$2 WHERE id=$1', [req.ctx.id, b.locale]);
  res.json({ ok: true });
}));

// --------------------------------------------------------- application settings
const AREA_ROLES = { General: ['ROL-ADM'], Commercial: ['ROL-ADM', 'ROL-FIN'], Claims: ['ROL-ADM', 'ROL-FIN'], Organisation: ['ROL-ADM', 'ROL-ORGA'], Workflow: ['ROL-ADM', 'ROL-WFA'], Events: ['ROL-ADM', 'ROL-EVO'], Security: ['ROL-ADM'], Integration: ['ROL-ADM'] };
router.get('/settings/app', wrap(async (req, res) => {
  const ctx = req.ctx;
  if (!A.can(ctx, 'M32', 'V') && !A.can(ctx, 'M24', 'V')) throw forbidden();
  const { rows } = await db.query('SELECT key, value, area, description, sensitive, secret, version, modified_at FROM app_settings ORDER BY area, key');
  const { rows: pend } = await db.query(`SELECT key, count(*)::int n FROM app_setting_versions WHERE status='Pending approval' GROUP BY key`);
  const pm = Object.fromEntries(pend.map((p) => [p.key, p.n]));
  res.json(rows.map((r) => ({ ...r, value: r.secret ? '••••••••' : r.value, editable: A.roleHas(ctx, ...(AREA_ROLES[r.area] || ['ROL-ADM'])), pending: pm[r.key] || 0 })));
}));
async function applySetting(key, value, userId, c, versionRow) {
  const { rows } = await c.query('SELECT version FROM app_settings WHERE key=$1', [key]);
  const v = (rows[0] ? rows[0].version : 0) + 1;
  await c.query('UPDATE app_settings SET value=$2, version=$3, modified_by=$4, modified_at=now() WHERE key=$1', [key, JSON.stringify(value), v, userId]);
  if (versionRow) await c.query(`UPDATE app_setting_versions SET status='Active', version=$2 WHERE id=$1`, [versionRow, v]);
  else await c.query(`INSERT INTO app_setting_versions (key, version, value, changed_by, status) VALUES ($1,$2,$3,$4,'Active')`, [key, v, JSON.stringify(value), userId]);
  await c.query(`UPDATE app_setting_versions SET status='Superseded' WHERE key=$1 AND status='Active' AND version<$2`, [key, v]);
  settings.clear();
}
approvals.registerHandler('config', {
  async onApproved(ctx, req, i, c) {
    const { rows } = await c.query('SELECT * FROM app_setting_versions WHERE id=$1', [req.record_id]);
    if (rows[0]) await applySetting(rows[0].key, rows[0].value, rows[0].changed_by, c, rows[0].id);
  },
  async onRejected(ctx, req, i, c) { await c.query(`UPDATE app_setting_versions SET status='Rejected' WHERE id=$1`, [req.record_id]); },
  async onReturned(ctx, req, i, c) { await c.query(`UPDATE app_setting_versions SET status='Rejected' WHERE id=$1`, [req.record_id]); },
  async onWithdrawn(ctx, req, i, c) { await c.query(`UPDATE app_setting_versions SET status='Rejected' WHERE id=$1`, [req.record_id]); },
});
function validateSetting(key, value, existing) {
  if (typeof existing === 'number' && typeof value !== 'number') throw bad('Value must be a number');
  if (typeof existing === 'boolean' && typeof value !== 'boolean') throw bad('Value must be true or false');
  if (Array.isArray(existing) && !Array.isArray(value)) throw bad('Value must be a list');
  if (typeof existing === 'number' && value < 0) throw bad('Value cannot be negative');
  if (/margin_floor/.test(key) && (value < -100 || value > 100)) throw bad('Margin floor must be a percentage');
  if (key === 'base_currency' && !/^[A-Z]{3}$/.test(value)) throw bad('Base currency must be an ISO code');
}
async function changeSetting(ctx, key, value, note, effective_from) {
  const { rows } = await db.query('SELECT * FROM app_settings WHERE key=$1', [key]);
  const s = rows[0]; if (!s) throw notFound('Unknown setting');
  if (!A.roleHas(ctx, ...(AREA_ROLES[s.area] || ['ROL-ADM']))) throw forbidden('You cannot change settings in this area');
  if (s.secret) { /* write-only */ } else validateSetting(key, value, s.value);
  return db.tx(async (c) => {
    if (!s.sensitive) { await applySetting(key, value, ctx.id, c); await audit(ctx, { event: 'setting_changed', entity: 'app_settings', label: key, changes: { value: s.secret ? ['***', '***'] : [s.value, value] }, detail: note }, c); return { status: 'Applied' }; }
    const { rows: pv } = await c.query(`INSERT INTO app_setting_versions (key, version, value, changed_by, effective_from, note, status) VALUES ($1,$2,$3,$4,$5,$6,'Pending approval') RETURNING id`, [key, s.version + 1, JSON.stringify(value), ctx.id, effective_from || null, note || null]);
    const r = await approvals.submit(ctx, { type: 'config', entity: 'app_setting_versions', recordId: pv[0].id, label: `Setting ${key} → ${JSON.stringify(value)}`, snapshot: { area: s.area, amount_base: 0 }, comment: note }, c);
    if (!r.required) { await applySetting(key, value, ctx.id, c, pv[0].id); return { status: 'Applied' }; }
    await audit(ctx, { event: 'setting_change_requested', entity: 'app_settings', label: key, detail: `${r.request.number}: ${note || ''}` }, c);
    return { status: 'Pending approval', approval: r.request.number };
  });
}
router.put('/settings/app/:key', wrap(async (req, res) => {
  const { value, note, effective_from } = req.body || {};
  res.json(await changeSetting(req.ctx, req.params.key, value, note, effective_from));
}));
router.get('/settings/app/:key/versions', wrap(async (req, res) => {
  if (!A.can(req.ctx, 'M32', 'V') && !A.can(req.ctx, 'M24', 'V')) throw forbidden();
  const { rows } = await db.query(`SELECT v.*, u.name changed_by_name FROM app_setting_versions v LEFT JOIN users u ON u.id=v.changed_by WHERE key=$1 ORDER BY v.id DESC LIMIT 50`, [req.params.key]);
  const { rows: s } = await db.query('SELECT secret FROM app_settings WHERE key=$1', [req.params.key]);
  res.json(rows.map((r) => (s[0] && s[0].secret ? { ...r, value: '••••••••' } : r)));
}));
router.post('/settings/app/:key/rollback', wrap(async (req, res) => {
  const { rows: s } = await db.query('SELECT * FROM app_settings WHERE key=$1', [req.params.key]); if (!s[0]) throw notFound();
  if (s[0].secret) throw bad('Secrets cannot be rolled back');
  const { rows: v } = await db.query('SELECT * FROM app_setting_versions WHERE id=$1 AND key=$2', [req.body.version_id, req.params.key]); if (!v[0]) throw notFound('Version not found');
  res.json(await changeSetting(req.ctx, s[0].key, v[0].value, `Rollback to version ${v[0].version}`));
}));

// ------------------------------------------------------------ integrations (M25)
hooks.register('integrations', {
  async beforeUpdate(ctx, v, ex, c) {
    if (v.secret) { await c.query(`INSERT INTO app_settings (key, value, area, description, secret, sensitive) VALUES ($1,$2,'Integration','Credential for ' || $3,true,true) ON CONFLICT (key) DO UPDATE SET value=$2, modified_at=now()`, [`integration.${ex.code}.secret`, JSON.stringify(crypto.createHash('sha256').update(v.secret).digest('hex').slice(0, 8) + '…stored'), ex.code]); await audit(ctx, { event: 'secret_updated', entity: 'integrations', recordId: ex.id, label: ex.code }, c); delete v.secret; }
  },
});
entities.integrations.actions = {
  test_connection: { label: 'Test connection', perm: 'E', async run(ctx, i) {
    const ok = !!i.endpoint;
    await db.query(`UPDATE integrations SET status=$2, last_sync_at=CASE WHEN $3 THEN now() ELSE last_sync_at END WHERE id=$1`, [i.id, ok ? 'Active' : 'Not configured', ok]);
    await audit(ctx, { event: 'integration_test', entity: 'integrations', recordId: i.id, label: i.code, detail: ok ? 'connector reachable (simulated)' : 'no endpoint configured' });
    return { ok, message: ok ? 'Connection test succeeded (simulated connector)' : 'Configure an endpoint first' };
  } },
};
router.get('/integrations/logs', wrap(async (req, res) => {
  if (!A.can(req.ctx, 'M25', 'V')) throw forbidden();
  const p = []; const w = ['true'];
  if (req.query.status) { p.push(req.query.status); w.push(`status=$${p.length}`); } if (req.query.code) { p.push(req.query.code); w.push(`integration_code=$${p.length}`); }
  const { rows } = await db.query(`SELECT id, integration_code, direction, entity, record_id, status, attempts, error, created_at, updated_at FROM integration_logs WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT 200`, p);
  res.json(rows);
}));
router.post('/integrations/logs/:id/:op', wrap(async (req, res) => {
  const ctx = req.ctx;
  if (!A.can(ctx, 'M25', 'E') && !ctx.isAdmin) throw forbidden();
  const { rows } = await db.query('SELECT * FROM integration_logs WHERE id=$1', [req.params.id]); const l = rows[0]; if (!l) throw notFound();
  if (req.params.op === 'resubmit') {
    if (!['Failed', 'Dead-letter'].includes(l.status)) throw bad('Only failed messages can be resubmitted');
    await db.query(`UPDATE integration_logs SET status='Resubmitted', attempts=0, error=NULL, updated_at=now() WHERE id=$1`, [l.id]);
  } else if (req.params.op === 'discard') {
    if (!req.body.reason) throw bad('A reason is required to discard'); await db.query(`UPDATE integration_logs SET status='Discarded', updated_at=now() WHERE id=$1`, [l.id]);
  } else throw notFound('Unknown operation');
  await audit(ctx, { event: `integration_${req.params.op}`, entity: 'integration_logs', recordId: l.id, label: l.integration_code, detail: req.body.reason });
  res.json({ ok: true });
}));

module.exports = { router };
