'use strict';
// Four-layer access control (BRD §7.1): role -> record scope -> field-level -> state lock.
const db = require('../db');
const { entities } = require('../entities');

let PERMS = null; // role_code -> module -> { actions:Set, scopes:Set }
async function loadPerms() {
  const { rows } = await db.query('SELECT role_code, module, actions, scope FROM permissions');
  const m = {};
  for (const r of rows) {
    (m[r.role_code] ||= {})[r.module] = { actions: new Set(r.actions.split('')), scopes: new Set(r.scope.split('+')) };
  }
  PERMS = m;
}
const invalidate = () => { PERMS = null; };

const SCOPE_RANK = { G: 7, N: 6, D: 5, B: 5, T: 4, L: 4, O: 3, R: 1 };

/** Builds the per-request security context for a user. */
async function buildContext(userRow) {
  if (!PERMS) await loadPerms();
  const { rows: r } = await db.query('SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1', [userRow.id]);
  const roles = new Set(r.map((x) => x.code));
  if (userRow.user_type === 'internal') roles.add('ROL-EMP');
  const { rows: dr } = await db.query('SELECT count(*)::int n FROM users WHERE manager_id=$1 AND is_deleted=false AND status=\'Active\'', [userRow.id]);
  const hasReports = dr[0].n > 0;
  if (hasReports) roles.add('ROL-DM');
  // delegations received: act with delegator's approval authority (approvals only)
  const { rows: dl } = await db.query(
    'SELECT delegator_id FROM delegations WHERE delegate_id=$1 AND active AND current_date BETWEEN start_date AND end_date', [userRow.id]);
  return {
    user: userRow, id: userRow.id, roles, hasReports, delegators: dl.map((x) => x.delegator_id),
    isAdmin: roles.has('ROL-ADM'), isExternal: userRow.user_type === 'external',
    _cache: {},
  };
}

function can(ctx, module, action) {
  if (!PERMS) return false;
  for (const role of ctx.roles) {
    const p = PERMS[role] && PERMS[role][module];
    if (p && p.actions.has(action)) return true;
  }
  return false;
}
function scopesFor(ctx, module, action = 'V') {
  const s = new Set();
  for (const role of ctx.roles) {
    const p = PERMS[role] && PERMS[role][module];
    if (p && p.actions.has(action)) p.scopes.forEach((x) => s.add(x));
  }
  return s;
}
const roleHas = (ctx, ...codes) => codes.some((c) => ctx.roles.has(c));

async function teamUserIds(ctx) {
  if (ctx._cache.team) return ctx._cache.team;
  const { rows } = await db.query(
    `WITH RECURSIVE mine AS (
       SELECT id FROM teams WHERE id = (SELECT team_id FROM users WHERE id=$1) OR manager_id=$1
       UNION SELECT t.id FROM teams t JOIN mine m ON t.parent_id=m.id)
     SELECT id FROM users WHERE team_id IN (SELECT id FROM mine) OR id=$1`, [ctx.id]);
  return (ctx._cache.team = rows.map((r) => r.id));
}
async function reportIds(ctx) {
  if (ctx._cache.reports) return ctx._cache.reports;
  const { rows } = await db.query(
    `WITH RECURSIVE r AS (SELECT id FROM users WHERE manager_id=$1 AND is_deleted=false
       UNION SELECT u.id FROM users u JOIN r ON u.manager_id=r.id WHERE u.is_deleted=false)
     SELECT id FROM r`, [ctx.id]);
  return (ctx._cache.reports = rows.map((r) => r.id));
}

/**
 * SQL predicate limiting rows to what the user may see.  `alias` prefixes columns.
 * Returns '' (no restriction) or '(...)' with params pushed to `params`.
 */
