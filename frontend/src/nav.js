// Navigation model (docs/redesign/01-audit-and-strategy.md, "Proposed navigation").
// Two areas: WORK (daily jobs, grouped by job) and ADMIN (settings and administration, behind the gear).
// Every destination from the old single sidebar keeps a place; tests/nav.test.mjs checks that.
// Item fields: to, icon, label, mod (module code that must have View), roles (any of), needs ('cost'), badge, end, also (extra paths that mark it active).

export const COST_ROLES = ['ROL-ADM', 'ROL-FIN', 'ROL-SOP', 'ROL-PRC', 'ROL-CM', 'ROL-SD', 'ROL-SM', 'ROL-AUD', 'ROL-ROE'];

export const WORK_NAV = [
  { group: 'Home', items: [
    { to: '/', icon: 'dashboard', label: 'Dashboard', mod: 'M01', end: true },
    { to: '/my-work', icon: 'myWork', label: 'My work', mod: 'M30' },
    { to: '/approvals', icon: 'approvals', label: 'Approvals', mod: 'M15', badge: 'approvals' },
    { to: '/calendar', icon: 'calendar', label: 'Calendar', mod: 'M31' },
  ] },
  { group: 'Sales', items: [
    { to: '/leads', icon: 'leads', label: 'Leads', mod: 'M02' },
    { to: '/accounts', icon: 'accounts', label: 'Accounts', mod: 'M03' },
    { to: '/contacts', icon: 'contacts', label: 'Contacts', mod: 'M04' },
    { to: '/opportunities', icon: 'opportunities', label: 'Opportunities', mod: 'M08', also: ['/pipeline'] },
    { to: '/quotations', icon: 'quotations', label: 'Quotations', mod: 'M13' },
    { to: '/forecast', icon: 'forecast', label: 'Forecast', mod: 'M18' },
  ] },
  { group: 'Channel', items: [
    { to: '/partners', icon: 'partners', label: 'Partners', mod: 'M05' },
    { to: '/deal_registrations', icon: 'dealRegistrations', label: 'Deal registrations', mod: 'M09' },
    { to: '/vendors', icon: 'vendors', label: 'Vendors', mod: 'M06' },
  ] },
  { group: 'Presales & catalog', items: [
    { to: '/tech_requirements', icon: 'requirements', label: 'Requirements', mod: 'M12' },
    { to: '/solution_configs', icon: 'solutions', label: 'Solutions & BOM', mod: 'M12' },
    { to: '/products', icon: 'products', label: 'Products', mod: 'M07' },
    { to: '/price_records', icon: 'priceLists', label: 'Price lists', mod: 'M14' },
    { to: '/cost_records', icon: 'vendorCosts', label: 'Vendor costs', mod: 'M14', needs: 'cost' },
  ] },
  { group: 'Delivery & renewals', items: [
    { to: '/projects', icon: 'projects', label: 'Projects', mod: 'M16' },
    { to: '/contracts', icon: 'contracts', label: 'Contracts & renewals', mod: 'M19' },
  ] },
  { group: 'Marketing', items: [
    { to: '/campaigns', icon: 'campaigns', label: 'Campaigns', mod: 'M02' },
    { to: '/events', icon: 'events', label: 'Events', mod: 'M34' },
  ] },
  { group: 'Activity', items: [
    { to: '/tasks', icon: 'tasks', label: 'Tasks', mod: 'M30' },
    { to: '/activities', icon: 'activities', label: 'Activities', mod: 'M10' },
    { to: '/meetings', icon: 'meetings', label: 'Meetings', mod: 'M11' },
    { to: '/activity_reports', icon: 'activityReports', label: 'Activity reports', mod: 'M29' },
  ] },
  { group: 'Finance', items: [
    { to: '/claims', icon: 'claims', label: 'Claims', mod: 'M35' },
    { to: '/payments', icon: 'payments', label: 'Reimbursements', mod: 'M35', roles: ['ROL-PAY', 'ROL-FIN', 'ROL-ADM', 'ROL-FINV'] },
    { to: '/sales_targets', icon: 'targets', label: 'Targets', mod: 'M17' },
    { to: '/commission', icon: 'commission', label: 'Commission', mod: 'M17' },
  ] },
  { group: 'Insights', items: [
    { to: '/reports', icon: 'reports', label: 'Reports', mod: 'M22' },
    { to: '/analytics', icon: 'analytics', label: 'Activity analytics', mod: 'M29' },
    { to: '/org-chart', icon: 'orgChart', label: 'Org chart', mod: 'M33' },
  ] },
];

