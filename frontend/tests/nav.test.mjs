// Navigation redesign guard: no destination from the old single sidebar may be lost,
// permissions filtering still applies, and users never see raw role codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ADMIN_NAV, CREATE_ITEMS, WORK_NAV, defaultOpenGroups, isAdminPath, roleName, visibleNav } from '../src/nav.js';

// The 46 destinations of the sidebar before the redesign (commit 9465d5e).
const OLD = '/ /my-work /approvals /leads /accounts /contacts /pipeline /opportunities /quotations /deal_registrations /projects /forecast /contracts /campaigns /partners /vendors /products /price_records /cost_records /tech_requirements /solution_configs /tasks /activities /meetings /calendar /activity_reports /events /claims /payments /sales_targets /commission /reports /analytics /org-chart /admin /users /admin/permissions /org /picklists /stage_definitions /exchange_rates /approval_processes /settings/app /integrations /admin/audit /import_jobs'.split(' ');
const all = [...WORK_NAV, ...ADMIN_NAV].flatMap((g) => g.items);
const reachable = new Set(all.flatMap((i) => [i.to, ...(i.also || [])]));

test('every old destination keeps a place in the new navigation', () => {
  const missing = OLD.filter((p) => !reachable.has(p));
  assert.deepEqual(missing, []);
});

test('no destination appears twice', () => {
  const seen = new Map(); const dup = [];
  all.forEach((i) => { if (seen.has(i.to)) dup.push(i.to); seen.set(i.to, 1); });
  assert.deepEqual(dup, []);
});

test('admin pages open the admin area; work pages do not', () => {
  ['/admin', '/users', '/users/12', '/admin/permissions', '/picklists', '/integrations/logs', '/settings/app', '/admin/audit'].forEach((p) => assert.ok(isAdminPath(p), p));
  ['/', '/leads', '/opportunities/2', '/settings/me', '/approvals', '/reports'].forEach((p) => assert.ok(!isAdminPath(p), p));
});

test('items are filtered by module view rights, roles and cost access', () => {
  const can = (mod) => ['M01', 'M02', 'M14'].includes(mod);
  const hasRole = (...r) => r.includes('ROL-SE');
  const v = visibleNav(WORK_NAV, { can, hasRole }).flatMap((g) => g.items.map((i) => i.to));
  assert.ok(v.includes('/leads') && v.includes('/price_records'));
  assert.ok(!v.includes('/cost_records'), 'vendor costs need a cost role');
  assert.ok(!v.includes('/accounts'), 'no M03 view right');
  assert.equal(visibleNav(ADMIN_NAV, { can: () => false, hasRole }).length, 0);
});

test('every role in the permission matrix has a readable name', () => {
  const matrix = JSON.parse(readFileSync(new URL('../../backend/src/data/permission-matrix.json', import.meta.url), 'utf8'));
  matrix.roles.forEach((r) => assert.notEqual(roleName(r), r, `${r} has no display name`));
  ['ROL-FINV', 'ROL-PAY', 'ROL-WFA'].forEach((r) => assert.notEqual(roleName(r), r));
});

test('each role starts with its main groups open, and Home always', () => {
  assert.ok(defaultOpenGroups(['ROL-SE']).has('Sales'));
  assert.ok(defaultOpenGroups(['ROL-FIN']).has('Finance'));
  assert.ok(defaultOpenGroups(['ROL-XYZ']).has('Home'));
  const groups = new Set(WORK_NAV.map((g) => g.group));
  Object.values(defaultOpenGroups(['ROL-SE', 'ROL-FIN', 'ROL-MKT'])).forEach((g) => assert.ok(groups.has(g)));
});

test('create menu entries point at real modules', () => {
  CREATE_ITEMS.forEach((c) => assert.match(c.mod, /^M\d\d$/));
});
