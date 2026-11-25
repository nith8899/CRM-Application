'use strict';
// Seeds reference/configuration data (always) and demo data (unless SEED_DEMO=0). Idempotent: re-running is safe.
const bcrypt = require('bcryptjs');
const db = require('./db');
const matrix = require('./data/permission-matrix.json');
const { nextNumber } = require('./core/numbering');
const fx = require('./core/fx');
const A = require('./core/access');

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Crm@Demo2026';
const q = (sql, p) => db.query(sql, p);
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const J = JSON.stringify;
const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const ts = (offsetDays = 0, hour = 10) => { const d = new Date(Date.now() + offsetDays * 86400000); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };

// ----------------------------------------------------------------------- roles
const ROLES = [
  ['ROL-ADM', 'System Administrator', 'Configures system, users, roles, rules'], ['ROL-CM', 'Country Manager', 'Manages a country business'], ['ROL-SD', 'Sales Director', 'Leads sales across countries'],
  ['ROL-SM', 'Sales Manager', 'Manages sales teams'], ['ROL-SE', 'Sales Executive', 'Manages own leads, accounts, opportunities'], ['ROL-AM', 'Account Manager', 'Manages named accounts, renewals'],
  ['ROL-PSE', 'Presales Engineer', 'Technical requirements, sizing, BOM'], ['ROL-TE', 'Technical Engineer', 'Feasibility, POC'], ['ROL-SOP', 'Sales Operations', 'Process owner, quotation support, data quality'],
  ['ROL-FIN', 'Finance Approver', 'Commercial approvals, FX, commission'], ['ROL-PRC', 'Procurement User', 'Vendor costs and quotation refs'], ['ROL-MKT', 'Marketing User', 'Leads, campaigns, consent'],
  ['ROL-CPM', 'Channel Partner Manager', 'Partner lifecycle, deal registration'], ['ROL-AUD', 'Auditor', 'Read-only audit access'], ['ROL-EXT', 'External Partner User', 'Partner portal user'],
  ['ROL-ROE', 'Read-Only Executive', 'Dashboards and reports'], ['ROL-EMP', 'Employee (baseline)', 'Own settings, calendar, tasks, activities, claims'], ['ROL-DM', 'Line Manager', 'Derived from reporting line'],
  ['ROL-FINV', 'Finance Verifier', 'Verifies claims and receipts'], ['ROL-PAY', 'Payment Officer', 'Prepares reimbursement batches'], ['ROL-EVO', 'Event Organizer', 'Creates and runs events'],
  ['ROL-ORGA', 'Organization Administrator', 'Maintains organisation structure'], ['ROL-WFA', 'Workflow Administrator', 'Designs and publishes workflows'],
];
// BRD §7.4b/7.4c (M29-M35 and baseline employee access)
const EXTRA = {
  'ROL-EMP': { M01: ['V', 'O'], M10: ['VCE', 'O'], M11: ['VCE', 'O'], M20: ['VCEF', 'O'], M21: ['V', 'O'], M22: ['VX', 'O'], M29: ['VCES', 'O'], M30: ['VCEG', 'O'], M31: ['VCE', 'O'], M32: ['VE', 'O'], M33: ['V', 'G'], M34: ['V', 'G'], M35: ['VCESF', 'O'], M27: ['V', 'O'] },
  'ROL-DM': { M29: ['VSAX', 'L'], M30: ['VCEGX', 'L'], M31: ['V', 'L'], M32: ['VE', 'O'], M33: ['V', 'L'], M34: ['VCE', 'L'], M35: ['VA', 'L'] },
  'ROL-FIN': { M30: ['VCE', 'O'], M31: ['VCE', 'O'], M32: ['VCE', 'G'], M33: ['V', 'G'], M34: ['VAX', 'N'], M35: ['VAX', 'N'], M29: ['VCES', 'O'] },
  'ROL-FINV': { M30: ['VCE', 'O'], M31: ['VCE', 'O'], M35: ['VAEF', 'N'], M20: ['VCF', 'N'], M22: ['V', 'N'], M25: ['V', 'N'], M29: ['VCES', 'O'], M01: ['V', 'O'], M21: ['V', 'O'] },
  'ROL-PAY': { M30: ['VCE', 'O'], M31: ['VCE', 'O'], M35: ['VCSXF', 'N'], M20: ['VCF', 'N'], M22: ['V', 'N'], M25: ['V', 'N'], M29: ['VCES', 'O'], M01: ['V', 'O'], M21: ['V', 'O'] },
  'ROL-EVO': { M29: ['VC', 'O'], M30: ['VCEG', 'O'], M31: ['VCE', 'O'], M34: ['VCESGXF', 'O+D'], M35: ['V', 'O'], M03: ['V', 'G'], M04: ['V', 'G'], M05: ['V', 'G'], M06: ['V', 'G'], M02: ['VC', 'O'], M22: ['VX', 'O'], M20: ['VCEF', 'O'] },
  'ROL-ORGA': { M30: ['VG', 'G'], M31: ['V', 'G'], M32: ['VCE', 'G'], M33: ['VCEDX', 'G'], M24: ['VCE', 'G'], M26: ['V', 'G'] },
  'ROL-WFA': { M32: ['VCE', 'G'], M33: ['VCEDSX', 'G'], M15: ['VCEDS', 'G'], M24: ['V', 'G'], M25: ['V', 'G'], M26: ['V', 'G'] },
  'ROL-ADM': { M29: ['VCED', 'G'], M30: ['VCED', 'G'], M31: ['VCED', 'G'], M32: ['VCEDAE', 'G'], M33: ['VCEDX', 'G'], M34: ['VCED', 'G'], M35: ['V', 'G'], M15: ['VCEDSA', 'G'], M28: ['UK', 'G'], M27: ['V', 'G'] },
  'ROL-AUD': { M29: ['V', 'G'], M30: ['V', 'G'], M31: ['V', 'G'], M32: ['V', 'G'], M33: ['VX', 'G'], M34: ['V', 'G'], M35: ['VX', 'G'] },
  'ROL-ROE': { M29: ['VX', 'G'], M30: ['V', 'G'], M31: ['V', 'G'], M33: ['V', 'G'], M34: ['V', 'G'], M35: ['V', 'G'] },
  'ROL-EXT': { M29: ['VC', 'R'], M30: ['VCE', 'R'], M34: ['V', 'R'] },
  'ROL-SOP': { M29: ['VX', 'N'], M30: ['VCEGX', 'N'] }, 'ROL-CM': { M29: ['VX', 'N'], M35: ['VA', 'N'] }, 'ROL-SD': { M29: ['VX', 'G'] },
  'ROL-MKT': { M34: ['VCESX', 'G'] }, 'ROL-CPM': { M34: ['VCE', 'N'] },
};

async function seedRoles() {
  for (const [code, name, description] of ROLES) await q('INSERT INTO roles (code, name, description, internal) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING', [code, name, description, code !== 'ROL-EXT']);
  for (const [mod, byRole] of Object.entries(matrix.matrix)) {
    for (const [role, p] of Object.entries(byRole)) await q(`INSERT INTO permissions (role_code, module, actions, scope, note) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (role_code, module) DO NOTHING`, [role, mod, p.a, p.s, p.raw]);
  }
  for (const [role, mods] of Object.entries(EXTRA)) for (const [mod, [acts, scope]] of Object.entries(mods)) await q(`INSERT INTO permissions (role_code, module, actions, scope) VALUES ($1,$2,$3,$4) ON CONFLICT (role_code, module) DO NOTHING`, [role, mod, acts, scope]);
  // every existing role that can see the user directory needs M24 view of picklists only for SOP/FIN (already in matrix)
}

