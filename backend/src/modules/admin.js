'use strict';
// M24 / M26 - Administration: roles, permissions, user-role assignment, data quality, job trigger.
const express = require('express');
const db = require('../db');
const A = require('../core/access');
const hooks = require('../core/hooks');
const crud = require('../core/crud');
const { audit } = require('../core/audit');
const { bad, forbidden, notFound, wrap } = require('../core/errors');
const opps = require('./opportunities');

const router = express.Router();
const adminOnly = (req, res, next) => (req.ctx.isAdmin ? next() : next(forbidden('Administrator access required')));

// Separation-of-duty conflicts between roles (BRULE-APR-003 / BRULE-WFL-009)
const SOD = [['ROL-PAY', 'ROL-FINV'], ['ROL-AUD', 'ROL-ADM'], ['ROL-EXT', 'ROL-ADM']];

router.get('/admin/roles', adminOnly, wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT r.*, (SELECT count(*)::int FROM user_roles ur WHERE ur.role_id=r.id) users FROM roles r ORDER BY r.code`);
  res.json(rows);
}));
router.get('/admin/users/:id/roles', adminOnly, wrap(async (req, res) => {
  const { rows } = await db.query('SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1', [req.params.id]);
  res.json(rows.map((r) => r.code));
}));
router.put('/admin/users/:id/roles', adminOnly, wrap(async (req, res) => {
  const codes = (req.body || {}).roles || [];
  for (const [a, b] of SOD) if (codes.includes(a) && codes.includes(b)) throw bad(`Separation of duties: ${a} and ${b} cannot be held by the same user`);
  const { rows: u } = await db.query('SELECT id, name, user_type FROM users WHERE id=$1 AND is_deleted=false', [req.params.id]); if (!u[0]) throw notFound();
  if (u[0].user_type === 'external' && codes.some((c) => c !== 'ROL-EXT')) throw bad('External users may only hold the external partner role');
  const { rows: before } = await db.query('SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1', [u[0].id]);
  await db.tx(async (c) => {
    await c.query('DELETE FROM user_roles WHERE user_id=$1', [u[0].id]);
    for (const code of codes) await c.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code=$2', [u[0].id, code]);
    await c.query('UPDATE users SET token_version=token_version+1 WHERE id=$1', [u[0].id]);
    await audit(req.ctx, { event: 'roles_changed', entity: 'users', recordId: u[0].id, label: u[0].name, changes: { roles: [before.map((r) => r.code), codes] } }, c);
  });
  res.json({ ok: true });
}));
router.get('/admin/permissions', wrap(async (req, res) => {
  if (!req.ctx.isAdmin && !A.roleHas(req.ctx, 'ROL-AUD')) throw forbidden();
  const { rows } = await db.query('SELECT role_code, module, actions, scope FROM permissions ORDER BY module, role_code');
  res.json(rows);
}));
router.put('/admin/permissions', adminOnly, wrap(async (req, res) => {
  const { role_code, module, actions = '', scope = 'O' } = req.body || {};
  if (!/^M\d\d$/.test(module || '')) throw bad('Invalid module');
  if (!/^[A-Z]*$/.test(actions) || !/^[OTDBNGRL](\+[OTDBNGRL])*$/.test(scope)) throw bad('Invalid actions or scope');
  const { rows: before } = await db.query('SELECT actions, scope FROM permissions WHERE role_code=$1 AND module=$2', [role_code, module]);
  if (!actions) await db.query('DELETE FROM permissions WHERE role_code=$1 AND module=$2', [role_code, module]);
  else await db.query('INSERT INTO permissions (role_code, module, actions, scope) VALUES ($1,$2,$3,$4) ON CONFLICT (role_code, module) DO UPDATE SET actions=$3, scope=$4', [role_code, module, actions, scope]);
  A.invalidate(); await A.loadPerms();
  await audit(req.ctx, { event: 'permission_changed', entity: 'permissions', label: `${role_code} ${module}`, changes: { grant: [before[0] || null, { actions, scope }] } });
  res.json({ ok: true });
}));
router.post('/admin/users/:id/unlock', adminOnly, wrap(async (req, res) => {
  await db.query('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=$1', [req.params.id]);
  await audit(req.ctx, { event: 'user_unlocked', entity: 'users', recordId: Number(req.params.id) });
  res.json({ ok: true });
}));

router.get('/admin/overview', adminOnly, wrap(async (req, res) => {
  const one = async (sql) => (await db.query(sql)).rows[0];
  res.json({
    users: await one(`SELECT count(*) FILTER (WHERE status='Active')::int active, count(*)::int total, count(*) FILTER (WHERE locked_until > now())::int locked FROM users WHERE is_deleted=false`),
    records: await one(`SELECT (SELECT count(*) FROM accounts WHERE is_deleted=false)::int accounts, (SELECT count(*) FROM contacts WHERE is_deleted=false)::int contacts, (SELECT count(*) FROM opportunities WHERE is_deleted=false)::int opportunities, (SELECT count(*) FROM leads WHERE is_deleted=false)::int leads`),
    integrations: await one(`SELECT count(*) FILTER (WHERE status='Failed')::int failed, count(*) FILTER (WHERE status IN ('Pending','Resubmitted'))::int pending, count(*) FILTER (WHERE status='Dead-letter')::int dead FROM integration_logs`),
    approvals_pending: (await one(`SELECT count(*)::int n FROM approval_requests WHERE status='Pending'`)).n,
    audit_events_24h: (await one(`SELECT count(*)::int n FROM audit_log WHERE ts > now() - interval '24 hours'`)).n,
    failed_logins_24h: (await one(`SELECT count(*)::int n FROM audit_log WHERE event='login_failed' AND ts > now() - interval '24 hours'`)).n,
  });
}));
router.get('/admin/data-quality', wrap(async (req, res) => {
  if (!A.roleHas(req.ctx, 'ROL-ADM', 'ROL-SOP')) throw forbidden();
  const one = async (sql) => (await db.query(sql)).rows[0].n;
  res.json({
    accounts_missing_tax_id: await one(`SELECT count(*)::int n FROM accounts WHERE is_deleted=false AND (tax_id IS NULL OR tax_id='')`),
    contacts_without_email: await one(`SELECT count(*)::int n FROM contacts WHERE is_deleted=false AND (email IS NULL OR email='')`),
    duplicate_account_names: (await db.query(`SELECT lower(legal_name) name, count(*)::int n FROM accounts WHERE is_deleted=false GROUP BY 1 HAVING count(*)>1 ORDER BY 2 DESC LIMIT 20`)).rows,
    duplicate_contact_emails: (await db.query(`SELECT lower(email) email, count(*)::int n FROM contacts WHERE is_deleted=false AND email IS NOT NULL GROUP BY 1 HAVING count(*)>1 ORDER BY 2 DESC LIMIT 20`)).rows,
    open_opps_past_close: await one(`SELECT count(*)::int n FROM opportunities WHERE is_deleted=false AND status='Open' AND close_date < current_date`),
    products_missing_cost: await one(`SELECT count(*)::int n FROM products WHERE status='Active' AND standard_cost IS NULL AND NOT EXISTS (SELECT 1 FROM cost_records c WHERE c.product_id=products.id AND c.is_deleted=false)`),
    inactive_owner_records: await one(`SELECT (SELECT count(*) FROM opportunities o JOIN users u ON u.id=o.owner_id WHERE o.is_deleted=false AND o.status='Open' AND u.status<>'Active')::int n`),
  });
}));
router.post('/admin/jobs/run', adminOnly, wrap(async (req, res) => { res.json(await require('../jobs').runAll(true)); }));

// config changes must refresh caches
hooks.register('picklists', { afterCreate: () => crud.clearPicklists(), afterUpdate: () => crud.clearPicklists(), afterDelete: () => crud.clearPicklists() });
hooks.register('stage_definitions', {
  afterCreate: () => opps.clearStages(), afterUpdate: () => opps.clearStages(), afterDelete: () => opps.clearStages(),
  validate(ctx, v) { const e = []; if (!(v.probability >= 0 && v.probability <= 100)) e.push({ field: 'probability', message: 'Probability must be 0-100' }); return e; },
});
hooks.register('teams', { validate(ctx, v, ex) { const e = []; if (ex && v.parent_id && Number(v.parent_id) === ex.id) e.push({ field: 'parent_id', message: 'A team cannot be its own parent' }); return e; } });

module.exports = { router };
