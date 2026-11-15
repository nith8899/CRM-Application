'use strict';
// Organisation, master data and relationship entities (M02-M07, M24, M33).
const { T, LT, I, N, M, PCT, D, DT, B, E, P, U, J, S, R } = require('../core/dsl');

const ACTIVE = ['Active', 'Inactive'];

module.exports = [
  // ------------------------------------------------------------------ M24/M33
  {
    key: 'org_units', table: 'org_units', core: true, label: 'Legal Entity', plural: 'Legal Entities', module: 'M24', title: 'name', noScope: true,
    fields: [T('name', 'Name', { req: 1, list: 1, search: 1 }), S('country', 'Country', 'countries', { req: 1, list: 1 }),
      S('base_currency', 'Base currency', 'currencies', { req: 1, list: 1 }), T('tax_id', 'Tax ID'),
      R('parent_id', 'Parent', 'org_units'), S('status', 'Status', ACTIVE, { list: 1, def: 'Active' })],
  },
  {
    key: 'business_units', table: 'business_units', core: true, label: 'Business Unit', plural: 'Business Units', module: 'M24', title: 'name', noScope: true,
    fields: [T('name', 'Name', { req: 1, list: 1, search: 1 }), R('org_unit_id', 'Legal entity', 'org_units', { list: 1 }),
      PCT('margin_floor_pct', 'Margin floor %', { help: 'Policy reference for margin approvals' }), S('status', 'Status', ACTIVE, { list: 1, def: 'Active' })],
  },
  {
    key: 'branches', table: 'branches', core: true, label: 'Branch', plural: 'Branches', module: 'M24', title: 'name', noScope: true,
    fields: [T('name', 'Name', { req: 1, list: 1, search: 1 }), R('org_unit_id', 'Legal entity', 'org_units'),
      S('country', 'Country', 'countries', { req: 1, list: 1 }), T('address', 'Address'), S('status', 'Status', ACTIVE, { list: 1, def: 'Active' })],
  },
  {
    key: 'teams', table: 'teams', core: true, label: 'Team', plural: 'Teams', module: 'M24', title: 'name', noScope: true,
    fields: [T('name', 'Name', { req: 1, list: 1, search: 1 }), R('parent_id', 'Parent team', 'teams', { list: 1 }),
      R('manager_id', 'Team manager', 'users', { list: 1 }), R('branch_id', 'Branch', 'branches'), R('bu_id', 'Business unit', 'business_units'),
      S('status', 'Status', ACTIVE, { list: 1, def: 'Active' })],
  },
  {
    key: 'users', table: 'users', core: true, label: 'User', plural: 'Users', module: 'M24', title: 'name', noScope: true, adminOnlyWrite: true, hookColumns: ['password_hash', 'must_change_password', 'token_version'],
    fields: [
      T('name', 'Full name', { req: 1, list: 1, search: 1 }), T('login', 'Login', { req: 1, list: 1, search: 1, uniq: 1 }),
      E('email', 'Email', { req: 1, list: 1, search: 1, uniq: 1 }),
      { name: 'password', label: 'Initial password', type: 'text', virtual: 1, help: 'Min 10 chars, upper/lower/digit', pwd: 1 },
      S('status', 'Status', ['Invited', 'Active', 'Suspended', 'Deactivated'], { list: 1, def: 'Active' }),
      S('user_type', 'Type', ['internal', 'external'], { def: 'internal' }),
      T('job_title', 'Job title', { list: 1 }), T('job_grade', 'Job grade', { sec: 'employee' }), P('phone', 'Phone', { sec: 'personal' }),
      S('country', 'Country', 'countries', { list: 1 }), R('org_unit_id', 'Legal entity', 'org_units'), R('branch_id', 'Branch', 'branches'),
      R('bu_id', 'Business unit', 'business_units'), R('team_id', 'Team', 'teams', { list: 1 }), R('manager_id', 'Line manager', 'users', { list: 1 }),
      R('partner_id', 'Partner (external users)', 'partners'), M('approval_limit', 'Approval limit (base ccy)', { sec: 'employee' }),
      S('time_zone', 'Time zone', 'timezones', { def: 'UTC' }), S('locale', 'Locale', ['en', 'km', 'vi', 'th'], { def: 'en' }),
    ],
  },
  {
    key: 'reporting_lines', table: 'reporting_lines', core: true, plain: true, label: 'Reporting Line', plural: 'Reporting Lines', module: 'M33', title: 'id', noScope: true,
    fields: [R('employee_id', 'Employee', 'users', { req: 1, list: 1 }), R('manager_id', 'Manager', 'users', { req: 1, list: 1 }),
      S('purpose', 'Purpose', ['Primary', 'Visibility', 'Approval'], { req: 1, list: 1, def: 'Primary' }),
      D('effective_from', 'Effective from', { req: 1, list: 1 }), D('effective_to', 'Effective to', { list: 1 }), T('reason', 'Reason')],
  },
  {
    key: 'picklists', table: 'picklists', core: true, plain: true, label: 'Picklist Value', plural: 'Picklists', module: 'M24', title: 'label', noScope: true,
    fields: [T('list', 'List', { req: 1, list: 1, search: 1 }), T('value', 'Value', { req: 1, list: 1, search: 1 }), T('label', 'Label', { req: 1, list: 1 }),
      I('sort_order', 'Sort', { list: 1, def: 0 }), B('active', 'Active', { list: 1, def: true })],
  },
  {
    key: 'exchange_rates', table: 'exchange_rates', label: 'Exchange Rate', plural: 'Exchange Rates', module: 'M24', title: 'from_ccy', noScope: true,
    fields: [S('from_ccy', 'From', 'currencies', { req: 1, list: 1 }), S('to_ccy', 'To', 'currencies', { req: 1, list: 1 }),
      S('rate_type', 'Rate type', ['Corporate', 'Spot', 'Budget'], { req: 1, list: 1, def: 'Corporate' }),
      N('rate', 'Rate', { req: 1, list: 1, scale: 8 }), D('effective_date', 'Effective date', { req: 1, list: 1 }), T('rate_source', 'Source')],
    unique: [['from_ccy', 'to_ccy', 'rate_type', 'effective_date']],
  },
  {
    key: 'tax_codes', table: 'tax_codes', label: 'Tax Code', plural: 'Tax Codes', module: 'M24', title: 'code', noScope: true,
    fields: [T('code', 'Code', { req: 1, list: 1, uniq: 1 }), T('name', 'Name', { req: 1, list: 1 }), S('country', 'Country', 'countries', { list: 1 }),
      PCT('rate', 'Rate %', { req: 1, list: 1 }), S('status', 'Status', ACTIVE, { def: 'Active', list: 1 })],
  },

  // ------------------------------------------------------------------ M02 Leads
  {
    key: 'leads', table: 'leads', label: 'Lead', plural: 'Leads', module: 'M02', prefix: 'LEAD', title: 'company', owned: true,
    statusField: 'status', lockedWhen: (r) => r.status === 'Converted', lockedMsg: 'Converted leads are read-only (BRULE-LEAD-008)',
    fields: [
      T('company', 'Company', { req: 1, list: 1, search: 1 }), T('first_name', 'First name', { search: 1 }), T('last_name', 'Last name', { req: 1, list: 1, search: 1 }),
      T('title', 'Job title'), E('email', 'Email', { list: 1, search: 1, sec: 'personal' }), P('phone', 'Phone', { list: 1, sec: 'personal' }),
      S('country', 'Country', 'countries', { req: 1, list: 1 }), S('industry', 'Industry', 'industries'),
      S('source', 'Source', 'lead_sources', { req: 1, list: 1 }), R('campaign_id', 'Campaign', 'campaigns'), R('partner_id', 'Referring partner', 'partners'),
      S('status', 'Status', ['New', 'Working', 'Qualified', 'Disqualified', 'Converted', 'Pending acceptance'], { list: 1, def: 'New', sys: 1 }),
      M('est_value', 'Estimated value', { list: 1 }), S('currency', 'Currency', 'currencies', { def: 'USD' }),
      S('bant_budget', 'Budget', ['Unknown', 'None', 'Indicated', 'Confirmed'], { def: 'Unknown', section: 'Qualification (BANT-T)' }),
      S('bant_authority', 'Authority', ['Unknown', 'User', 'Influencer', 'Decision maker', 'Economic buyer'], { def: 'Unknown', section: 'Qualification (BANT-T)' }),
      S('bant_need', 'Need', ['Unclear', 'Defined', 'Urgent'], { def: 'Unclear', section: 'Qualification (BANT-T)' }),
      S('bant_timeline', 'Timeline', ['Unknown', '> 12 months', '6-12 months', '< 6 months', '< 3 months'], { def: 'Unknown', section: 'Qualification (BANT-T)' }),
      S('bant_tech_fit', 'Technical fit', ['Unknown', 'None', 'Partial', 'Full'], { def: 'Unknown', section: 'Qualification (BANT-T)' }),
      I('score', 'Score (0-100)', { list: 1, readonly: 1 }), LT('interest', 'Interest / notes'),
      S('disqualify_reason', 'Disqualification reason', 'disqualify_reasons', { sys: 1 }), T('disqualify_comment', 'Disqualification comment', { sys: 1 }),
      DT('first_response_at', 'First response', { readonly: 1 }), DT('assigned_at', 'Assigned at', { readonly: 1 }),
      B('consent_marketing', 'Marketing consent', { def: false }),
      R('converted_account_id', 'Converted account', 'accounts', { sys: 1 }), R('converted_contact_id', 'Converted contact', 'contacts', { sys: 1 }),
      R('converted_opportunity_id', 'Converted opportunity', 'opportunities', { sys: 1 }),
    ],
    dup: { fields: ['email'], alt: ['company'], label: 'Possible duplicate leads (BRULE-LEAD-003)' },
  },

  // ---------------------------------------------------------------- M03 Accounts
  {
    key: 'accounts', table: 'accounts', label: 'Account', plural: 'Accounts', module: 'M03', prefix: 'ACC', title: 'legal_name', owned: true, statusField: 'status',
    fields: [
      T('legal_name', 'Legal name', { req: 1, list: 1, search: 1 }), T('trade_name', 'Trade name', { search: 1 }),
      S('country', 'Country', 'countries', { req: 1, list: 1 }), S('account_type', 'Type', ['Prospect', 'Customer', 'Former customer'], { req: 1, list: 1, def: 'Prospect' }),
      S('status', 'Status', ['Active', 'Inactive', 'Blocked'], { list: 1, def: 'Active' }), S('segment', 'Segment', 'segments', { list: 1 }),
      S('industry', 'Industry', 'industries', { list: 1 }), S('tier', 'Tier', ['Strategic', 'Key', 'Standard', 'Other']),
      T('tax_id', 'Tax ID'), U('website', 'Website'), P('phone', 'Phone'), T('address', 'Address'), T('city', 'City'),
      R('parent_id', 'Parent account', 'accounts'), R('branch_id', 'Branch', 'branches'), R('bu_id', 'Business unit', 'business_units'),
      R('territory_id', 'Territory', 'territories'), B('open_territory', 'Open territory', { def: false }), B('is_government', 'Government / public sector', { def: false }),
      T('erp_id', 'ERP customer ID', { readonly: 1 }), M('credit_limit', 'Credit limit (ERP)', { readonly: 1, sec: 'financial' }),
      M('outstanding_balance', 'Outstanding balance (ERP)', { readonly: 1, sec: 'financial' }), B('credit_blocked', 'Credit blocked (ERP)', { readonly: 1, def: false }),
      LT('description', 'Notes'),
    ],
    children: [{ entity: 'contacts', fk: 'account_id', label: 'Contacts' }, { entity: 'opportunities', fk: 'account_id', label: 'Opportunities' },
      { entity: 'contracts', fk: 'account_id', label: 'Contracts' }, { entity: 'account_plans', fk: 'account_id', label: 'Account plans' },
      { entity: 'activities', fk: 'account_id', label: 'Activities' }],
    dup: { fields: ['tax_id', 'country'], alt: ['legal_name'], label: 'Possible duplicate accounts (BRULE-ACC-003)', strict: ['tax_id', 'country'] },
  },
  {
    key: 'territories', table: 'territories', label: 'Territory', plural: 'Territories', module: 'M24', title: 'name', noScope: true,
    fields: [T('name', 'Name', { req: 1, list: 1, search: 1 }), R('parent_id', 'Parent', 'territories'), LT('rule_definition', 'Rule definition'),
      S('status', 'Status', ACTIVE, { def: 'Active', list: 1 })],
  },
  {
    key: 'account_plans', table: 'account_plans', label: 'Account Plan', plural: 'Account Plans', module: 'M03', title: 'fiscal_year', prefix: 'AP', owned: true,
    scopeParent: { fk: 'account_id', entity: 'accounts' },
    fields: [R('account_id', 'Account', 'accounts', { req: 1, list: 1 }), T('fiscal_year', 'Fiscal year', { req: 1, list: 1 }),
      S('status', 'Status', ['Draft', 'Active', 'Archived'], { def: 'Draft', list: 1 }), LT('objectives', 'Objectives', { req: 1 }),
      LT('whitespace', 'Whitespace / opportunities'), LT('initiatives', 'Initiatives'), LT('risks', 'Risks'), M('revenue_target', 'Revenue target')],
  },

  // ---------------------------------------------------------------- M04 Contacts
  {
    key: 'contacts', table: 'contacts', label: 'Contact', plural: 'Contacts', module: 'M04', prefix: 'CON', title: 'full_name', owned: true, statusField: 'status',
    scopeParent: { fk: 'account_id', entity: 'accounts', orOwn: true },
    fields: [
      T('first_name', 'First name', { search: 1 }), T('last_name', 'Last name', { req: 1, search: 1 }), T('full_name', 'Name', { list: 1, readonly: 1 }),
      R('account_id', 'Account', 'accounts', { list: 1 }), R('partner_id', 'Partner', 'partners'), R('vendor_id', 'Vendor', 'vendors'),
      T('job_title', 'Job title', { list: 1 }), T('department', 'Department'), S('role_type', 'Buying role', 'buying_roles'),
      E('email', 'Email', { list: 1, search: 1, sec: 'personal' }), P('phone', 'Phone', { list: 1, sec: 'personal' }), P('mobile', 'Mobile', { sec: 'personal' }),
      S('status', 'Status', ['Active', 'Inactive', 'Left organisation'], { def: 'Active', list: 1 }),
      B('consent_email', 'Email consent', { def: false }), B('consent_phone', 'Phone consent', { def: false }), D('consent_date', 'Consent date'),
      D('date_of_birth', 'Date of birth', { sec: 'personal' }), LT('notes', 'Notes'), B('anonymised', 'Anonymised', { readonly: 1, def: false }),
    ],
    dup: { fields: ['email'], label: 'Possible duplicate contacts (BRULE-CON-002)' },
  },

  // ---------------------------------------------------- M05 Partners / M06 Vendors
  {
    key: 'partners', table: 'partners', label: 'Partner', plural: 'Partners', module: 'M05', prefix: 'PRT', title: 'name', owned: true, statusField: 'status',
    fields: [
      T('name', 'Partner name', { req: 1, list: 1, search: 1 }), S('country', 'Country', 'countries', { req: 1, list: 1 }),
      S('partner_type', 'Type', ['Reseller', 'System integrator', 'Distributor', 'MSP', 'Referral', 'Other'], { req: 1, list: 1 }),
      S('tier', 'Tier', ['Platinum', 'Gold', 'Silver', 'Registered'], { list: 1, def: 'Registered' }),
      S('status', 'Status', ['Applied', 'Under review', 'Returned', 'Approved', 'Active', 'Suspended', 'Terminated'], { list: 1, def: 'Applied', sys: 1 }),
      R('account_id', 'Organisation account', 'accounts'), T('tax_id', 'Tax ID'), U('website', 'Website'), P('phone', 'Phone'), T('address', 'Address'),
      J('authorised_vendors', 'Authorised vendors (ids)', { hide: 1 }), D('agreement_start', 'Agreement start'), D('agreement_end', 'Agreement end'),
      D('onboarded_at', 'Onboarded', { readonly: 1 }), I('credit_days', 'Payment terms (days)'), M('annual_target', 'Annual target'),
      LT('notes', 'Notes'),
    ],
    children: [{ entity: 'partner_certifications', fk: 'partner_id', label: 'Certifications' }, { entity: 'contacts', fk: 'partner_id', label: 'Contacts' },
      { entity: 'deal_registrations', fk: 'partner_id', label: 'Deal registrations' }],
    dup: { fields: ['tax_id', 'country'], alt: ['name'], label: 'Possible duplicate partners', strict: ['tax_id', 'country'] },
  },
  {
    key: 'partner_certifications', table: 'partner_certifications', label: 'Partner Certification', plural: 'Partner Certifications', module: 'M05', title: 'name',
    scopeParent: { fk: 'partner_id', entity: 'partners' },
    fields: [R('partner_id', 'Partner', 'partners', { req: 1, list: 1 }), R('vendor_id', 'Vendor', 'vendors', { list: 1 }), T('name', 'Certification / specialisation', { req: 1, list: 1 }),
      D('issued_on', 'Issued'), D('expires_on', 'Expires', { list: 1 }), S('status', 'Status', ['Valid', 'Expiring', 'Expired'], { def: 'Valid', list: 1 })],
  },
  {
    key: 'vendors', table: 'vendors', label: 'Vendor', plural: 'Vendors', module: 'M06', prefix: 'VEN', title: 'name', owned: true, noScope: true, statusField: 'status', ownerLabel: 'Vendor manager',
    fields: [
      T('name', 'Vendor name', { req: 1, list: 1, search: 1 }), T('code', 'Code', { req: 1, list: 1, uniq: 1 }), S('status', 'Status', ACTIVE, { def: 'Active', list: 1 }),
      S('country', 'HQ country', 'countries'), U('website', 'Website'), S('currency', 'Price currency', 'currencies', { def: 'USD' }),
      M('min_deal_value', 'Min deal value for registration', { help: 'BRULE-DREG-003' }), I('reg_protection_days', 'Registration protection (days)', { def: 90 }),
      I('reg_max_renewals', 'Max registration renewals', { def: 1 }), B('reg_exclusive', 'Registration is exclusive', { def: false }),
      I('policy_version', 'Policy version', { def: 1 }), LT('programme_notes', 'Programmes / policies'),
      PCT('standard_discount_pct', 'Standard vendor discount %', { sec: 'cost' }), PCT('rebate_pct', 'Back-end rebate %', { sec: 'cost' }),
    ],
    children: [{ entity: 'products', fk: 'vendor_id', label: 'Products' }, { entity: 'contacts', fk: 'vendor_id', label: 'Contacts' }],
  },

  // ---------------------------------------------------------------- M07 Catalog
  {
    key: 'product_categories', table: 'product_categories', label: 'Product Category', plural: 'Product Categories', module: 'M07', title: 'name', noScope: true,
    fields: [T('name', 'Name', { req: 1, list: 1, search: 1 }), R('parent_id', 'Parent', 'product_categories', { list: 1 }), PCT('margin_floor_pct', 'Margin floor %'),
      S('status', 'Status', ACTIVE, { def: 'Active', list: 1 })],
  },
  {
    key: 'products', table: 'products', label: 'Product / Service', plural: 'Products', module: 'M07', title: 'name', noScope: true, statusField: 'status',
    fields: [
      T('sku', 'SKU / part number', { req: 1, list: 1, search: 1 }), T('name', 'Name', { req: 1, list: 1, search: 1 }),
      R('vendor_id', 'Vendor', 'vendors', { list: 1 }), R('category_id', 'Category', 'product_categories', { list: 1 }),
      S('product_type', 'Type', ['Hardware', 'Software', 'Subscription', 'Cloud', 'Professional service', 'Support / maintenance', 'Bundle'], { req: 1, list: 1 }),
      T('uom', 'Unit of measure', { def: 'Each' }), S('status', 'Status', ['Draft', 'Active', 'End-of-sale', 'End-of-life', 'Inactive'], { def: 'Active', list: 1 }),
      M('list_price', 'List price', { req: 1, list: 1 }), S('currency', 'Currency', 'currencies', { def: 'USD', list: 1 }),
      B('recurring', 'Recurring (subscription / support)', { def: false }), I('billing_months', 'Billing period (months)', { def: 1 }), I('default_term_months', 'Default term (months)', { def: 12 }),
      M('standard_cost', 'Standard cost', { sec: 'cost' }), S('tax_code', 'Tax code', 'tax_code_list'), D('eos_date', 'End-of-sale'), D('eol_date', 'End-of-life'),
      T('erp_item_code', 'ERP item code'), LT('description', 'Description'),
    ],
    unique: [['vendor_id', 'sku']],
  },
  {
    key: 'price_records', table: 'price_records', label: 'Price Record', plural: 'Price Lists', module: 'M14', title: 'id', noScope: true,
    fields: [R('product_id', 'Product', 'products', { req: 1, list: 1 }), S('price_list', 'Price list', ['List', 'Partner', 'Special', 'Government'], { req: 1, list: 1 }),
      M('price', 'Price', { req: 1, list: 1 }), S('currency', 'Currency', 'currencies', { req: 1, list: 1, def: 'USD' }), I('min_qty', 'Min qty', { def: 1 }),
      D('valid_from', 'Valid from', { req: 1, list: 1 }), D('valid_to', 'Valid to', { list: 1 }), R('opportunity_id', 'Opportunity (project price)', 'opportunities')],
  },
  {
    key: 'cost_records', table: 'cost_records', label: 'Vendor Cost Record', plural: 'Vendor Costs', module: 'M14', title: 'id', noScope: true, sec: 'cost',
    fields: [R('product_id', 'Product', 'products', { req: 1, list: 1 }), R('vendor_id', 'Vendor', 'vendors', { list: 1 }),
      M('cost', 'Unit cost', { req: 1, list: 1, sec: 'cost' }), S('currency', 'Cost currency', 'currencies', { req: 1, list: 1, def: 'USD' }),
      S('cost_source', 'Cost source', ['Standard', 'Vendor price list', 'Vendor quote', 'Special bid'], { req: 1, list: 1 }), T('vendor_ref', 'Vendor quote / bid ref'),
      D('valid_from', 'Valid from', { req: 1, list: 1 }), D('valid_to', 'Valid to', { list: 1 }), R('opportunity_id', 'Opportunity (special bid)', 'opportunities'),
      I('min_qty', 'Min qty', { def: 1 })],
  },

  // ---------------------------------------------------------------- M34 Marketing
  {
    key: 'campaigns', table: 'campaigns', label: 'Campaign', plural: 'Campaigns', module: 'M02', prefix: 'CMP', title: 'name', owned: true,
    fields: [T('name', 'Name', { req: 1, list: 1, search: 1 }), S('campaign_type', 'Type', ['Email', 'Webinar', 'Trade show', 'Roadshow', 'Partner programme', 'Other'], { list: 1 }),
      S('status', 'Status', ['Planned', 'Active', 'Completed', 'Cancelled'], { def: 'Planned', list: 1 }), D('start_date', 'Start', { req: 1, list: 1 }), D('end_date', 'End', { list: 1 }),
      M('budget', 'Budget'), M('actual_cost', 'Actual cost'), I('leads_generated', 'Leads generated', { readonly: 1 }), LT('description', 'Description')],
  },
];