// --------------------------------------------------------------------- picklists
const PICK = {
  countries: [['KH', 'Cambodia'], ['VN', 'Vietnam'], ['TH', 'Thailand'], ['SG', 'Singapore'], ['MY', 'Malaysia'], ['ID', 'Indonesia'], ['PH', 'Philippines'], ['LA', 'Laos'], ['MM', 'Myanmar'], ['US', 'United States']],
  currencies: ['USD', 'KHR', 'VND', 'THB', 'SGD', 'MYR', 'EUR', 'JPY'].map((c) => [c, c]),
  lead_sources: ['Website', 'Referral', 'Partner referral', 'Event', 'Webinar', 'Campaign', 'Cold outreach', 'Existing customer', 'Vendor lead', 'Tender portal'].map((c) => [c, c]),
  industries: ['Banking & Finance', 'Telecommunications', 'Government', 'Education', 'Healthcare', 'Retail', 'Manufacturing', 'Logistics', 'Energy', 'Hospitality', 'Technology'].map((c) => [c, c]),
  segments: ['Enterprise', 'Mid-market', 'SMB', 'Public sector'].map((c) => [c, c]),
  disqualify_reasons: ['No budget', 'No need', 'Not decision maker', 'Competitor chosen', 'Unreachable', 'Out of territory', 'Duplicate', 'Other'].map((c) => [c, c]),
  loss_reasons: ['Price', 'Competitor', 'No budget', 'No decision', 'Technical fit', 'Timing', 'Vendor / supply issue', 'Other'].map((c) => [c, c]),
  buying_roles: ['Decision maker', 'Economic buyer', 'Influencer', 'Technical evaluator', 'User', 'Champion', 'Blocker'].map((c) => [c, c]),
  timezones: ['UTC', 'Asia/Phnom_Penh', 'Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York'].map((c) => [c, c]),
  quote_statuses: ['Draft', 'Submitted', 'Approved', 'Rejected', 'Sent', 'Accepted', 'Expired', 'Superseded', 'Cancelled'].map((c) => [c, c]),
  tax_code_list: [['VAT10', 'VAT10'], ['VAT0', 'VAT0'], ['EXEMPT', 'EXEMPT'], ['VN8', 'VN8'], ['TH7', 'TH7']],
};
const STAGES = [
  ['S01', 'New Opportunity', 5, 'Pipeline', ['S02', 'S12', 'S13'], 14, 'SE/AM'], ['S02', 'Qualification', 10, 'Pipeline', ['S03', 'S01', 'S12', 'S13'], 14, 'SE/AM'],
  ['S03', 'Discovery', 20, 'Pipeline', ['S04', 'S02', 'S12', 'S13'], 21, 'SE + PSE'], ['S04', 'Solution Design', 30, 'Pipeline', ['S05', 'S06', 'S07', 'S03', 'S12', 'S13'], 21, 'PSE'],
  ['S05', 'Presales Validation', 35, 'Pipeline', ['S06', 'S07', 'S04', 'S12', 'S13'], 14, 'PSE lead'], ['S06', 'Vendor Engagement', 40, 'Pipeline', ['S07', 'S04', 'S12', 'S13'], 21, 'SE / CPM / PRC'],
  ['S07', 'Quotation Preparation', 45, 'Best case', ['S08', 'S04', 'S05', 'S12', 'S13'], 14, 'SE / SOP'], ['S08', 'Proposal Submitted', 55, 'Best case', ['S09', 'S07', 'S12', 'S13'], 14, 'SE'],
  ['S09', 'Negotiation', 70, 'Best case', ['S10', 'S07', 'S12', 'S13'], 14, 'SE + SM'], ['S10', 'Verbal Commitment', 90, 'Commit', ['S11', 'S09', 'S12', 'S13'], 14, 'SE'],
  ['S11', 'Closed Won', 100, 'Closed', [], null, 'SE'], ['S12', 'Closed Lost', 0, 'Omitted', [], null, 'SE'], ['S13', 'On Hold', 0, 'Omitted', [], null, 'SE'],
];
async function seedPicklists() {
  for (const [list, items] of Object.entries(PICK)) { let i = 0; for (const [value, label] of items) await q('INSERT INTO picklists (list, value, label, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT (list, value) DO NOTHING', [list, value, label, i++]); }
  let i = 0; for (const s of STAGES) await q('INSERT INTO picklists (list, value, label, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT (list, value) DO NOTHING', ['opp_stages', s[0], `${s[0]} ${s[1]}`, i++]);
  for (const [code, name, prob, cat, next, inact, role] of STAGES) {
    await q(`INSERT INTO stage_definitions (pipeline, code, name, sort_order, probability, forecast_category, next_stages, inactivity_days, responsible_role, created_by, modified_by) VALUES ('Standard',$1,$2,$3,$4,$5,$6,$7,$8,1,1) ON CONFLICT (pipeline, code) WHERE is_deleted=false DO NOTHING`,
      [code, name, parseInt(code.slice(1), 10), prob, cat, J(next), inact, role]);
  }
}

const SETTINGS = [
  ['base_currency', 'USD', 'General', 'Corporate reporting currency'], ['company_name', 'Enterprise CRM Distribution Co.', 'General', 'Printed on customer quotations'],
  ['margin_floor_standard', 15, 'Commercial', 'GM% at/above which no margin approval is needed', true], ['margin_floor_manager', 10, 'Commercial', 'Floor approvable by the Sales Manager', true],
  ['margin_floor_country', 5, 'Commercial', 'Floor approvable by the Country Manager; below needs Finance', true], ['discount_sm_limit', 10, 'Commercial', 'Max discount % the manager band may approve', true],
  ['discount_cm_limit', 20, 'Commercial', 'Discount % above which Country Manager approval is needed', true], ['exec_threshold', 500000, 'Commercial', 'Deal value (base ccy) requiring executive approval when below standard margin', true],
  ['se_can_view_margin', true, 'Commercial', 'Sales Executives/Account Managers may see margin on own records (OQ-017)'], ['quotation_validity_days', 30, 'Commercial', 'Default quotation validity'],
  ['quotation_extension_days', 30, 'Commercial', 'Max extension without Finance approval'], ['probability_override_range', 15, 'General', 'Owner probability override range (± points)'],
  ['reopen_window_days', 90, 'General', 'Days after closure within which Sales Manager may reopen'], ['cancel_approval_threshold', 100000, 'General', 'Cancelling above this value needs manager'],
  ['require_deal_reg_indirect', true, 'General', 'Indirect deals need an approved deal registration before leaving Vendor Engagement'], ['no_quotation_types', ['Services'], 'General', 'Opportunity types allowed to close without a quotation (manager approval)'],
  ['lead_first_response_hours', 48, 'General', 'Lead first-response SLA'], ['renewal_lead_days', 90, 'General', 'Auto-create renewal opportunities this many days before expiry'],
  ['claim_limit_l1', 500, 'Claims', 'Claims above this need the manager of the manager', true], ['claim_limit_l2', 2000, 'Claims', 'Claims above this also need the Country Manager', true],
  ['claim_max_age_days', 60, 'Claims', 'Maximum age of an expense when claimed'], ['batch_authorise_threshold', 5000, 'Claims', 'Reimbursement batches above this need Finance authorisation', true],
  ['event_budget_l1', 5000, 'Events', 'Event budgets above this need Finance approval'], ['password_min_length', 10, 'Security', 'Minimum password length (informational; enforced in code)'],
];
async function seedSettings() {
  for (const [key, value, area, description, sensitive] of SETTINGS) {
    await q('INSERT INTO app_settings (key, value, area, description, sensitive) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO NOTHING', [key, J(value), area, description, !!sensitive]);
    await q(`INSERT INTO app_setting_versions (key, version, value, status) SELECT $1,1,$2,'Active' WHERE NOT EXISTS (SELECT 1 FROM app_setting_versions WHERE key=$1)`, [key, J(value)]);
  }
}

const M = (name, role, extra = {}) => ({ name, steps: [{ kind: 'role', role, ...extra }] });
async function seedProcesses() {
  const P = [
    ['Quotation approval', 'quotation', [
      { name: 'Margin below standard floor (manager band)', when: [{ field: 'gm_pct', op: '<', value: '@margin_floor_standard' }, { field: 'gm_pct', op: '>=', value: '@margin_floor_manager' }], steps: [{ kind: 'manager', label: 'Sales Manager', seq: 1, sla_hours: 24, fallback_role: 'ROL-SM' }] },
      { name: 'Margin below manager floor (Country Manager)', when: [{ field: 'gm_pct', op: '<', value: '@margin_floor_manager' }, { field: 'gm_pct', op: '>=', value: '@margin_floor_country' }], steps: [{ kind: 'role', role: 'ROL-CM', country_scoped: true, label: 'Country Manager', seq: 1, sla_hours: 24 }] },
      { name: 'Margin below country floor or negative (Finance + CM in parallel)', when: [{ field: 'gm_pct', op: '<', value: '@margin_floor_country' }], steps: [{ kind: 'role', role: 'ROL-FIN', country_scoped: true, label: 'Finance Approver', seq: 1, sla_hours: 24 }, { kind: 'role', role: 'ROL-CM', country_scoped: true, label: 'Country Manager', seq: 1, sla_hours: 24 }] },
      { name: 'Discount above manager limit', when: [{ field: 'max_discount_pct', op: '>', value: '@discount_sm_limit' }], steps: [{ kind: 'manager', label: 'Sales Manager', seq: 1, sla_hours: 24, fallback_role: 'ROL-SM' }] },
      { name: 'Discount above Country Manager limit', when: [{ field: 'max_discount_pct', op: '>', value: '@discount_cm_limit' }], steps: [{ kind: 'role', role: 'ROL-CM', country_scoped: true, label: 'Country Manager', seq: 1 }] },
      { name: 'Non-standard payment terms', when: [{ field: 'payment_terms_nonstandard', op: 'true' }], steps: [{ kind: 'role', role: 'ROL-FIN', country_scoped: true, label: 'Finance (payment terms)', seq: 1 }] },
      { name: 'Validity beyond cost validity / expired cost', when: [{ field: 'validity_beyond_cost', op: 'true' }], steps: [{ kind: 'role', role: 'ROL-FIN', country_scoped: true, label: 'Finance (cost validity)', seq: 1 }] },
      { name: 'Executive threshold with below-standard margin', when: [{ field: 'amount_base', op: '>', value: '@exec_threshold' }, { field: 'gm_pct', op: '<', value: '@margin_floor_standard' }], steps: [{ kind: 'role', role: 'ROL-SD', label: 'Sales Director (executive)', seq: 2, sla_hours: 48 }] },
    ]],
    ['Deal registration internal review', 'deal_registration', [
      { name: 'Channel review', when: [], steps: [{ kind: 'role', role: 'ROL-CPM', country_scoped: true, label: 'Channel Partner Manager', seq: 1, sla_hours: 24 }] },
      { name: 'Large deal', when: [{ field: 'amount_base', op: '>=', value: 250000 }], steps: [{ kind: 'role', role: 'ROL-CM', country_scoped: true, label: 'Country Manager', seq: 2 }] },
    ]],
    ['Partner onboarding', 'partner', [
      { name: 'Channel review', when: [], steps: [{ kind: 'role', role: 'ROL-CPM', label: 'Channel Partner Manager', seq: 1 }] },
      { name: 'Country approval', when: [], steps: [{ kind: 'role', role: 'ROL-CM', label: 'Country Manager', seq: 2 }] },
    ]],
    ['Expense claim approval', 'claim', [
      { name: 'Line manager', when: [], steps: [{ kind: 'manager', label: 'Line manager', seq: 1, sla_hours: 48, fallback_role: 'ROL-SM' }] },
      { name: 'Above limit L1: manager of manager', when: [{ field: 'amount_base', op: '>', value: '@claim_limit_l1' }], steps: [{ kind: 'manager', level: 2, label: 'Second-level manager', seq: 2, sla_hours: 48, fallback_role: 'ROL-CM' }] },
      { name: 'Above limit L2: Country Manager', when: [{ field: 'amount_base', op: '>', value: '@claim_limit_l2' }], steps: [{ kind: 'role', role: 'ROL-CM', country_scoped: true, label: 'Country Manager', seq: 3, sla_hours: 48 }] },
      { name: 'Finance verification', when: [], steps: [{ kind: 'role', role: 'ROL-FINV', country_scoped: true, label: 'Finance verification', seq: 4, sla_hours: 72 }] },
    ]],
    ['Sales target approval', 'target', [{ name: 'Sales Director approval', when: [], steps: [{ kind: 'role', role: 'ROL-SD', label: 'Sales Director', seq: 1 }] }]],
    ['Sensitive configuration change', 'config', [{ name: 'Sales Director approval of commercial/claims configuration', when: [], steps: [{ kind: 'role', role: 'ROL-SD', label: 'Sales Director', seq: 1 }] }]],
    ['Event budget approval', 'event', [
      { name: 'Manager approval', when: [], steps: [{ kind: 'manager', label: 'Line manager', seq: 1, fallback_role: 'ROL-SM' }] },
      { name: 'Finance approval above L1', when: [{ field: 'amount_base', op: '>', value: '@event_budget_l1' }], steps: [{ kind: 'role', role: 'ROL-FIN', country_scoped: true, label: 'Finance', seq: 2 }] },
    ]],
  ];
  for (const [name, type, rules] of P) {
    const ex = await one('SELECT id FROM approval_processes WHERE name=$1', [name]); if (ex) continue;
    const num = await nextNumber('WFD');
    await q(`INSERT INTO approval_processes (number, name, process_type, version_no, status, effective_from, rules, description, created_by, modified_by) VALUES ($1,$2,$3,1,'Active',current_date,$4,$5,1,1)`, [num, name, type, J(rules), `Default ${type} workflow (BRD §7.5)`]);
  }
}