async function scopeClause(entityKey, ctx, params, action = 'V', alias = 't') {
  const e = entities[entityKey];
  if (ctx.isAdmin) return '';
  if (e.scopeCustom) return '';                 // handled by the owning module (e.g. approvals inbox)
  const scopes = scopesFor(ctx, e.module, action);
  if (!scopes.size) return 'false';
  if (scopes.has('G') || e.noScope) return '';
  const a = alias ? alias + '.' : '';
  const parts = [];
  const push = (v) => { params.push(v); return `$${params.length}`; };

  if (e.hasOwner) {
    if (scopes.has('O')) {
      let o = `${a}owner_id = ${push(ctx.id)} OR ${a}created_by = ${push(ctx.id)}`;
      if (e.teamTable) o += ` OR ${a}id IN (SELECT ${e.teamTable.fk} FROM ${e.teamTable.table} WHERE user_id = ${push(ctx.id)} AND is_deleted=false)`;
      if (e.key === 'accounts') o += ` OR ${a}id IN (SELECT op.account_id FROM opportunity_team ot JOIN opportunities op ON op.id=ot.opportunity_id WHERE ot.user_id=${push(ctx.id)} AND ot.is_deleted=false)`;
      parts.push(o);
    }
    if (scopes.has('T')) parts.push(`${a}owner_id = ANY(${push(await teamUserIds(ctx))}::bigint[])`);
    if (scopes.has('L')) parts.push(`${a}owner_id = ANY(${push(await reportIds(ctx))}::bigint[])`);
    if (scopes.has('N')) {
      if (e.has('country')) parts.push(`${a}country = ${push(ctx.user.country)}`);
      else parts.push(`${a}owner_id IN (SELECT id FROM users WHERE country = ${push(ctx.user.country)})`);
    }
    if (scopes.has('B')) {
      if (e.has('branch_id')) parts.push(`${a}branch_id = ${push(ctx.user.branch_id)}`);
      else parts.push(`${a}owner_id IN (SELECT id FROM users WHERE branch_id = ${push(ctx.user.branch_id)})`);
    }
    if (scopes.has('D')) {
      if (e.has('bu_id')) parts.push(`${a}bu_id = ${push(ctx.user.bu_id)}`);
      else parts.push(`${a}owner_id IN (SELECT id FROM users WHERE bu_id = ${push(ctx.user.bu_id)})`);
    }
  }
  if (e.scopeParent) {
    // Child records inherit the visibility of their parent (BRD 7.3)
    const sp = e.scopeParent;
    const pp = [];
    const pc = await scopeClause(sp.entity, ctx, pp, 'V', 'p');
    if (pc === '') return '';
    const base = params.length;
    params.push(...pp);
    const renum = pc.replace(/\$(\d+)/g, (_, n) => `$${base + parseInt(n, 10)}`);
    parts.push(`${a}${sp.fk} IN (SELECT p.id FROM ${entities[sp.entity].table} p WHERE ${entities[sp.entity].plain ? 'true' : 'p.is_deleted=false'} AND ${renum})`);
  }
  if (scopes.has('R')) {
    const ps = [`rs.user_id = ${push(ctx.id)}`];
    if (ctx.user.team_id) ps.push(`rs.team_id = ${push(ctx.user.team_id)}`);
    if (ctx.user.partner_id) ps.push(`rs.partner_id = ${push(ctx.user.partner_id)}`);
    parts.push(`${a}id IN (SELECT rs.record_id FROM record_shares rs WHERE rs.entity = ${push(entityKey)} AND (${ps.join(' OR ')}) AND (rs.expires_at IS NULL OR rs.expires_at > now()))`);
  }
  if (!e.hasOwner && !e.scopeParent && !scopes.has('R')) return '';   // nothing to scope on
  return parts.length ? `(${parts.join(' OR ')})` : 'false';
}

// ------------------------------------------------------------ field level security
const FIELD_RULES = {
  // group -> { view roles, edit roles }
  cost: { view: ['ROL-ADM', 'ROL-FIN', 'ROL-SOP', 'ROL-PRC', 'ROL-CM', 'ROL-SD', 'ROL-SM', 'ROL-AUD', 'ROL-ROE'], edit: ['ROL-ADM', 'ROL-PRC', 'ROL-SOP', 'ROL-FIN'] },
  margin: { view: ['ROL-ADM', 'ROL-FIN', 'ROL-SOP', 'ROL-CM', 'ROL-SD', 'ROL-SM', 'ROL-AUD', 'ROL-ROE', 'ROL-SE', 'ROL-AM'], edit: [] },
  commission: { view: ['ROL-ADM', 'ROL-FIN', 'ROL-SD', 'ROL-CM', 'ROL-AUD'], edit: ['ROL-FIN'] },
  financial: { view: ['ROL-ADM', 'ROL-FIN', 'ROL-CM', 'ROL-SD', 'ROL-AM', 'ROL-AUD'], edit: [] },
  employee: { view: ['ROL-ADM', 'ROL-ORGA', 'ROL-AUD'], edit: ['ROL-ADM', 'ROL-ORGA'] },
  personal: { view: null, edit: null }, // everyone with record access (masked for EXT)
  claim: { view: null, edit: null },
};
function fieldAccess(ctx, group, fallbackEditable = true) {
  if (!group) return { view: true, edit: fallbackEditable };
  if (ctx.isExternal && ['cost', 'margin', 'commission', 'financial', 'employee'].includes(group)) return { view: false, edit: false };
  const r = FIELD_RULES[group];
  if (!r) return { view: true, edit: true };
  const view = r.view === null ? true : roleHas(ctx, ...r.view) || (ctx._allowSeMargin && group === 'margin');
  const edit = r.edit === null ? true : roleHas(ctx, ...r.edit);
  return { view, edit: view && edit };
}

/** Removes/masks fields the user may not see. */
function maskRecord(entityKey, row, ctx) {
  const e = entities[entityKey];
  if (!row) return row;
  const out = { ...row };
  if (e.sec && !fieldAccess(ctx, e.sec).view) return null;
  for (const f of e.fields) {
    if (!f.sec) continue;
    const a = fieldAccess(ctx, f.sec);
    if (!a.view) { delete out[f.name]; out[`${f.name}__masked`] = true; }
    else if (f.sec === 'personal' && ctx.isExternal) out[f.name] = out[f.name] ? '••• masked •••' : out[f.name];
  }
  return out;
}
function writableFields(entityKey, ctx, existing) {
  const e = entities[entityKey];
  return e.fields.filter((f) => {
    if (f.readonly || f.sys || f.std && f.name === 'number') return false;
    if (f.sec && !fieldAccess(ctx, f.sec).edit) return false;
    return true;
  });
}

module.exports = {
  loadPerms, invalidate, buildContext, can, scopesFor, scopeClause, maskRecord, writableFields, fieldAccess, roleHas, teamUserIds, reportIds, SCOPE_RANK,
  setAllowSeMargin: (ctx, v) => { ctx._allowSeMargin = v; },
};