export const ADMIN_NAV = [
  { group: 'Overview', items: [{ to: '/admin', icon: 'admin', label: 'Admin overview', mod: 'M24', roles: ['ROL-ADM'], end: true }] },
  { group: 'People & access', items: [
    { to: '/users', icon: 'users', label: 'Users', mod: 'M24' },
    { to: '/admin/permissions', icon: 'permissions', label: 'Roles & permissions', mod: 'M24', roles: ['ROL-ADM', 'ROL-AUD'] },
    { to: '/org', icon: 'organisation', label: 'Organisation', mod: 'M24' },
  ] },
  { group: 'Data', items: [
    { to: '/picklists', icon: 'picklists', label: 'Picklists', mod: 'M24' },
    { to: '/stage_definitions', icon: 'stages', label: 'Pipeline stages', mod: 'M24' },
    { to: '/exchange_rates', icon: 'fx', label: 'FX & tax', mod: 'M24' },
    { to: '/import_jobs', icon: 'imports', label: 'Import history', mod: 'M23' },
    { to: '/admin/data-quality', icon: 'requirements', label: 'Data quality', mod: 'M24' },
  ] },
  { group: 'Automation', items: [
    { to: '/approval_processes', icon: 'workflows', label: 'Workflows', mod: 'M15', roles: ['ROL-ADM', 'ROL-WFA'] },
    { to: '/integrations', icon: 'integrations', label: 'Integrations', mod: 'M25' },
  ] },
  { group: 'Security', items: [{ to: '/admin/audit', icon: 'audit', label: 'Audit log', mod: 'M26' }] },
  { group: 'System', items: [{ to: '/settings/app', icon: 'configuration', label: 'Configuration', mod: 'M32' }] },
];

const ADMIN_PATHS = ADMIN_NAV.flatMap((g) => g.items.map((i) => i.to));
/** True when the path belongs to the admin area (so the admin sidebar shows). */
export const isAdminPath = (path) => ADMIN_PATHS.some((p) => path === p || path.startsWith(`${p}/`)) || path.startsWith('/integrations');

/** Filter a nav model down to what this user may see. */
export function visibleNav(model, { can, hasRole }) {
  return model.map((g) => ({ ...g, items: g.items.filter((i) => can(i.mod, 'V') && (!i.roles || hasRole(...i.roles)) && !(i.needs === 'cost' && !hasRole(...COST_ROLES))) })).filter((g) => g.items.length);
}

/** Groups each role works in most; they start open, the rest start collapsed (Assumption A1 in the audit). */
export const DEFAULT_OPEN = {
  'ROL-SE': ['Home', 'Sales', 'Activity'], 'ROL-AM': ['Home', 'Sales', 'Activity'], 'ROL-SM': ['Home', 'Sales', 'Activity', 'Insights'],
  'ROL-CM': ['Home', 'Sales', 'Insights'], 'ROL-SD': ['Home', 'Sales', 'Insights'], 'ROL-PSE': ['Home', 'Presales & catalog', 'Sales'], 'ROL-TE': ['Home', 'Presales & catalog'],
  'ROL-SOP': ['Home', 'Sales', 'Presales & catalog'], 'ROL-FIN': ['Home', 'Finance'], 'ROL-FINV': ['Home', 'Finance'], 'ROL-PAY': ['Home', 'Finance'], 'ROL-PRC': ['Home', 'Presales & catalog'],
  'ROL-MKT': ['Home', 'Marketing'], 'ROL-CPM': ['Home', 'Channel', 'Sales'], 'ROL-AUD': ['Home', 'Insights'], 'ROL-ROE': ['Home', 'Insights', 'Sales'], 'ROL-EXT': ['Home', 'Channel', 'Sales'], 'ROL-ADM': ['Home', 'Sales'],
};
export function defaultOpenGroups(roles) {
  const set = new Set(['Home']);
  roles.forEach((r) => (DEFAULT_OPEN[r] || []).forEach((g) => set.add(g)));
  if (set.size === 1) ['Sales'].forEach((g) => set.add(g));
  return set;
}

/** "Create" menu in the top bar: only what the user can create. */
export const CREATE_ITEMS = [
  { label: 'Lead', entity: 'leads', mod: 'M02', icon: 'leads' },
  { label: 'Account', entity: 'accounts', mod: 'M03', icon: 'accounts' },
  { label: 'Contact', entity: 'contacts', mod: 'M04', icon: 'contacts' },
  { label: 'Opportunity', entity: 'opportunities', mod: 'M08', icon: 'opportunities' },
  { label: 'Task', entity: 'tasks', mod: 'M30', icon: 'tasks' },
  { label: 'Activity', entity: 'activities', mod: 'M10', icon: 'activities' },
  { label: 'Meeting', entity: 'meetings', mod: 'M11', icon: 'meetings' },
  { label: 'Expense claim', entity: 'claims', mod: 'M35', icon: 'claims' },
];

/** Readable names for role codes shown to users (never show "ROL-FINV"). */
export const ROLE_NAMES = {
  'ROL-ADM': 'System administrator', 'ROL-CM': 'Country manager', 'ROL-SD': 'Sales director', 'ROL-SM': 'Sales manager', 'ROL-SE': 'Sales executive',
  'ROL-AM': 'Account manager', 'ROL-PSE': 'Presales engineer', 'ROL-TE': 'Technical engineer', 'ROL-SOP': 'Sales operations', 'ROL-FIN': 'Finance approver',
  'ROL-FINV': 'Finance verifier', 'ROL-PAY': 'Payment officer', 'ROL-PRC': 'Pricing', 'ROL-MKT': 'Marketing', 'ROL-EVO': 'Event organiser', 'ROL-CPM': 'Channel partner manager',
  'ROL-AUD': 'Auditor', 'ROL-ROE': 'Read-only executive', 'ROL-EXT': 'External partner', 'ROL-ORGA': 'Org administrator', 'ROL-WFA': 'Workflow administrator',
  'ROL-EMP': 'Employee', 'ROL-DM': 'Direct manager',
};
export const roleName = (code) => ROLE_NAMES[code] || code;