async function seedIntegrations() {
  const L = [['INT-01', 'Email (M365 / Google Workspace)', 'Bi-directional', 4], ['INT-02', 'Calendar', 'Bi-directional', 4], ['INT-03', 'Document storage', 'Bi-directional', 4], ['INT-04', 'ERP - customer & order handover', 'CRM → ERP', 2],
    ['INT-05', 'ERP - status & financial data', 'ERP → CRM', 2], ['INT-06', 'ERP - stock availability', 'ERP → CRM', 4], ['INT-07', 'Vendor deal registration portals', 'Bi-directional', 4], ['INT-08', 'Vendor catalog & price feeds', 'Vendor → CRM', 3],
    ['INT-09', 'E-signature', 'Bi-directional', 4], ['INT-10', 'Identity provider (SSO / SCIM)', 'Bi-directional', 1], ['INT-11', 'FX rate feed', 'Provider → CRM', 2], ['INT-12', 'Payroll / HR (commission export)', 'CRM → Payroll', 3],
    ['INT-13', 'Project management tool', 'Bi-directional', 4], ['INT-14', 'ITSM / service desk', 'Bi-directional', 4], ['INT-15', 'Marketing automation', 'Bi-directional', 4], ['INT-16', 'Messaging platform (Teams / Slack)', 'CRM → Messaging', 4],
    ['INT-17', 'BI platform / data warehouse', 'CRM → BI', 3], ['INT-18', 'HR system (employees & org)', 'HR → CRM', 4], ['INT-19', 'Accounting / payment system (reimbursements)', 'Bi-directional', 3], ['INT-20', 'Corporate card feed', 'Card → CRM', 4],
    ['INT-21', 'OCR receipt service', 'Bi-directional', 4], ['INT-22', 'Online meeting platform', 'Bi-directional', 4], ['INT-23', 'Event registration / webinar platform', 'Bi-directional', 4]];
  for (const [code, name, dir, ph] of L) await q(`INSERT INTO integrations (code, name, direction, priority, status, created_by, modified_by) VALUES ($1,$2,$3,$4,'Not configured',1,1) ON CONFLICT (code) WHERE is_deleted=false DO NOTHING`, [code, name, dir, String(ph)]);
}

// ----------------------------------------------------------------- org & users
async function ins(table, o) {
  const cols = Object.keys(o);
  const { rows } = await q(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, cols.map((c) => (o[c] !== null && typeof o[c] === 'object' && !(o[c] instanceof Date) ? J(o[c]) : o[c])));
  return rows[0];
}
async function seedCore() {
  await q(`INSERT INTO exchange_rates (from_ccy,to_ccy,rate_type,rate,effective_date,rate_source,created_by,modified_by)
    SELECT * FROM (VALUES ('USD','KHR','Corporate',4100::numeric,'2026-01-01'::date,'Seed',1,1),('USD','VND','Corporate',25000,'2026-01-01','Seed',1,1),('USD','THB','Corporate',35,'2026-01-01','Seed',1,1),('USD','EUR','Corporate',0.92,'2026-01-01','Seed',1,1),
    ('USD','SGD','Corporate',1.35,'2026-01-01','Seed',1,1),('USD','MYR','Corporate',4.7,'2026-01-01','Seed',1,1),('USD','JPY','Corporate',150,'2026-01-01','Seed',1,1)) v(a,b,c,d,e,f,g,h)
    WHERE NOT EXISTS (SELECT 1 FROM exchange_rates)`);
  for (const [code, name, country, rate] of [['VAT10', 'Cambodia VAT 10%', 'KH', 10], ['VAT0', 'Zero rated', 'KH', 0], ['EXEMPT', 'Exempt', 'KH', 0], ['VN8', 'Vietnam VAT 8%', 'VN', 8], ['TH7', 'Thailand VAT 7%', 'TH', 7]])
    await q(`INSERT INTO tax_codes (code,name,country,rate,created_by,modified_by) VALUES ($1,$2,$3,$4,1,1) ON CONFLICT (code) WHERE is_deleted=false DO NOTHING`, [code, name, country, rate]);
}

const USERS = [
  // login, name, title, roles, country, team, manager login, approval limit
  ['admin', 'System Administrator', 'CRM Administrator', ['ROL-ADM'], 'KH', null, null, null],
  ['sd', 'Sophea Chan', 'Sales Director', ['ROL-SD'], 'KH', 'Sales Cambodia', null, 1000000],
  ['cm.kh', 'Vannak Heng', 'Country Manager - Cambodia', ['ROL-CM'], 'KH', 'Sales Cambodia', 'sd', 250000],
  ['sm.kh', 'Dara Sok', 'Sales Manager', ['ROL-SM'], 'KH', 'Enterprise Sales KH', 'cm.kh', 50000],
  ['se1', 'Sreyleak Kim', 'Sales Executive', ['ROL-SE'], 'KH', 'Enterprise Sales KH', 'sm.kh', null],
  ['se2', 'Rithy Pov', 'Sales Executive', ['ROL-SE'], 'KH', 'Enterprise Sales KH', 'sm.kh', null],
  ['am1', 'Channary Lim', 'Account Manager', ['ROL-AM'], 'KH', 'Enterprise Sales KH', 'sm.kh', null],
  ['pse1', 'Bunthoeun Ear', 'Presales Engineer', ['ROL-PSE'], 'KH', 'Presales KH', 'sm.kh', null],
  ['te1', 'Piseth Mao', 'Technical Engineer', ['ROL-TE'], 'KH', 'Presales KH', 'pse1', null],
  ['sop1', 'Malis Thy', 'Sales Operations', ['ROL-SOP'], 'KH', 'Sales Cambodia', 'cm.kh', null],
  ['fin1', 'Kosal Meas', 'Finance Approver', ['ROL-FIN'], 'KH', 'Finance', 'cm.kh', 250000],
  ['finv1', 'Chantha Roeun', 'Finance Verifier', ['ROL-FINV'], 'KH', 'Finance', 'fin1', null],
  ['pay1', 'Vireak Ngin', 'Payment Officer', ['ROL-PAY'], 'KH', 'Finance', 'fin1', null],
  ['prc1', 'Sovann Keo', 'Procurement', ['ROL-PRC'], 'KH', 'Procurement', 'cm.kh', null],
  ['mkt1', 'Nary Chhun', 'Marketing Specialist', ['ROL-MKT'], 'KH', 'Marketing', 'cm.kh', null],
  ['cpm1', 'Samnang Ouk', 'Channel Partner Manager', ['ROL-CPM'], 'KH', 'Channel', 'cm.kh', null],
  ['aud1', 'Auditor Internal', 'Internal Auditor', ['ROL-AUD'], 'KH', null, null, null],
  ['roe1', 'Executive Viewer', 'Chief Executive', ['ROL-ROE'], 'KH', null, null, null],
  ['evo1', 'Bopha Seng', 'Event Organizer', ['ROL-EVO', 'ROL-MKT'], 'KH', 'Marketing', 'cm.kh', null],
  ['orga1', 'Org Administrator', 'Organization Administrator', ['ROL-ORGA'], 'KH', null, 'cm.kh', null],
  ['wfa1', 'Workflow Administrator', 'Workflow Administrator', ['ROL-WFA'], 'KH', null, 'cm.kh', null],
  ['cm.vn', 'Nguyen Minh', 'Country Manager - Vietnam', ['ROL-CM'], 'VN', 'Sales Vietnam', 'sd', 250000],
  ['se3', 'Tran Hoa', 'Sales Executive (VN)', ['ROL-SE'], 'VN', 'Sales Vietnam', 'cm.vn', null],
  ['ext1', 'Partner User (TechBridge)', 'Partner Sales', ['ROL-EXT'], 'KH', null, null, null],
];

