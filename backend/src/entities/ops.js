'use strict';
// Workforce operations: activities, tasks, calendar, events, claims, integrations (M10, M11, M25, M29-M35).
const { T, LT, I, N, M, PCT, D, DT, B, E, P, U, J, S, R } = require('../core/dsl');

const REL = ['', 'accounts', 'contacts', 'opportunities', 'leads', 'quotations', 'partners', 'vendors', 'projects', 'contracts', 'events'];

module.exports = [
  // ------------------------------------------------------------ M10 / M29 Activities
  {
    key: 'activities', table: 'activities', label: 'Activity', plural: 'Activities', module: 'M10', prefix: 'ACT', title: 'subject', owned: true, statusField: 'status',
    privateFlag: 'is_private',
    fields: [
      S('activity_type', 'Type', ['Call', 'Visit', 'Email', 'Meeting', 'Demo', 'Workshop', 'Proposal follow-up', 'Other'], { req: 1, list: 1 }), T('subject', 'Subject', { req: 1, list: 1, search: 1 }),
      DT('activity_date', 'Date / time', { req: 1, list: 1 }), I('duration_min', 'Duration (min)'),
      S('status', 'Status', ['Planned', 'Completed', 'Cancelled'], { def: 'Completed', list: 1 }), S('outcome', 'Outcome', ['Positive', 'Neutral', 'Negative', 'No answer', 'Follow-up needed'], { list: 1 }),
      R('account_id', 'Account', 'accounts', { list: 1 }), R('contact_id', 'Contact', 'contacts'), R('opportunity_id', 'Opportunity', 'opportunities', { list: 1 }), R('lead_id', 'Lead', 'leads'),
      R('partner_id', 'Partner', 'partners'), R('event_id', 'Event', 'events'), LT('notes', 'Notes'), B('is_private', 'Private', { def: false }),
      B('counts_for_target', 'Counts for activity target', { def: true }), I('org_unit_snapshot', 'Org unit (snapshot)', { readonly: 1, hide: 1 }),
      T('owner_team_snapshot', 'Team at time of activity', { readonly: 1 }), R('report_id', 'Activity report', 'activity_reports', { readonly: 1 }),
    ],
  },
  {
    key: 'activity_reports', table: 'activity_reports', label: 'Activity Report', plural: 'Activity Reports', module: 'M29', prefix: 'ARP', title: 'period_label', owned: true, statusField: 'status', ownerLabel: 'Employee',
    fields: [S('policy', 'Reporting policy', ['End-of-day', 'Weekly', 'Monthly'], { req: 1, list: 1, def: 'Weekly' }), T('period_label', 'Period', { req: 1, list: 1 }),
      D('period_start', 'Start', { req: 1 }), D('period_end', 'End', { req: 1 }), S('status', 'Status', ['Draft', 'Submitted', 'Under review', 'Approved', 'Returned', 'Reopened'], { def: 'Draft', list: 1, sys: 1 }),
      I('activities_count', 'Activities', { list: 1, readonly: 1 }), I('planned_not_done', 'Planned not completed', { readonly: 1 }), I('overdue_followups', 'Overdue follow-ups', { readonly: 1 }),
      LT('remarks', 'Remarks'), R('reviewed_by', 'Reviewed by', 'users', { readonly: 1 }), LT('review_comment', 'Review comment', { readonly: 1 }), DT('submitted_at', 'Submitted', { readonly: 1 })],
  },
  {
    key: 'activity_targets', table: 'activity_targets', label: 'Activity Target', plural: 'Activity Targets', module: 'M29', title: 'id', owned: true, ownerLabel: 'Employee',
    fields: [S('activity_type', 'Activity type', ['Call', 'Visit', 'Email', 'Meeting', 'Demo', 'Workshop', 'Any'], { req: 1, list: 1 }), S('period_type', 'Period', ['Week', 'Month', 'Quarter'], { req: 1, list: 1, def: 'Week' }),
      I('target_count', 'Target count', { req: 1, list: 1 }), D('effective_from', 'From', { req: 1, list: 1 }), D('effective_to', 'To')],
  },

  // ------------------------------------------------------------ M10 / M30 Tasks
  {
    key: 'tasks', table: 'tasks', label: 'Task', plural: 'Tasks', module: 'M30', prefix: 'TSK', title: 'subject', owned: true, statusField: 'status', ownerLabel: 'Assigned to',
    fields: [
      T('subject', 'Subject', { req: 1, list: 1, search: 1 }), LT('description', 'Description'), S('priority', 'Priority', ['Low', 'Normal', 'High', 'Critical'], { def: 'Normal', list: 1, req: 1 }),
      DT('due_at', 'Due', { list: 1 }), S('status', 'Status', ['Not started', 'In progress', 'Blocked', 'Completed', 'Cancelled', 'Deferred'], { def: 'Not started', list: 1 }),
      S('category', 'Category', ['Follow-up', 'Approval support', 'Quotation', 'Renewal', 'Data quality', 'Event', 'Claim', 'Admin', 'Other'], { def: 'Follow-up', list: 1 }),
      R('assigned_by', 'Assigned by', 'users', { readonly: 1 }), T('queue', 'Queue (unassigned pool)'), B('business_impact', 'Business impact', { def: false }),
      T('related_entity', 'Related entity', { hide: 1 }), I('related_id', 'Related record', { hide: 1 }), T('related_label', 'Related to', { list: 1, readonly: 1 }),
      R('account_id', 'Account', 'accounts'), R('opportunity_id', 'Opportunity', 'opportunities'), R('meeting_id', 'Meeting', 'meetings'),
      DT('reminder_at', 'Reminder'), S('recurrence', 'Recurrence', ['None', 'Daily', 'Weekly', 'Monthly'], { def: 'None' }), DT('completed_at', 'Completed at', { readonly: 1 }),
      S('escalation_status', 'Escalation', ['None', 'Level 1', 'Level 2', 'Level 3'], { def: 'None', list: 1, readonly: 1 }), B('auto_generated', 'Auto-generated', { readonly: 1, def: false }), T('blocked_reason', 'Blocked reason'),
    ],
  },

  // ------------------------------------------------------------ M11 / M31 Meetings & calendar
  {
    key: 'meetings', table: 'meetings', label: 'Meeting', plural: 'Meetings', module: 'M11', prefix: 'MTG', title: 'subject', owned: true, statusField: 'status', ownerLabel: 'Organiser',
    fields: [
      T('subject', 'Subject', { req: 1, list: 1, search: 1 }), S('meeting_type', 'Type', ['Customer meeting', 'Internal', 'Pipeline review', 'Presales workshop', 'Vendor meeting', 'Partner meeting', 'Event session'], { req: 1, list: 1 }),
      DT('start_at', 'Start', { req: 1, list: 1 }), DT('end_at', 'End', { req: 1, list: 1 }), T('location', 'Location'), U('online_link', 'Online meeting link'),
      S('status', 'Status', ['Planned', 'Completed', 'Cancelled', 'Rescheduled'], { def: 'Planned', list: 1 }),
      R('account_id', 'Account', 'accounts', { list: 1 }), R('opportunity_id', 'Opportunity', 'opportunities'), R('event_id', 'Event', 'events'),
      LT('objective', 'Objective'), LT('agenda', 'Agenda'), LT('minutes', 'Minutes'), LT('decisions', 'Decisions'), S('calendar_type', 'Calendar', ['Personal', 'Team', 'Company'], { def: 'Personal' }),
    ],
    children: [{ entity: 'meeting_participants', fk: 'meeting_id', label: 'Attendees' }],
  },
  {
    key: 'meeting_participants', table: 'meeting_participants', label: 'Meeting Attendee', plural: 'Attendees', module: 'M31', title: 'id', scopeParent: { fk: 'meeting_id', entity: 'meetings', orOwn: true },
    fields: [R('meeting_id', 'Meeting', 'meetings', { req: 1, hide: 1 }), R('user_id', 'Internal attendee', 'users', { list: 1 }), R('contact_id', 'External contact', 'contacts', { list: 1 }),
      S('attendee_role', 'Role', ['Required', 'Optional', 'Organiser', 'Presenter'], { def: 'Required', list: 1 }),
      S('response', 'Response', ['Pending', 'Accepted', 'Tentative', 'Declined'], { def: 'Pending', list: 1 }), S('attendance', 'Attendance', ['Unknown', 'Attended', 'No-show', 'Excused'], { def: 'Unknown', list: 1 })],
  },
  {
    key: 'calendar_events', table: 'calendar_events', label: 'Company Calendar Entry', plural: 'Company Calendar', module: 'M31', title: 'title', noScope: true,
    fields: [T('title', 'Title', { req: 1, list: 1 }), S('calendar_type', 'Type', ['Public holiday', 'Company event', 'Blackout / freeze', 'Team event'], { req: 1, list: 1 }), S('country', 'Country', 'countries', { list: 1 }),
      D('start_date', 'Start', { req: 1, list: 1 }), D('end_date', 'End', { req: 1, list: 1 }), B('non_working', 'Non-working day', { def: false, list: 1 }), LT('description', 'Description')],
  },

  // ------------------------------------------------------------ M34 Events
  {
    key: 'events', table: 'events', label: 'Event', plural: 'Events', module: 'M34', prefix: 'EVT', title: 'name', owned: true, statusField: 'status', ownerLabel: 'Organiser',
    fields: [T('name', 'Event name', { req: 1, list: 1, search: 1 }), S('event_type', 'Type', ['Webinar', 'Roadshow', 'Trade show', 'Customer workshop', 'Partner summit', 'Training', 'Internal'], { req: 1, list: 1 }),
      S('status', 'Status', ['Draft', 'Budget pending', 'Approved', 'Open for registration', 'In progress', 'Completed', 'Cancelled'], { def: 'Draft', list: 1, sys: 1 }),
      DT('start_at', 'Start', { req: 1, list: 1 }), DT('end_at', 'End', { req: 1 }), T('venue', 'Venue / link', { list: 1 }), S('country', 'Country', 'countries'),
      R('campaign_id', 'Campaign', 'campaigns'), R('bu_id', 'Department / BU', 'business_units'), I('capacity', 'Capacity'), M('budget', 'Budget'), S('currency', 'Currency', 'currencies', { def: 'USD' }),
      M('actual_cost', 'Actual cost (from claims)', { readonly: 1 }), I('registered_count', 'Registered', { readonly: 1, list: 1 }), I('attended_count', 'Attended', { readonly: 1, list: 1 }),
      I('leads_generated', 'Leads generated', { readonly: 1 }), M('pipeline_influenced', 'Pipeline influenced', { readonly: 1 }), B('published', 'Published to employees', { def: false }), LT('description', 'Description'), R('approval_request_id', 'Budget approval', 'approval_requests', { readonly: 1 })],
    children: [{ entity: 'event_registrations', fk: 'event_id', label: 'Registrations' }, { entity: 'claims', fk: 'event_id', label: 'Claims' }],
  },
  {
    key: 'event_registrations', table: 'event_registrations', label: 'Event Registration', plural: 'Registrations', module: 'M34', title: 'attendee_name',
    scopeParent: { fk: 'event_id', entity: 'events', orOwn: true },
    fields: [R('event_id', 'Event', 'events', { req: 1, hide: 1 }), T('attendee_name', 'Attendee', { req: 1, list: 1, search: 1 }), E('attendee_email', 'Email', { list: 1 }), T('company', 'Company', { list: 1 }),
      R('contact_id', 'Contact', 'contacts'), R('user_id', 'Employee', 'users'), R('account_id', 'Account', 'accounts'),
      S('status', 'Status', ['Invited', 'Registered', 'Waitlisted', 'Attended', 'No-show', 'Cancelled'], { def: 'Registered', list: 1 }), T('dietary', 'Dietary / accessibility', { sec: 'personal' }), B('lead_created', 'Lead created', { readonly: 1, def: false })],
  },

  // ------------------------------------------------------------ M35 Claims
  {
    key: 'claim_categories', table: 'claim_categories', label: 'Claim Category', plural: 'Claim Categories', module: 'M35', title: 'name', noScope: true,
    fields: [T('code', 'Code', { req: 1, list: 1, uniq: 1 }), T('name', 'Name', { req: 1, list: 1 }), M('limit_per_claim', 'Limit per line', { list: 1 }), M('receipt_threshold', 'Receipt required above', { list: 1, def: 25 }),
      B('requires_attendees', 'Requires attendee list', { def: false, list: 1 }), B('requires_event', 'Requires event / project link', { def: false }), S('status', 'Status', ['Active', 'Inactive'], { def: 'Active', list: 1 })],
  },
  {
    key: 'claims', table: 'claims', label: 'Expense Claim', plural: 'Claims & Reimbursement', module: 'M35', prefix: 'CLM', title: 'title', owned: true, statusField: 'status', ownerLabel: 'Claimant', sec: 'claim',
    fields: [T('title', 'Claim title', { req: 1, list: 1, search: 1 }), LT('purpose', 'Business purpose', { req: 1 }), D('claim_date', 'Claim date', { req: 1, list: 1 }),
      S('currency', 'Claim currency', 'currencies', { req: 1, def: 'USD', list: 1 }), M('total_amount', 'Total claimed', { list: 1, readonly: 1 }), M('approved_amount', 'Approved amount', { list: 1, readonly: 1 }),
      S('status', 'Claim status', ['Draft', 'Submitted', 'In approval', 'Returned', 'Rejected', 'Pending finance verification', 'Approved', 'Withdrawn', 'Cancelled'], { def: 'Draft', list: 1, sys: 1 }),
      S('payment_status', 'Payment status', ['Not ready', 'Ready for payment', 'In batch', 'Paid', 'Failed', 'Reversed'], { def: 'Not ready', list: 1, sys: 1 }),
      R('event_id', 'Event', 'events'), R('project_id', 'Project', 'projects'), R('opportunity_id', 'Opportunity', 'opportunities'), R('account_id', 'Customer', 'accounts'),
      R('on_behalf_of', 'Prepared on behalf of', 'users', { readonly: 1 }), R('approval_request_id', 'Approval request', 'approval_requests', { readonly: 1 }), R('batch_id', 'Payment batch', 'claim_batches', { readonly: 1 }),
      R('verified_by', 'Verified by', 'users', { readonly: 1 }), DT('verified_at', 'Verified at', { readonly: 1 }), T('payment_reference', 'Payment reference', { readonly: 1 }), DT('paid_at', 'Paid at', { readonly: 1 }),
      DT('submitted_at', 'Submitted', { readonly: 1 }), LT('finance_note', 'Finance note')],
    children: [{ entity: 'claim_lines', fk: 'claim_id', label: 'Expense lines' }],
  },
  {
    key: 'claim_lines', table: 'claim_lines', label: 'Claim Line', plural: 'Claim Lines', module: 'M35', title: 'description', scopeParent: { fk: 'claim_id', entity: 'claims', orOwn: true }, sec: 'claim',
    fields: [R('claim_id', 'Claim', 'claims', { req: 1, hide: 1 }), R('category_id', 'Category', 'claim_categories', { req: 1, list: 1 }), D('expense_date', 'Expense date', { req: 1, list: 1 }),
      T('merchant', 'Merchant / vendor', { list: 1 }), T('description', 'Description', { req: 1, list: 1 }), M('amount', 'Amount', { req: 1, list: 1 }), S('currency', 'Currency', 'currencies', { req: 1, def: 'USD' }),
      N('fx_rate', 'FX to claim ccy', { def: 1, scale: 6 }), M('claim_amount', 'Amount (claim ccy)', { list: 1, readonly: 1 }), M('approved_amount', 'Approved amount', { list: 1, readonly: 1 }),
      B('receipt_attached', 'Receipt attached', { def: false, list: 1 }), T('receipt_ref', 'Receipt reference'), LT('attendees', 'Attendees (entertainment)'), T('adjust_reason', 'Adjustment reason', { readonly: 1 }),
      J('policy_flags', 'Policy flags', { readonly: 1 })],
  },
  {
    key: 'claim_batches', table: 'claim_batches', label: 'Reimbursement Batch', plural: 'Reimbursement Batches', module: 'M35', prefix: 'PAY', title: 'number', noScope: true, statusField: 'status', system: 1,
    fields: [S('status', 'Status', ['Draft', 'Pending authorisation', 'Authorised', 'Sent to payment', 'Paid', 'Partially paid', 'Failed'], { def: 'Draft', list: 1 }), I('claim_count', 'Claims', { list: 1 }),
      M('total_amount', 'Total', { list: 1 }), S('currency', 'Currency', 'currencies', { def: 'USD' }), D('payment_date', 'Payment date', { list: 1 }), T('bank_reference', 'Bank / accounting reference'), R('prepared_by', 'Prepared by', 'users'), R('authorised_by', 'Authorised by', 'users')],
  },

  // ------------------------------------------------------------ M25 / M23 Integration, import
  {
    key: 'integrations', table: 'integrations', label: 'Integration', plural: 'Integrations', module: 'M25', title: 'name', noScope: true,
    fields: [T('code', 'Code', { req: 1, list: 1, uniq: 1 }), T('name', 'Name', { req: 1, list: 1 }), T('direction', 'Direction', { list: 1 }), S('status', 'Status', ['Not configured', 'Configured', 'Active', 'Error', 'Disabled'], { def: 'Not configured', list: 1 }),
      T('endpoint', 'Endpoint / connector'), S('auth_type', 'Authentication', ['OAuth 2.0', 'API key', 'SAML / OIDC', 'SFTP key', 'Service principal', 'None']), { name: 'secret', label: 'Secret / API key (write-only)', type: 'text', virtual: 1, secret: 1 },
      DT('last_sync_at', 'Last sync', { list: 1, readonly: 1 }), LT('notes', 'Notes'), S('priority', 'Release phase', ['1', '2', '3', '4'], { list: 1 })],
  },
  {
    key: 'import_jobs', table: 'import_jobs', label: 'Import Job', plural: 'Import History', module: 'M23', prefix: 'IMP', title: 'number', owned: true, system: 1,
    fields: [T('entity', 'Entity', { list: 1 }), T('filename', 'File', { list: 1 }), S('mode', 'Mode', ['Validate only', 'Commit'], { list: 1 }), I('rows_total', 'Rows', { list: 1 }), I('rows_ok', 'Valid', { list: 1 }),
      I('rows_failed', 'Failed', { list: 1 }), S('status', 'Status', ['Validated', 'Completed', 'Failed'], { list: 1 }), J('errors', 'Errors')],
  },
];