async function seedUsers() {
  const exists = await one('SELECT count(*)::int n FROM users'); if (exists.n > 0) return false;
  const ou = {}; for (const [n, c] of [['Enterprise CRM Cambodia Ltd', 'KH'], ['Enterprise CRM Vietnam Co', 'VN']]) ou[c] = (await ins('org_units', { name: n, country: c, base_currency: 'USD', created_by: 1 })).id;
  const bu = {}; for (const n of ['Infrastructure', 'Software', 'Services']) bu[n] = (await ins('business_units', { name: n, org_unit_id: ou.KH, margin_floor_pct: 15 })).id;
  const br = {}; for (const [n, c] of [['Phnom Penh HQ', 'KH'], ['Siem Reap', 'KH'], ['Ho Chi Minh City', 'VN']]) br[n] = (await ins('branches', { name: n, org_unit_id: ou[c], country: c })).id;
  const teams = {};
  for (const [n, parent, b] of [['Sales Cambodia', null, 'Phnom Penh HQ'], ['Enterprise Sales KH', 'Sales Cambodia', 'Phnom Penh HQ'], ['Presales KH', 'Sales Cambodia', 'Phnom Penh HQ'], ['Finance', null, 'Phnom Penh HQ'], ['Procurement', null, 'Phnom Penh HQ'], ['Marketing', null, 'Phnom Penh HQ'], ['Channel', null, 'Phnom Penh HQ'], ['Sales Vietnam', null, 'Ho Chi Minh City']])
    teams[n] = (await ins('teams', { name: n, parent_id: parent ? teams[parent] : null, branch_id: br[b], bu_id: bu.Infrastructure })).id;
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10); const ids = {};
  const { rows: roles } = await q('SELECT id, code FROM roles'); const rid = Object.fromEntries(roles.map((r) => [r.code, r.id]));
  for (const [login, name, title, rs, country, team, mgr, limit] of USERS) {
    const u = await ins('users', { login, email: `${login.replace(/\./g, '')}@crm.demo`, name, password_hash: hash, status: 'Active', user_type: login === 'ext1' ? 'external' : 'internal', job_title: title, country, org_unit_id: ou[country] || ou.KH,
      branch_id: country === 'VN' ? br['Ho Chi Minh City'] : br['Phnom Penh HQ'], bu_id: bu.Infrastructure, team_id: team ? teams[team] : null, manager_id: mgr ? ids[mgr] : null, approval_limit: limit, time_zone: country === 'VN' ? 'Asia/Ho_Chi_Minh' : 'Asia/Phnom_Penh', created_by: 1, modified_by: 1 });
    ids[login] = u.id;
    for (const r of rs) await q('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)', [u.id, rid[r]]);
    if (mgr) await q(`INSERT INTO reporting_lines (employee_id, manager_id, purpose, effective_from, reason) VALUES ($1,$2,'Primary','2026-01-01','Initial assignment')`, [u.id, ids[mgr]]);
  }
  for (const [t, m] of [['Sales Cambodia', 'cm.kh'], ['Enterprise Sales KH', 'sm.kh'], ['Presales KH', 'pse1'], ['Finance', 'fin1'], ['Sales Vietnam', 'cm.vn']]) await q('UPDATE teams SET manager_id=$1 WHERE id=$2', [ids[t === 'Sales Cambodia' ? m : m], teams[t]]);
  return { ids, ou, bu, br, teams };
}

module.exports = { run: null };
const E = module.exports;

async function seedCatalog() {
  if ((await one('SELECT count(*)::int n FROM vendors')).n > 0) return;
  const adm = (await one(`SELECT id FROM users WHERE login='admin'`)).id; const prc = (await one(`SELECT id FROM users WHERE login='prc1'`)).id;
  const V = {};
  for (const [code, name, min, days] of [['DELL', 'Dell Technologies', 25000, 90], ['HPE', 'Hewlett Packard Enterprise', 25000, 90], ['CISCO', 'Cisco Systems', 15000, 120], ['MSFT', 'Microsoft', 10000, 180], ['FTNT', 'Fortinet', 10000, 90], ['VMW', 'VMware by Broadcom', 20000, 90]]) {
    const n = await nextNumber('VEN'); V[code] = (await ins('vendors', { number: n, owner_id: prc, code, name, status: 'Active', country: 'US', currency: 'USD', min_deal_value: min, reg_protection_days: days, reg_max_renewals: 1, created_by: adm, modified_by: adm })).id;
  }
  const C = {}; for (const n of ['Servers', 'Storage', 'Networking', 'Security', 'Software & Licences', 'Cloud & Subscriptions', 'Professional Services']) C[n] = (await ins('product_categories', { name: n, margin_floor_pct: 12, created_by: adm, modified_by: adm })).id;
  const P = [
    ['DELL', 'Servers', 'PE-R760', 'Dell PowerEdge R760 Rack Server (2x Xeon, 256GB, 8x2.4TB)', 'Hardware', 11800, 9400, false],
    ['DELL', 'Servers', 'PE-R660', 'Dell PowerEdge R660 Rack Server (1x Xeon, 128GB)', 'Hardware', 7200, 5700, false],
    ['DELL', 'Storage', 'ME5024', 'Dell PowerVault ME5024 Storage Array 24x1.92TB SSD', 'Hardware', 38500, 30800, false],
    ['DELL', 'Servers', 'PS-5YR', 'ProSupport Plus 5-Year Next Business Day (per server)', 'Support / maintenance', 1250, 820, true],
    ['HPE', 'Servers', 'DL380G11', 'HPE ProLiant DL380 Gen11 (2x Xeon, 256GB)', 'Hardware', 12400, 9900, false],
    ['HPE', 'Storage', 'MSA2062', 'HPE MSA 2062 SAN Storage 12x1.92TB SSD', 'Hardware', 29800, 23600, false],
    ['CISCO', 'Networking', 'C9300-48P', 'Cisco Catalyst 9300 48-port PoE+ Switch', 'Hardware', 6900, 5100, false],
    ['CISCO', 'Networking', 'C9200-24T', 'Cisco Catalyst 9200 24-port Switch', 'Hardware', 3100, 2250, false],
    ['CISCO', 'Networking', 'DNA-ADV-3Y', 'Cisco DNA Advantage 3-Year Licence (per switch)', 'Subscription', 1500, 1020, true],
    ['FTNT', 'Security', 'FG-200F', 'FortiGate 200F Next-Gen Firewall', 'Hardware', 5400, 3700, false],
    ['FTNT', 'Security', 'FC-UTP-1Y', 'FortiGuard UTP Bundle (per firewall / year)', 'Subscription', 1900, 1130, true],
    ['FTNT', 'Security', 'FAZ-VM', 'FortiAnalyzer VM Licence', 'Software', 4200, 2800, false],
    ['MSFT', 'Software & Licences', 'WS-DC-16', 'Windows Server 2022 Datacenter 16-core', 'Software', 6155, 5100, false],
    ['MSFT', 'Cloud & Subscriptions', 'M365-E3', 'Microsoft 365 E3 (per user / month)', 'Subscription', 36, 31, true],
    ['MSFT', 'Cloud & Subscriptions', 'AZ-COMMIT', 'Azure Consumption Commitment (per $1 spend)', 'Cloud', 1, 0.85, false],
    ['VMW', 'Software & Licences', 'VCF-CORE', 'VMware Cloud Foundation (per core / year)', 'Subscription', 350, 245, true],
    [null, 'Professional Services', 'SVC-IMPL', 'Implementation & configuration service (per day)', 'Professional service', 650, 380, false],
    [null, 'Professional Services', 'SVC-PM', 'Project management service (per day)', 'Professional service', 720, 430, false],
    [null, 'Professional Services', 'SVC-TRAIN', 'Administrator training (per class)', 'Professional service', 2400, 1300, false],
  ];
  const prods = {};
  for (const [v, cat, sku, name, type, price, cost, rec] of P) {
    const p = await ins('products', { vendor_id: v ? V[v] : null, category_id: C[cat], sku, name, product_type: type, uom: type === 'Professional service' ? 'Day' : 'Each', status: 'Active', list_price: price, currency: 'USD', recurring: rec, billing_months: rec ? (sku === 'M365-E3' ? 1 : 12) : 1,
      default_term_months: rec ? (sku === 'M365-E3' ? 12 : sku.includes('3Y') ? 36 : sku.includes('5YR') ? 60 : 12) : 12, standard_cost: cost, tax_code: type === 'Professional service' ? 'VAT10' : 'VAT10', created_by: adm, modified_by: adm });
    prods[sku] = p.id;
    if (v && !rec) await ins('cost_records', { product_id: p.id, vendor_id: V[v], cost, currency: 'USD', cost_source: 'Vendor price list', valid_from: '2026-01-01', valid_to: '2027-06-30', min_qty: 1, created_by: adm, modified_by: adm });
    await ins('price_records', { product_id: p.id, price_list: 'List', price, currency: 'USD', min_qty: 1, valid_from: '2026-01-01', created_by: adm, modified_by: adm });
  }
  E.catalog = { V, prods };
}

// --------------------------------------------------------------------- demo data
async function seedDemo() {
  if ((await one('SELECT count(*)::int n FROM accounts')).n > 0) return;
  const { rows: us } = await q('SELECT id, login, country, manager_id, team_id, bu_id, branch_id FROM users'); const U = Object.fromEntries(us.map((u) => [u.login, u]));
  const bu = (await one(`SELECT id FROM business_units WHERE name='Infrastructure'`)).id; const bu2 = (await one(`SELECT id FROM business_units WHERE name='Software'`)).id; const bu3 = (await one(`SELECT id FROM business_units WHERE name='Services'`)).id;
  const { rows: pr } = await q('SELECT id, sku FROM products'); const P = Object.fromEntries(pr.map((p) => [p.sku, p.id]));
  const { rows: vs } = await q('SELECT id, code FROM vendors'); const V = Object.fromEntries(vs.map((v) => [v.code, v.id]));
  const STD = (o) => ({ created_by: o.owner_id, modified_by: o.owner_id, ...o });

  // ---- accounts
  const A_ = {};
  const accDefs = [
    ['mekongbank', 'Mekong Digital Bank Plc', 'KH', 'Banking & Finance', 'Enterprise', 'Strategic', 'se1', 'Customer', 'K001-001', 'Phnom Penh'],
    ['angkortel', 'Angkor Telecom Co., Ltd', 'KH', 'Telecommunications', 'Enterprise', 'Strategic', 'se1', 'Customer', 'K001-002', 'Phnom Penh'],
    ['moe', 'Ministry of Education, Youth and Sport', 'KH', 'Government', 'Public sector', 'Key', 'se2', 'Prospect', null, 'Phnom Penh'],
    ['ppl', 'Phnom Penh Logistics Group', 'KH', 'Logistics', 'Mid-market', 'Standard', 'se2', 'Customer', 'K001-004', 'Phnom Penh'],
    ['sr_hotel', 'Siem Reap Grand Hospitality', 'KH', 'Hospitality', 'Mid-market', 'Standard', 'am1', 'Customer', 'K001-005', 'Siem Reap'],
    ['khmerfoods', 'Khmer Foods Manufacturing', 'KH', 'Manufacturing', 'Mid-market', 'Standard', 'se1', 'Prospect', null, 'Kandal'],
    ['nat_hosp', 'National Referral Hospital', 'KH', 'Healthcare', 'Public sector', 'Key', 'se2', 'Customer', 'K001-007', 'Phnom Penh'],
    ['cambu', 'Cambu University', 'KH', 'Education', 'Enterprise', 'Standard', 'am1', 'Customer', 'K001-008', 'Phnom Penh'],
    ['saigonretail', 'Saigon Retail Group JSC', 'VN', 'Retail', 'Enterprise', 'Key', 'se3', 'Prospect', 'V002-001', 'Ho Chi Minh City'],
    ['vnenergy', 'Vietnam Green Energy Corp', 'VN', 'Energy', 'Enterprise', 'Key', 'se3', 'Customer', 'V002-002', 'Hanoi'],
  ];
  for (const [k, name, country, ind, seg, tier, owner, type, tax, city] of accDefs) {
    const n = await nextNumber('ACC'); A_[k] = (await ins('accounts', STD({ number: n, owner_id: U[owner].id, legal_name: name, country, industry: ind, segment: seg, tier, account_type: type, status: 'Active', tax_id: tax, city, bu_id: bu, branch_id: U[owner].branch_id, is_government: seg === 'Public sector' }))).id;
  }
  await q(`UPDATE accounts SET credit_limit=500000, outstanding_balance=42000 WHERE id=$1`, [A_.mekongbank]);
  // ---- contacts
  const C_ = {};
  const conDefs = [['mb_cio', 'Vichet', 'Lay', 'mekongbank', 'Chief Information Officer', 'vichet.lay@mekongbank.example', 'se1', 'Decision maker'], ['mb_it', 'Sophal', 'Nhem', 'mekongbank', 'Head of Infrastructure', 'sophal.nhem@mekongbank.example', 'se1', 'Technical evaluator'],
    ['at_cto', 'Kanha', 'Prum', 'angkortel', 'CTO', 'kanha.prum@angkortel.example', 'se1', 'Decision maker'], ['moe_dir', 'Dr. Sambath', 'Hun', 'moe', 'Director of ICT Department', 'sambath.hun@moe.example', 'se2', 'Decision maker'],
    ['ppl_it', 'Rotha', 'Seng', 'ppl', 'IT Manager', 'rotha.seng@ppl.example', 'se2', 'Influencer'], ['srh_gm', 'Linda', 'Tan', 'sr_hotel', 'General Manager', 'linda.tan@srgrand.example', 'am1', 'Economic buyer'],
    ['kf_ops', 'Makara', 'Chea', 'khmerfoods', 'Operations Director', 'makara.chea@khmerfoods.example', 'se1', 'Decision maker'], ['nh_it', 'Dr. Veasna', 'Ly', 'nat_hosp', 'Head of IT', 'veasna.ly@nrh.example', 'se2', 'Decision maker'],
    ['cu_reg', 'Sokha', 'Ung', 'cambu', 'Registrar', 'sokha.ung@cambu.example', 'am1', 'Economic buyer'], ['sg_cio', 'Pham', 'Quang', 'saigonretail', 'CIO', 'quang.pham@saigonretail.example', 'se3', 'Decision maker'], ['ve_it', 'Le', 'Thanh', 'vnenergy', 'IT Director', 'thanh.le@vngreen.example', 'se3', 'Economic buyer']];
  for (const [k, f, l, acc, title, email, owner] of conDefs) { const n = await nextNumber('CON'); C_[k] = (await ins('contacts', STD({ number: n, owner_id: U[owner].id, first_name: f, last_name: l, full_name: `${f} ${l}`, account_id: A_[acc], job_title: title, email, phone: '+855 23 555 ' + String(Math.floor(Math.random() * 900) + 100), status: 'Active', consent_email: true, consent_date: day(-60) }))).id; }
  // ---- partners
  const PT = {};
  for (const [k, name, type, tier, status, vend] of [['tb', 'TechBridge Solutions', 'System integrator', 'Gold', 'Active', ['DELL', 'CISCO', 'FTNT']], ['cn', 'CloudNet Partners', 'Reseller', 'Silver', 'Active', ['MSFT', 'VMW']], ['ds', 'Delta Systems', 'Reseller', 'Registered', 'Active', ['HPE', 'CISCO']], ['ng', 'NextGen IT Services', 'MSP', 'Registered', 'Applied', []]]) {
    const n = await nextNumber('PRT'); PT[k] = (await ins('partners', STD({ number: n, owner_id: U.cpm1.id, name, country: 'KH', partner_type: type, tier, status, tax_id: k === 'ng' ? null : `P-${k}-001`, authorised_vendors: vend.map((c) => V[c]), agreement_start: status === 'Active' ? '2026-01-01' : null, onboarded_at: status === 'Active' ? ts(-200) : null, annual_target: 400000 }))).id;
  }
  await q('UPDATE users SET partner_id=$1 WHERE login=$2', [PT.tb, 'ext1']);
  await ins('partner_certifications', { partner_id: PT.tb, vendor_id: V.DELL, name: 'Dell Titanium Partner', issued_on: '2026-01-15', expires_on: day(200), status: 'Valid', created_by: U.cpm1.id, modified_by: U.cpm1.id });
  await ins('partner_certifications', { partner_id: PT.tb, vendor_id: V.CISCO, name: 'Cisco Gold Integrator', issued_on: '2025-03-01', expires_on: day(25), status: 'Expiring', created_by: U.cpm1.id, modified_by: U.cpm1.id });
  // ---- campaigns & leads
  const CMP = {};
  for (const [k, name, type, status, owner, budget] of [['sec', 'Cybersecurity Roadshow 2026', 'Roadshow', 'Active', 'mkt1', 15000], ['cloud', 'Cloud Migration Webinar Series', 'Webinar', 'Completed', 'mkt1', 4000], ['partner', 'Partner Summit Phnom Penh', 'Partner programme', 'Planned', 'cpm1', 20000]]) {
    const n = await nextNumber('CMP'); CMP[k] = (await ins('campaigns', STD({ number: n, owner_id: U[owner].id, name, campaign_type: type, status, start_date: day(-90), end_date: day(60), budget }))).id;
  }
  const leads = [['Tonle Sap Aquaculture', 'Bora', 'Heng', 'Event', 'se1', 'Qualified', 'Confirmed', 'Decision maker', 'Defined', '< 6 months', 'Partial', 45000, 'sec'], ['Koh Kong Energy', 'Sambo', 'Tith', 'Website', 'se2', 'Working', 'Indicated', 'Influencer', 'Defined', '6-12 months', 'Partial', 80000, null],
    ['Battambang Rice Exports', 'Chenda', 'Phan', 'Referral', 'se2', 'New', 'Unknown', 'Unknown', 'Unclear', 'Unknown', 'Unknown', 20000, null], ['Kampot Pepper Co', 'Rina', 'Soth', 'Campaign', 'se1', 'Working', 'Indicated', 'User', 'Defined', '6-12 months', 'Full', 12000, 'sec'],
    ['Cambodia Post Services', 'Vuthy', 'Kao', 'Tender portal', 'se1', 'Qualified', 'Confirmed', 'Economic buyer', 'Urgent', '< 3 months', 'Full', 150000, null], ['Preah Sihanouk Port Authority', 'Dane', 'Ros', 'Partner referral', 'se2', 'New', 'Unknown', 'Influencer', 'Defined', '6-12 months', 'Unknown', 95000, null],
    ['Hanoi Smart Logistics', 'Linh', 'Do', 'Webinar', 'se3', 'Working', 'Indicated', 'Decision maker', 'Defined', '< 6 months', 'Partial', 60000, 'cloud'], ['Mobile Money Cambodia', 'Sopheak', 'Yim', 'Event', 'se1', 'Disqualified', 'None', 'User', 'Unclear', 'Unknown', 'None', 5000, 'sec']];
  for (const [co, f, l, src, owner, status, bb, ba, bn, bt, bf, val, cmp] of leads) {
    const n = await nextNumber('LEAD'); const { scoreLead } = require('./modules/leads');
    const rec = { number: n, owner_id: U[owner].id, company: co, first_name: f, last_name: l, email: `${f.toLowerCase()}@${co.toLowerCase().replace(/[^a-z]/g, '')}.example`, phone: '+855 12 345 ' + Math.floor(Math.random() * 900 + 100), country: owner === 'se3' ? 'VN' : 'KH', source: src, status, est_value: val, currency: 'USD', bant_budget: bb, bant_authority: ba, bant_need: bn, bant_timeline: bt, bant_tech_fit: bf, campaign_id: cmp ? CMP[cmp] : null, assigned_at: ts(-4), interest: 'Infrastructure modernisation', disqualify_reason: status === 'Disqualified' ? 'No budget' : null, first_response_at: status === 'New' ? null : ts(-3) };
    rec.score = scoreLead(rec); await ins('leads', STD(rec));
  }

  // ---- opportunities
  const mk = async (key, name, acc, owner, type, route, source, stage, amount, closeOff, opts = {}) => {
    const st = await one(`SELECT probability, forecast_category FROM stage_definitions WHERE code=$1 AND pipeline='Standard'`, [stage]);
    const status = opts.status || 'Open'; const n = await nextNumber('OPP'); const base = await fx.toBase(amount, opts.currency || 'USD');
    const created = opts.created || ts(-60);
    const o = await ins('opportunities', STD({ number: n, owner_id: U[owner].id, name, account_id: A_[acc], opp_type: type, route, source, stage, status, probability: opts.prob ?? st.probability, forecast_category: opts.cat || (status === 'Won' ? 'Closed' : ['Lost', 'Cancelled'].includes(status) ? 'Omitted' : st.forecast_category),
      amount, currency: opts.currency || 'USD', amount_base: base, cost: opts.cost || null, gross_profit: opts.cost ? base - opts.cost : null, close_date: day(closeOff), bu_id: opts.bu || bu, branch_id: U[owner].branch_id, country: U[owner].country, primary_partner_id: opts.partner ? PT[opts.partner] : null,
      budget_status: opts.budget || 'Indicated', authority: opts.authority || 'Influencer', need_status: 'Defined', timeline_months: 6, technical_fit: 'Partial', procurement_method: 'Quotation request', business_need: 'Modernise and secure core infrastructure', decision_date: day(closeOff - 10),
      next_step: opts.next || 'Follow up with stakeholder', stage_entered_at: opts.entered || ts(-10), last_activity_at: opts.lastAct || ts(-3), closed_at: ['Won', 'Lost', 'Cancelled'].includes(status) ? ts(opts.closedOff ?? -10) : null, loss_reason: opts.loss || null, loss_competitor: opts.competitor || null, po_number: status === 'Won' ? `PO-${Math.floor(Math.random() * 90000 + 10000)}` : null, po_date: status === 'Won' ? day(opts.closedOff ?? -10) : null,
      close_date_changes: opts.slips || 0, created_at: created }));
    await q('INSERT INTO opportunity_stage_history (opportunity_id, from_stage, to_stage, changed_by, changed_at, probability, amount) VALUES ($1,NULL,$2,$3,$4,$5,$6)', [o.id, 'S01', U[owner].id, created, 5, base]);
    if (stage !== 'S01') await q('INSERT INTO opportunity_stage_history (opportunity_id, from_stage, to_stage, changed_by, changed_at, probability, amount) VALUES ($1,$2,$3,$4,$5,$6,$7)', [o.id, 'S01', stage, U[owner].id, opts.entered || ts(-10), st.probability, base]);
    return o.id;
  };
  const O = {};
  O.core = await mk('core', 'Core Banking Infrastructure Refresh', 'mekongbank', 'se1', 'New business', 'Direct', 'Referral', 'S07', 385000, 21, { cost: 310000, cat: 'Best case', next: 'Quotation approval pending', lastAct: ts(-1) });
  O.dc = await mk('dc', 'Data Centre Expansion - Tier III', 'angkortel', 'se1', 'Project / tender', 'Direct', 'Existing customer', 'S09', 620000, 14, { cost: 500000, cat: 'Commit', authority: 'Economic buyer', budget: 'Confirmed', lastAct: ts(-2) });
  O.sd = await mk('sd', 'National School Network Upgrade', 'moe', 'se2', 'Project / tender', 'Indirect', 'Tender portal', 'S06', 450000, 60, { partner: 'tb', slips: 3, lastAct: ts(-2) });
  O.fw = await mk('fw', 'Perimeter Security Refresh', 'ppl', 'se2', 'Upsell / cross-sell', 'Direct', 'Existing customer', 'S08', 68000, 12, { cost: 51000, cat: 'Best case', lastAct: ts(-1) });
  O.hotel = await mk('hotel', 'Hotel WiFi & Network Modernisation', 'sr_hotel', 'am1', 'Upsell / cross-sell', 'Direct', 'Existing customer', 'S04', 54000, 45, { lastAct: ts(-1) });
  O.foods = await mk('foods', 'Smart Factory Connectivity', 'khmerfoods', 'se1', 'New business', 'Direct', 'Event', 'S02', 95000, 80, { lastAct: ts(-20), created: ts(-45), entered: ts(-30) });
  O.hosp = await mk('hosp', 'Hospital Information System Servers', 'nat_hosp', 'se2', 'Project / tender', 'Indirect', 'Partner referral', 'S05', 210000, 50, { partner: 'ds', lastAct: ts(-3) });
  O.uni = await mk('uni', 'Campus Virtualisation (VCF)', 'cambu', 'am1', 'New business', 'Indirect', 'Partner referral', 'S10', 130000, 9, { partner: 'cn', cat: 'Commit', authority: 'Economic buyer', budget: 'Confirmed', lastAct: ts(-1) });
  O.retail = await mk('retail', 'Retail POS Cloud Backbone', 'saigonretail', 'se3', 'New business', 'Direct', 'Webinar', 'S03', 175000, 90, { bu: bu2, currency: 'USD', lastAct: ts(-4) });
  O.energy = await mk('energy', 'Smart Grid Security Gateway', 'vnenergy', 'se3', 'Upsell / cross-sell', 'Direct', 'Existing customer', 'S08', 240000, 25, { cost: 180000, cat: 'Best case', lastAct: ts(-2) });
  O.mb2 = await mk('mb2', 'Mobile Banking DR Site', 'mekongbank', 'se1', 'New business', 'Direct', 'Referral', 'S01', 150000, 120, { lastAct: ts(-1), created: ts(-5), entered: ts(-5), budget: 'Unknown', authority: 'Unknown' });
  O.won1 = await mk('won1', 'Storage Array Replacement', 'ppl', 'se2', 'Upsell / cross-sell', 'Direct', 'Existing customer', 'S11', 128000, -12, { status: 'Won', cost: 98000, closedOff: -12, created: ts(-80) });
  O.won2 = await mk('won2', 'Switching Core Upgrade', 'cambu', 'am1', 'New business', 'Indirect', 'Partner referral', 'S11', 76000, -25, { status: 'Won', cost: 58000, partner: 'tb', closedOff: -25, created: ts(-100) });
  O.won3 = await mk('won3', 'M365 Enterprise Rollout', 'mekongbank', 'se1', 'New business', 'Direct', 'Referral', 'S11', 92000, -35, { status: 'Won', cost: 79000, bu: bu2, closedOff: -35, created: ts(-120) });
  O.lost1 = await mk('lost1', 'Backup & Recovery Platform', 'angkortel', 'se1', 'New business', 'Direct', 'Referral', 'S12', 140000, -18, { status: 'Lost', loss: 'Competitor', competitor: 'Huawei', closedOff: -18, created: ts(-90) });
  O.lost2 = await mk('lost2', 'Wireless Controller Refresh', 'nat_hosp', 'se2', 'Upsell / cross-sell', 'Direct', 'Existing customer', 'S12', 38000, -40, { status: 'Lost', loss: 'Price', closedOff: -40, created: ts(-110) });
  O.svc = await mk('svc', 'Managed Network Operations', 'ppl', 'se2', 'Services', 'Direct', 'Existing customer', 'S09', 72000, 20, { bu: bu3, cat: 'Best case', lastAct: ts(-1) });
  // stakeholders, team, competitors, partners/vendors
  for (const [oid, ct, role] of [[O.core, 'mb_cio', 'Decision maker'], [O.core, 'mb_it', 'Technical evaluator'], [O.dc, 'at_cto', 'Decision maker'], [O.sd, 'moe_dir', 'Decision maker'], [O.hosp, 'nh_it', 'Decision maker'], [O.uni, 'cu_reg', 'Economic buyer'], [O.energy, 've_it', 'Economic buyer'], [O.retail, 'sg_cio', 'Decision maker'], [O.fw, 'ppl_it', 'Influencer']])
    await ins('opportunity_contacts', { opportunity_id: oid, contact_id: C_[ct], buying_role: role, attitude: 'Supporter', influence: 'High', created_by: 1, modified_by: 1 });
  for (const [oid, who, role] of [[O.core, 'pse1', 'Presales'], [O.dc, 'pse1', 'Presales'], [O.sd, 'pse1', 'Presales'], [O.hosp, 'pse1', 'Presales'], [O.core, 'sm.kh', 'Executive sponsor']])
    await ins('opportunity_team', { opportunity_id: oid, user_id: U[who].id, team_role: role, access_level: 'Read-Write', created_by: 1, modified_by: 1 });
  for (const [oid, comp] of [[O.core, 'Huawei'], [O.dc, 'Schneider Electric'], [O.sd, 'ZTE'], [O.hosp, 'None known']]) await ins('opportunity_competitors', { opportunity_id: oid, competitor: comp, incumbent: false, created_by: 1, modified_by: 1 });
  for (const [oid, partner, vendor] of [[O.sd, 'tb', 'CISCO'], [O.hosp, 'ds', 'HPE'], [O.uni, 'cn', 'VMW'], [O.core, null, 'DELL'], [O.fw, null, 'FTNT']]) await ins('opportunity_partners', { opportunity_id: oid, partner_id: partner ? PT[partner] : null, partner_role: 'Fulfilment', is_primary: !!partner, vendor_id: V[vendor], created_by: 1, modified_by: 1 }).catch(async () => {});

  // ---- deal registrations (incl. a conflict)
  const dr = async (opp, vendor, partner, status, value, owner, extra = {}) => { const n = await nextNumber('DRG'); return ins('deal_registrations', STD({ number: n, owner_id: U[owner].id, opportunity_id: O[opp], vendor_id: V[vendor], partner_id: PT[partner], account_id: (await one('SELECT account_id FROM opportunities WHERE id=$1', [O[opp]])).account_id, status, deal_value: value, currency: 'USD', policy_version: 1, ...extra })); };
  await dr('sd', 'CISCO', 'tb', 'Vendor approved', 450000, 'se2', { vendor_ref: 'CSC-8841223', protection_start: day(-30), protection_end: day(28), conflict_status: 'None', justification: 'Tender-based network upgrade' });
  await dr('hosp', 'HPE', 'ds', 'Under internal review', 210000, 'se2', { conflict_status: 'Open', justification: 'Hospital HIS server tender' });
  const hospAcc = (await one('SELECT account_id FROM opportunities WHERE id=$1', [O.hosp])).account_id;
  await ins('deal_registrations', STD({ number: await nextNumber('DRG'), owner_id: U.cpm1.id, opportunity_id: O.hosp, vendor_id: V.HPE, partner_id: PT.tb, account_id: hospAcc, status: 'Submitted to vendor', deal_value: 195000, currency: 'USD', policy_version: 1, conflict_status: 'Open', justification: 'Competing registration by another partner' }));

  // ---- sizing: requirement, config + BOM for core banking
  const tr = await ins('tech_requirements', STD({ number: await nextNumber('TRQ'), owner_id: U.pse1.id, opportunity_id: O.core, title: 'Core banking compute & storage', template: 'Server / compute', status: 'Captured', workload: 'Core banking + card switch, 99.99% availability', users_count: 1200, capacity: '16 hosts, 400TB usable', availability: '99.99%' }));
  const cfg = await ins('solution_configs', STD({ number: await nextNumber('CFG'), owner_id: U.pse1.id, opportunity_id: O.core, requirement_id: tr.id, name: 'Option A - Dell PowerEdge cluster', version_no: 1, status: 'Validated', validated_by: U.te1.id, validated_at: ts(-5), assumptions: 'Existing network is 25GbE ready', exclusions: 'Facility works' }));
  for (const [sku, qty, desc] of [['PE-R760', 16, 'Dell PowerEdge R760 compute node'], ['ME5024', 4, 'Dell PowerVault ME5024 storage array'], ['PS-5YR', 16, 'ProSupport Plus 5Y (per server)'], ['SVC-IMPL', 60, 'Implementation service (days)']])
    await ins('bom_lines', { config_id: cfg.id, product_id: P[sku], description: desc, quantity: qty, uom: 'Each', created_by: 1, modified_by: 1 });
  await ins('solution_configs', STD({ number: await nextNumber('CFG'), owner_id: U.pse1.id, opportunity_id: O.hosp, name: 'HIS server estate', version_no: 1, status: 'In review' }));

  // ---- quotations
  const qmod = require('./modules/quotations'); const approvals = require('./modules/approvals');
  const makeQuote = async (opp, owner, lines, { status = 'Draft', payment = '30 days net', validOff = 30, hdr = 0 } = {}) => {
    const o = await one('SELECT * FROM opportunities WHERE id=$1', [O[opp]]);
    const num = await nextNumber(`Q-${o.country}`, db, 4);
    const quo = await ins('quotations', STD({ number: num, owner_id: U[owner].id, opportunity_id: o.id, account_id: o.account_id, is_primary: true, status: 'Draft', country: o.country, currency: 'USD', current_version_no: 1, turnaround_start: ts(-6) }));
    const ver = await ins('quotation_versions', { quotation_id: quo.id, version_no: 1, status: 'Draft', currency: 'USD', fx_to_base: 1, fx_date: day(), price_list: 'List', valid_until: day(validOff), payment_terms: payment, header_discount_pct: hdr, created_by: U[owner].id, modified_by: U[owner].id });
    let seq = 1;
    for (const [sku, qty, disc] of lines) {
      const pd = await qmod.lookupPricing(P[sku], 'USD', qty);
      await ins('quotation_lines', { version_id: ver.id, seq: seq++, product_id: P[sku], description: pd.product.name, quantity: qty, uom: pd.product.uom, term_months: pd.product.recurring ? pd.product.default_term_months : null, billing_months: pd.product.recurring ? pd.product.billing_months : null,
        list_price: pd.list_price, discount_pct: disc, cost_currency: pd.cost.cost_currency, unit_cost: pd.cost.unit_cost, cost_source: pd.cost.cost_source, cost_ref: pd.cost.cost_ref, tax_code: pd.tax_code, tax_rate: pd.tax_rate, optional: false, selected: true, created_by: 1, modified_by: 1 });
    }
    await qmod.recalc(ver.id); await qmod.syncHeader(quo.id);
    if (status === 'Submitted' || status === 'Approved' || status === 'Sent') {
      const v = await one('SELECT * FROM quotation_versions WHERE id=$1', [ver.id]);
      const snapshot = { gm_pct: Math.round(v.gm_pct * 100) / 100, total_cost: v.total_cost, gross_profit: v.gross_profit, grand_total: v.grand_total, amount_base: v.grand_total, max_discount_pct: Math.max(...lines.map((l) => l[2])), payment_terms_nonstandard: false, validity_beyond_cost: false, cost_expired: false, country: o.country };
      const ctx = { id: U[owner].id, user: { name: owner }, roles: new Set(), delegators: [], _cache: {} };
      if (status === 'Submitted') {
        const ev = await approvals.evaluate('quotation', snapshot);
        const sub = await approvals.submit(ctx, { type: 'quotation', entity: 'quotation_versions', recordId: ver.id, label: `${num} v1`, amount: v.grand_total, currency: 'USD', snapshot, evaluation: ev });
        await q(`UPDATE quotation_versions SET status=$2, approval_required=$3, approval_request_id=$4, trigger_snapshot=$5, submitted_at=now() WHERE id=$1`, [ver.id, sub.required ? 'Submitted' : 'Approved', sub.required, sub.required ? sub.request.id : null, J(snapshot)]);
      } else await q(`UPDATE quotation_versions SET status=$2, approved_at=now(), sent_at=CASE WHEN $2='Sent' THEN now() END, issue_date=CASE WHEN $2='Sent' THEN current_date END, trigger_snapshot=$3 WHERE id=$1`, [ver.id, status, J(snapshot)]);
      await qmod.syncHeader(quo.id);
    }
    await q('UPDATE opportunities SET primary_quotation_id=$1 WHERE id=$2', [quo.id, o.id]);
    return { quo, ver };
  };
  await makeQuote('core', 'se1', [['PE-R760', 16, 8], ['ME5024', 4, 6], ['PS-5YR', 16, 10], ['SVC-IMPL', 60, 0]], { status: 'Submitted' });
  await makeQuote('fw', 'se2', [['FG-200F', 8, 4], ['FC-UTP-1Y', 8, 0], ['SVC-IMPL', 6, 0]], { status: 'Sent' });
  await makeQuote('dc', 'se1', [['PE-R760', 40, 22], ['ME5024', 8, 20], ['C9300-48P', 24, 15]], { status: 'Draft', hdr: 2 });
  await makeQuote('energy', 'se3', [['FG-200F', 30, 5], ['FAZ-VM', 3, 0], ['FC-UTP-1Y', 30, 0], ['SVC-IMPL', 40, 0]], { status: 'Sent' });
  await makeQuote('svc', 'se2', [['SVC-IMPL', 60, 5], ['SVC-PM', 20, 0]], { status: 'Approved' });

  // ---- activities, tasks, meetings
  const act = async (owner, type, subject, off, outcome, opp, acc) => ins('activities', STD({ number: await nextNumber('ACT'), owner_id: U[owner].id, activity_type: type, subject, activity_date: ts(off, 9 + Math.abs(off) % 6), duration_min: 45, status: 'Completed', outcome, opportunity_id: opp ? O[opp] : null, account_id: acc ? A_[acc] : null, owner_team_snapshot: 'Enterprise Sales KH' }));
  for (const [o, t, s, off, out, opp, acc] of [['se1', 'Meeting', 'Executive briefing with CIO', -1, 'Positive', 'core', 'mekongbank'], ['se1', 'Call', 'Pricing clarification call', -2, 'Positive', 'dc', 'angkortel'], ['se2', 'Visit', 'Site survey at 14 schools', -2, 'Neutral', 'sd', 'moe'], ['se2', 'Email', 'Proposal follow-up', -1, 'Follow-up needed', 'fw', 'ppl'],
    ['am1', 'Workshop', 'Virtualisation design workshop', -1, 'Positive', 'uni', 'cambu'], ['se3', 'Demo', 'Security gateway demo', -2, 'Positive', 'energy', 'vnenergy'], ['se1', 'Call', 'Intro call with Khmer Foods', -20, 'Neutral', 'foods', 'khmerfoods'], ['se2', 'Meeting', 'Hospital steering committee', -3, 'Positive', 'hosp', 'nat_hosp'],
    ['se1', 'Call', 'Quarterly business review', -7, 'Positive', null, 'mekongbank'], ['se2', 'Visit', 'Customer visit', -8, 'Positive', 'svc', 'ppl']]) await act(o, t, s, off, out, opp, acc);
  const task = async (owner, subject, dueOff, pri, status, opp, cat = 'Follow-up', extra = {}) => ins('tasks', STD({ number: await nextNumber('TSK'), owner_id: U[owner].id, subject, due_at: ts(dueOff, 17), priority: pri, status, category: cat, opportunity_id: opp ? O[opp] : null, related_entity: opp ? 'opportunities' : null, related_id: opp ? O[opp] : null, related_label: opp || null, assigned_by: U['sm.kh'].id, ...extra }));
  await task('se1', 'Send revised BOM to Mekong Bank', 0, 'High', 'In progress', 'core', 'Quotation'); await task('se1', 'Prepare negotiation pack for Angkor Telecom', 1, 'High', 'Not started', 'dc'); await task('se2', 'Chase quotation feedback - Phnom Penh Logistics', -2, 'High', 'Not started', 'fw');
  await task('se2', 'Update tender checklist for MoE', 3, 'Normal', 'Not started', 'sd'); await task('am1', 'Confirm PO timing with Cambu University', 1, 'Critical', 'In progress', 'uni'); await task('sop1', 'Review duplicate account candidates', 2, 'Normal', 'Not started', null, 'Data quality');
  await task('se1', 'Renew Mekong Bank support contract', 7, 'Normal', 'Not started', null, 'Renewal'); await task('pse1', 'Validate HIS server configuration', 2, 'High', 'In progress', 'hosp', 'Approval support');
  const mt = async (owner, subject, startOff, hours, type, opp, acc, attendees = []) => { const m = await ins('meetings', STD({ number: await nextNumber('MTG'), owner_id: U[owner].id, subject, meeting_type: type, start_at: ts(startOff, 8 + hours[0]), end_at: ts(startOff, 8 + hours[1]), location: 'Phnom Penh HQ - Room 3', status: 'Planned', opportunity_id: opp ? O[opp] : null, account_id: acc ? A_[acc] : null, agenda: 'Review status, risks and next steps' }));
    await ins('meeting_participants', { meeting_id: m.id, user_id: U[owner].id, attendee_role: 'Organiser', response: 'Accepted', created_by: 1, modified_by: 1 });
    for (const a of attendees) await ins('meeting_participants', { meeting_id: m.id, user_id: U[a].id, attendee_role: 'Required', response: 'Pending', created_by: 1, modified_by: 1 }); return m; };
  await mt('sm.kh', 'Weekly pipeline review', 1, [1, 2], 'Pipeline review', null, null, ['se1', 'se2', 'am1']); await mt('se1', 'Mekong Bank - solution walkthrough', 2, [3, 4], 'Customer meeting', 'core', 'mekongbank', ['pse1']); await mt('se2', 'MoE tender clarification', 3, [2, 3], 'Customer meeting', 'sd', 'moe', ['pse1', 'cpm1']);

  // ---- contracts & renewals
  const ct = async (name, acc, owner, vendor, type, startOff, endOff, value) => { const c = await ins('contracts', STD({ number: await nextNumber('CTR'), owner_id: U[owner].id, name, account_id: A_[acc], vendor_id: V[vendor], contract_type: type, status: endOff < 90 ? 'Expiring' : 'Active', start_date: day(startOff), end_date: day(endOff), value, currency: 'USD', auto_renew: false, notice_days: 60 }));
    await ins('renewals', STD({ number: await nextNumber('REN'), owner_id: U[owner].id, contract_id: c.id, due_date: day(endOff), status: 'Upcoming', expected_value: value })); return c; };
  await ct('Dell ProSupport - Mekong Bank DC', 'mekongbank', 'se1', 'DELL', 'Support / maintenance', -700, 40, 84000); await ct('Cisco DNA subscription - Cambu University', 'cambu', 'am1', 'CISCO', 'Subscription', -330, 35, 36000); await ct('Fortinet UTP - Phnom Penh Logistics', 'ppl', 'se2', 'FTNT', 'Subscription', -300, 120, 22000);
  await ct('Microsoft EA - Siem Reap Grand', 'sr_hotel', 'am1', 'MSFT', 'Licence', -200, 260, 41000);

  // ---- targets, plan, forecast submissions
  const qs = new Date(); const qStartD = new Date(Date.UTC(qs.getUTCFullYear(), Math.floor(qs.getUTCMonth() / 3) * 3, 1)).toISOString().slice(0, 10); const qEndD = new Date(Date.UTC(qs.getUTCFullYear(), Math.floor(qs.getUTCMonth() / 3) * 3 + 3, 0)).toISOString().slice(0, 10);
  const plabel = `${qs.getUTCFullYear()}-Q${Math.floor(qs.getUTCMonth() / 3) + 1}`;
  for (const [u, v] of [['se1', 450000], ['se2', 380000], ['am1', 250000], ['se3', 300000]]) await ins('sales_targets', STD({ number: await nextNumber('TGT'), owner_id: U[u].id, measure: 'Gross profit', period_type: 'Quarter', period_label: plabel, period_start: qStartD, period_end: qEndD, target_value: Math.round(v * 0.25), currency: 'USD', status: 'Active' }));
  await ins('commission_plans', STD({ number: await nextNumber('CPL'), created_by: U.fin1.id, modified_by: U.fin1.id, name: 'Standard GP commission 2026', version_no: 1, basis: 'Gross profit', base_rate: 5, accelerator_rate: 8, cap_pct: 25, effective_from: '2026-01-01', status: 'Approved' }));
  for (const [u, commit, best] of [['se1', 200000, 650000], ['se2', 120000, 300000]]) { const range = require('./modules/forecast').periodRange(plabel); await ins('forecast_submissions', STD({ number: await nextNumber('FCS'), owner_id: U[u].id, period_label: plabel, commit_amount: commit, best_case_amount: best, pipeline_amount: best * 1.5, system_commit: 0, system_best_case: 0, status: 'Submitted' })); }

  // ---- events
  const ev = await ins('events', STD({ number: await nextNumber('EVT'), owner_id: U.evo1.id, name: 'Cybersecurity Roadshow - Phnom Penh', event_type: 'Roadshow', status: 'Open for registration', start_at: ts(14, 2), end_at: ts(14, 9), venue: 'Sokha Hotel Grand Ballroom', country: 'KH', campaign_id: CMP.sec, bu_id: bu, capacity: 120, budget: 12000, currency: 'USD', published: true }));
  for (const [n, e, c] of [['Vichet Lay', 'vichet.lay@mekongbank.example', 'Mekong Digital Bank'], ['Rotha Seng', 'rotha.seng@ppl.example', 'Phnom Penh Logistics'], ['Anna Lee', 'anna.lee@startup.example', 'Startup Co']]) await ins('event_registrations', { event_id: ev.id, attendee_name: n, attendee_email: e, company: c, status: 'Registered', created_by: 1, modified_by: 1 });
  await ins('events', STD({ number: await nextNumber('EVT'), owner_id: U.evo1.id, name: 'Cloud Migration Webinar #3', event_type: 'Webinar', status: 'Completed', start_at: ts(-20, 3), end_at: ts(-20, 4), venue: 'Online', country: 'KH', campaign_id: CMP.cloud, capacity: 300, budget: 1500, currency: 'USD', published: true }));

  // ---- claims
  const cats = [['TRV', 'Local transportation', 100, 25, false], ['MEL', 'Meals & entertainment', 150, 25, true], ['ACC', 'Accommodation', 250, 0, false], ['EVT', 'Event expenses', 5000, 25, false], ['TEL', 'Communication', 60, 10, false]];
  const CAT = {}; for (const [code, name, lim, rec, att] of cats) CAT[code] = (await ins('claim_categories', { code, name, limit_per_claim: lim, receipt_threshold: rec, requires_attendees: att, status: 'Active', created_by: 1, modified_by: 1 })).id;
  const claim = async (owner, title, status, pay, lines, extra = {}) => {
    const c = await ins('claims', STD({ number: await nextNumber('CLM'), owner_id: U[owner].id, title, purpose: 'Client engagement', claim_date: day(-3), currency: 'USD', status, payment_status: pay, ...extra }));
    for (const [cat, off, merchant, desc, amt] of lines) await ins('claim_lines', { claim_id: c.id, category_id: CAT[cat], expense_date: day(off), merchant, description: desc, amount: amt, currency: 'USD', fx_rate: 1, claim_amount: amt, approved_amount: null, receipt_attached: true, attendees: cat === 'MEL' ? 'Client team (3)' : null, policy_flags: [], created_by: U[owner].id, modified_by: U[owner].id });
    await require('./modules/finance').recalcClaim(c.id); return c;
  };
  await claim('se1', 'Customer visit - Siem Reap', 'Draft', 'Not ready', [['TRV', -5, 'Taxi', 'Airport transfer', 38], ['ACC', -5, 'Angkor Palace Resort', 'Hotel 1 night', 120], ['MEL', -4, 'Malis Restaurant', 'Client dinner', 96]]);
  const cl2 = await claim('se2', 'Tender site visits - Kandal', 'In approval', 'Not ready', [['TRV', -6, 'Grab', 'Transport to sites', 72], ['MEL', -6, 'Local Cafe', 'Team lunch', 54]]);
  { const ctx = { id: U.se2.id, user: { name: 'se2' }, roles: new Set(), delegators: [], _cache: {} }; const r = await approvals.submit(ctx, { type: 'claim', entity: 'claims', recordId: cl2.id, label: `${cl2.number} ${cl2.title}`, amount: 126, currency: 'USD', snapshot: { amount_base: 126, amount: 126 } }); await q('UPDATE claims SET approval_request_id=$2, submitted_at=now() WHERE id=$1', [cl2.id, r.request.id]); }
  const cl3 = await claim('se1', 'Roadshow materials & logistics', 'Approved', 'Ready for payment', [['EVT', -9, 'PrintPro', 'Banners and brochures', 640], ['TRV', -9, 'Logistics Co', 'Equipment transport', 85]], { verified_by: U.finv1.id, verified_at: ts(-1), event_id: ev.id });
  await q(`UPDATE claim_lines SET approved_amount=claim_amount WHERE claim_id=$1`, [cl3.id]); await require('./modules/finance').recalcClaim(cl3.id);
  const cl4 = await claim('am1', 'Partner workshop expenses', 'Approved', 'Paid', [['MEL', -20, 'Sofitel', 'Partner lunch', 140]], { verified_by: U.finv1.id, paid_at: ts(-5), payment_reference: 'BNK-77120' });
  await q(`UPDATE claim_lines SET approved_amount=claim_amount WHERE claim_id=$1`, [cl4.id]);

  // ---- calendar, documents
  for (const [title, type, s, e, nw] of [['Khmer Water Festival', 'Public holiday', '2026-11-24', '2026-11-26', true], ['Year-end sales freeze', 'Blackout / freeze', '2026-12-28', '2026-12-31', false], ['Q1 Sales Kick-off', 'Company event', '2027-01-12', '2027-01-12', false], ['Independence Day', 'Public holiday', '2026-11-09', '2026-11-09', true]])
    await ins('calendar_events', { title, calendar_type: type, country: 'KH', start_date: s, end_date: e, non_working: nw, created_by: 1, modified_by: 1 });
  // ---- weekly forecast snapshot
  const { takeSnapshot } = require('./modules/forecast');
  await takeSnapshot({ id: U.admin.id, user: { name: 'admin' }, roles: new Set(['ROL-ADM']), isAdmin: true, delegators: [], _cache: {} }, { type: 'Period start', label: `${plabel} period start`, period: plabel });
  await q(`UPDATE integrations SET status='Active', endpoint='https://erp.example/api (simulated)' WHERE code IN ('INT-04','INT-19','INT-01')`);
  console.log('Demo data created.');
}

async function run() {
  await seedRoles(); await seedPicklists(); await seedSettings(); await seedCore(); await seedProcesses(); await seedIntegrations();
  const created = await seedUsers();
  await A.loadPerms();
  await seedCatalog();
  if (process.env.SEED_DEMO !== '0') await seedDemo();
  const n = await one('SELECT count(*)::int n FROM users');
  console.log(`Seed complete (${n.n} users).${created ? ` Demo users share the password "${DEMO_PASSWORD}".` : ''}`);
}
module.exports.run = run;
if (require.main === module) run().then(() => db.pool.end()).catch((e) => { console.error(e); process.exit(1); });
