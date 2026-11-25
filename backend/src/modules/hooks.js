'use strict';
// Business rules & actions for the supporting entities (accounts, contacts, users, products, prices, tasks, activities, partners, configs ...).
const bcrypt = require('bcryptjs');
const db = require('../db');
const A = require('../core/access');
const hooks = require('../core/hooks');
const settings = require('../core/settings');
const { audit } = require('../core/audit');
const { notify } = require('../core/notify');
const { nextNumber } = require('../core/numbering');
const { bad, forbidden, notFound } = require('../core/errors');
const { entities } = require('../entities');
const { checkPassword } = require('./auth');
const approvals = require('./approvals');

const today = () => new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------------ contacts
hooks.register('contacts', {
  async validate(ctx, v) {
    const errs = [];
    if (!v.email && !v.phone && !v.mobile) errs.push({ field: 'email', message: 'At least one contact method (email, phone or mobile) is required (BRULE-CON-001)' });
    if (!v.account_id && !v.partner_id && !v.vendor_id) errs.push({ field: 'account_id', message: 'A contact must belong to an account, partner or vendor' });
    return errs;
  },
  beforeValidate(ctx, v, existing) {
    const f = v.first_name !== undefined ? v.first_name : existing && existing.first_name;
    const l = v.last_name !== undefined ? v.last_name : existing && existing.last_name;
    v.full_name = [f, l].filter(Boolean).join(' ');
    if ((v.consent_email || v.consent_phone) && !v.consent_date) v.consent_date = today();
  },
});
entities.contacts.actions = {
  anonymise: {
    label: 'Anonymise (GDPR / retention)', perm: 'D', confirm: 'Irreversibly remove personal data from this contact?',
    async run(ctx, c) {
      if (!A.roleHas(ctx, 'ROL-ADM', 'ROL-SOP')) throw forbidden('Only Sales Operations or an administrator can anonymise contacts');
      await db.query(`UPDATE contacts SET first_name='Anonymised', last_name='Contact', full_name='Anonymised Contact', email=NULL, phone=NULL, mobile=NULL, date_of_birth=NULL, notes=NULL, status='Inactive', anonymised=true, modified_by=$2, modified_at=now(), version=version+1 WHERE id=$1`, [c.id, ctx.id]);
      await audit(ctx, { event: 'anonymise', entity: 'contacts', recordId: c.id, label: c.full_name });
    },
  },
};

// ------------------------------------------------------------------ accounts
hooks.register('accounts', {
  async validate(ctx, v, existing) {
    const errs = [];
    if (v.parent_id && existing && Number(v.parent_id) === existing.id) errs.push({ field: 'parent_id', message: 'An account cannot be its own parent' });
    if (v.parent_id && existing) { // hierarchy cycle check
      const { rows } = await db.query(`WITH RECURSIVE up AS (SELECT id, parent_id FROM accounts WHERE id=$1 UNION SELECT a.id, a.parent_id FROM accounts a JOIN up ON a.id=up.parent_id) SELECT 1 FROM up WHERE id=$2`, [v.parent_id, existing.id]);
      if (rows.length) errs.push({ field: 'parent_id', message: 'This would create a circular hierarchy' });
    }
    return errs;
  },
  async afterUpdate(ctx, rec, old, c, changes) {
    if (changes.owner_id) await notify(rec.owner_id, { type: 'assignment', title: `Account assigned to you: ${rec.legal_name}`, entity: 'accounts', recordId: rec.id }, c);
  },
  async decorateOne(o) {
    const { rows } = await db.query(`SELECT count(*)::int n, coalesce(sum(amount_base),0)::float pipe FROM opportunities WHERE account_id=$1 AND status='Open' AND is_deleted=false`, [o.id]);
    const { rows: won } = await db.query(`SELECT coalesce(sum(amount_base),0)::float won FROM opportunities WHERE account_id=$1 AND status='Won' AND is_deleted=false`, [o.id]);
    const { rows: sub } = await db.query('SELECT id, legal_name, number FROM accounts WHERE parent_id=$1 AND is_deleted=false ORDER BY legal_name', [o.id]);
    o._360 = { open_opportunities: rows[0].n, open_pipeline: rows[0].pipe, won_total: won[0].won, subsidiaries: sub };
    return o;
  },
});
entities.accounts.actions = {
  merge: {
    label: 'Merge into another account', perm: 'D', prompt: 'target_id',
    async run(ctx, src, b) {
      if (!A.roleHas(ctx, 'ROL-ADM', 'ROL-SOP')) throw forbidden('Only Sales Operations or an administrator can merge accounts');
      const target = Number(b.target_id);
      if (!target || target === src.id) throw bad('Choose a different target account');
      await db.tx(async (c) => {
        for (const t of ['contacts', 'opportunities', 'quotations', 'activities', 'tasks', 'contracts', 'projects', 'meetings', 'account_plans', 'deal_registrations']) {
          const col = 'account_id'; await c.query(`UPDATE ${t} SET ${col}=$1 WHERE ${col}=$2`, [target, src.id]);
        }
        await c.query(`UPDATE accounts SET parent_id=$1 WHERE parent_id=$2`, [target, src.id]);
        await c.query(`UPDATE accounts SET is_deleted=true, deleted_by=$2, deleted_at=now(), status='Inactive', description=coalesce(description,'') || $3 WHERE id=$1`, [src.id, ctx.id, `\nMerged into account #${target}`]);
        await audit(ctx, { event: 'merge', entity: 'accounts', recordId: src.id, label: src.legal_name, detail: `merged into #${target}` }, c);
      });
    },
  },
};

// --------------------------------------------------------------------- users
hooks.register('users', {
  beforeValidate(ctx, v, existing, raw) { if (raw && raw.password) v.password = raw.password; },
  async validate(ctx, v, existing) {
    const errs = [];
    if (!existing && !v.password) errs.push({ field: 'password', message: 'Initial password is required' });
    if (v.password) { const e = checkPassword(v.password); if (e) errs.push({ field: 'password', message: e }); }
    if (v.manager_id && existing && Number(v.manager_id) === existing.id) errs.push({ field: 'manager_id', message: 'A user cannot be their own manager' });
    return errs;
  },
  async beforeCreate(ctx, v) { v.password_hash = await bcrypt.hash(v.password, 10); v.must_change_password = true; v.created_by = ctx.id; },
  async beforeUpdate(ctx, v, existing, c) {
    if (v.password) { v.password_hash = await bcrypt.hash(v.password, 10); v.token_version = (existing.token_version || 1) + 1; }
    // effective-dated reporting line history (FR-ORG-005)
    if (v.manager_id !== undefined && Number(v.manager_id || 0) !== Number(existing.manager_id || 0)) {
      await c.query(`UPDATE reporting_lines SET effective_to = current_date - 1 WHERE employee_id=$1 AND purpose='Primary' AND effective_to IS NULL`, [existing.id]);
      if (v.manager_id) await c.query(`INSERT INTO reporting_lines (employee_id, manager_id, purpose, effective_from, reason, created_by) VALUES ($1,$2,'Primary',current_date,'Manager changed',$3)`, [existing.id, v.manager_id, ctx.id]);
    }
    if (v.status && v.status !== existing.status && ['Suspended', 'Deactivated'].includes(v.status)) {
      v.token_version = (existing.token_version || 1) + 1;   // revoke sessions
      // BRULE-OPP-001: reassign open records of a deactivated owner to their manager's queue
      const mgr = existing.manager_id;
      if (mgr) {
        for (const t of ['opportunities', 'leads', 'accounts']) {
          const open = t === 'opportunities' ? `AND status='Open'` : t === 'leads' ? `AND status NOT IN ('Converted','Disqualified')` : '';
          await c.query(`UPDATE ${t} SET owner_id=$1 WHERE owner_id=$2 AND is_deleted=false ${open}`, [mgr, existing.id]);
        }
        await c.query(`UPDATE tasks SET owner_id=$1 WHERE owner_id=$2 AND status IN ('Not started','In progress','Blocked')`, [mgr, existing.id]);
        await notify(mgr, { type: 'reassignment', title: `Records reassigned from ${existing.name}`, body: 'Open opportunities, leads and tasks were moved to you because the owner was deactivated.' }, c);
      }
    }
  },
  async afterCreate(ctx, rec, c) {
    if (rec.manager_id) await c.query(`INSERT INTO reporting_lines (employee_id, manager_id, purpose, effective_from, reason, created_by) VALUES ($1,$2,'Primary',current_date,'Initial assignment',$3)`, [rec.id, rec.manager_id, ctx.id]);
  },
});

// ------------------------------------------------------- products & pricing
hooks.register('products', {
  validate(ctx, v) {
    const errs = [];
    if (v.eol_date && v.eos_date && v.eol_date < v.eos_date) errs.push({ field: 'eol_date', message: 'End-of-life cannot be before end-of-sale' });
    if (Number(v.list_price) < 0) errs.push({ field: 'list_price', message: 'List price cannot be negative' });
    if (v.recurring && !v.billing_months) errs.push({ field: 'billing_months', message: 'Recurring products need a billing period' });
    return errs;
  },
});
async function overlap(table, v, existing, extraWhere) {
  const id = existing ? existing.id : 0;
  const { rows } = await db.query(
    `SELECT id FROM ${table} WHERE is_deleted=false AND id<>$1 AND ${extraWhere} AND daterange(valid_from, valid_to, '[]') && daterange($2::date, $3::date, '[]') LIMIT 1`,
    [id, v.valid_from, v.valid_to || null].concat([v.product_id, v.price_list || v.cost_source || '', v.currency, v.min_qty || 1]));
  return rows.length > 0;
}
hooks.register('price_records', {
  async validate(ctx, v, existing) {
    const errs = [];
    if (v.valid_to && v.valid_to < v.valid_from) errs.push({ field: 'valid_to', message: 'Valid-to cannot be before valid-from' });
    if (Number(v.price) < 0) errs.push({ field: 'price', message: 'Price cannot be negative' });
    if (!errs.length && await overlap('price_records', v, existing, 'product_id=$4 AND price_list=$5 AND currency=$6 AND min_qty=$7')) errs.push({ field: 'valid_from', message: 'Overlapping validity period for the same product, price list, currency and quantity break (BRULE-PRC-001)' });
    return errs;
  },
});
hooks.register('cost_records', {
  validate(ctx, v) {
    const errs = [];
    if (v.valid_to && v.valid_to < v.valid_from) errs.push({ field: 'valid_to', message: 'Valid-to cannot be before valid-from' });
    if (Number(v.cost) < 0) errs.push({ field: 'cost', message: 'Cost cannot be negative' });
    if (['Vendor quote', 'Special bid'].includes(v.cost_source) && !v.vendor_ref) errs.push({ field: 'vendor_ref', message: 'Vendor quote / bid reference is required for this cost source' });
    return errs;
  },
});
hooks.register('exchange_rates', {
  validate(ctx, v) { const e = []; if (!(Number(v.rate) > 0)) e.push({ field: 'rate', message: 'Rate must be greater than zero' }); if (v.from_ccy === v.to_ccy) e.push({ field: 'to_ccy', message: 'Currencies must differ' }); return e; },
});

// ---------------------------------------------------------------- activities
hooks.register('activities', {
  async beforeCreate(ctx, v, c) {
    const { rows } = await c.query('SELECT t.name, u.org_unit_id FROM users u LEFT JOIN teams t ON t.id=u.team_id WHERE u.id=$1', [v.owner_id]);
    v.owner_team_snapshot = rows[0] && rows[0].name; v.org_unit_snapshot = rows[0] && rows[0].org_unit_id;   // org snapshot at time of activity (FR-ACTR)
  },
  async afterCreate(ctx, a, c) {
    if (a.status === 'Completed') {
      if (a.opportunity_id) await c.query('UPDATE opportunities SET last_activity_at=now() WHERE id=$1', [a.opportunity_id]);
      if (a.lead_id) await c.query(`UPDATE leads SET first_response_at=COALESCE(first_response_at, now()), status=CASE WHEN status IN ('New','Pending acceptance') THEN 'Working' ELSE status END WHERE id=$1`, [a.lead_id]);
    }
  },
});

// --------------------------------------------------------------------- tasks
hooks.register('tasks', {
  async beforeCreate(ctx, v) { v.assigned_by = ctx.id; if (v.opportunity_id && !v.related_label) { v.related_entity = 'opportunities'; v.related_id = v.opportunity_id; } },
  async beforeUpdate(ctx, v, existing) {
    if (v.status === 'Completed' && existing.status !== 'Completed') { v.completed_at = new Date().toISOString(); v.escalation_status = 'None'; }
    if (v.status && v.status !== 'Completed' && existing.status === 'Completed') v.completed_at = null;
    if (v.status === 'Blocked' && !(v.blocked_reason || existing.blocked_reason)) throw bad('A blocked reason is required');
  },
  async afterUpdate(ctx, t, old, c) {
    if (t.status === 'Completed' && old.status !== 'Completed' && t.recurrence && t.recurrence !== 'None' && t.due_at) {
      const d = new Date(t.due_at); if (t.recurrence === 'Daily') d.setDate(d.getDate() + 1); else if (t.recurrence === 'Weekly') d.setDate(d.getDate() + 7); else d.setMonth(d.getMonth() + 1);
      const n = await nextNumber('TSK', c);
      await c.query(`INSERT INTO tasks (number, owner_id, subject, description, priority, due_at, category, recurrence, related_entity, related_id, related_label, account_id, opportunity_id, assigned_by, created_by, modified_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$14)`, [n, t.owner_id, t.subject, t.description, t.priority, d.toISOString(), t.category, t.recurrence, t.related_entity, t.related_id, t.related_label, t.account_id, t.opportunity_id, ctx.id]);
    }
    if (old.owner_id !== t.owner_id) await notify(t.owner_id, { type: 'task', title: `Task assigned: ${t.subject}`, entity: 'tasks', recordId: t.id }, c);
  },
  async afterCreate(ctx, t, c) {
    if (t.owner_id !== ctx.id) await notify(t.owner_id, { type: 'task', title: `Task assigned: ${t.subject}`, body: t.due_at ? `Due ${String(t.due_at).slice(0, 10)}` : '', entity: 'tasks', recordId: t.id }, c);
  },
});
entities.tasks.actions = {
  claim: { label: 'Take from queue', perm: 'E', async run(ctx, t) { if (t.owner_id && t.queue === null) throw bad('Task is not in a queue'); await db.query(`UPDATE tasks SET owner_id=$2, queue=NULL, status='In progress' WHERE id=$1`, [t.id, ctx.id]); await audit(ctx, { event: 'task_claimed', entity: 'tasks', recordId: t.id, label: t.subject }); } },
  complete: { label: 'Complete', perm: 'E', async run(ctx, t) { await db.tx(async (c) => { await c.query(`UPDATE tasks SET status='Completed', completed_at=now(), escalation_status='None', modified_by=$2, modified_at=now(), version=version+1 WHERE id=$1`, [t.id, ctx.id]); await hooks.get('tasks').afterUpdate(ctx, { ...t, status: 'Completed' }, t, c); await audit(ctx, { event: 'task_completed', entity: 'tasks', recordId: t.id, label: t.subject }, c); }); } },
};

// ------------------------------------------------------------------ partners
approvals.registerHandler('partner', {
  async onApproved(ctx, req, info, c) { await c.query(`UPDATE partners SET status='Active', onboarded_at=now() WHERE id=$1`, [req.record_id]); },
  async onRejected(ctx, req, info, c) { await c.query(`UPDATE partners SET status='Returned' WHERE id=$1`, [req.record_id]); },
  async onReturned(ctx, req, info, c) { await c.query(`UPDATE partners SET status='Returned' WHERE id=$1`, [req.record_id]); },
});
entities.partners.actions = {
  submit_onboarding: {
    label: 'Submit for onboarding approval', perm: 'S',
    async run(ctx, p) {
      if (!['Applied', 'Returned'].includes(p.status)) throw bad('Only applied/returned partners can be submitted');
      const miss = [];
      if (!p.tax_id) miss.push('Tax ID'); if (!p.agreement_start) miss.push('Agreement start date'); if (!p.partner_type) miss.push('Partner type');
      if (miss.length) throw bad('Onboarding checklist incomplete', { checklist: miss });
      return db.tx(async (c) => {
        const r = await approvals.submit(ctx, { type: 'partner', entity: 'partners', recordId: p.id, label: p.name, snapshot: { partner_tier: p.tier, country: p.country } }, c);
        await c.query(`UPDATE partners SET status='Under review' WHERE id=$1`, [p.id]);
        if (!r.required) { await c.query(`UPDATE partners SET status='Active', onboarded_at=now() WHERE id=$1`, [p.id]); }
        return { approval: r.required ? r.request.number : 'auto-approved' };
      });
    },
  },
  suspend: { label: 'Suspend partner', perm: 'E', prompt: 'reason', async run(ctx, p, b) { if (!b.reason) throw bad('Reason required'); await db.query(`UPDATE partners SET status='Suspended' WHERE id=$1`, [p.id]); await audit(ctx, { event: 'partner_suspended', entity: 'partners', recordId: p.id, label: p.name, detail: b.reason }); } },
  reactivate: { label: 'Reactivate partner', perm: 'E', async run(ctx, p) { await db.query(`UPDATE partners SET status='Active' WHERE id=$1`, [p.id]); await audit(ctx, { event: 'partner_reactivated', entity: 'partners', recordId: p.id, label: p.name }); } },
};
hooks.register('partners', {
  async decorateOne(o) {
    const { rows } = await db.query(`SELECT count(*)::int n, coalesce(sum(amount_base) FILTER (WHERE status='Won'),0)::float won, coalesce(sum(amount_base) FILTER (WHERE status='Open'),0)::float open FROM opportunities WHERE primary_partner_id=$1 AND is_deleted=false`, [o.id]);
    o._performance = { opportunities: rows[0].n, won: rows[0].won, open_pipeline: rows[0].open };
    return o;
  },
});

// ------------------------------------------------------ solution configuration
entities.solution_configs.actions = {
  submit_review: { label: 'Submit for validation', perm: 'E', async run(ctx, cfg) {
    if (cfg.status !== 'Draft' && cfg.status !== 'Rejected') throw bad('Only draft or rejected configurations can be submitted');
    const { rows } = await db.query('SELECT count(*)::int n FROM bom_lines WHERE config_id=$1 AND is_deleted=false', [cfg.id]);
    if (!rows[0].n) throw bad('Add at least one BOM line before submitting');
    await db.query(`UPDATE solution_configs SET status='In review' WHERE id=$1`, [cfg.id]); await audit(ctx, { event: 'config_submitted', entity: 'solution_configs', recordId: cfg.id, label: cfg.name });
  } },
  validate: { label: 'Validate (technical)', perm: 'A', async run(ctx, cfg) {
    if (cfg.status !== 'In review') throw bad('Configuration is not in review');
    if (!A.roleHas(ctx, 'ROL-PSE', 'ROL-TE', 'ROL-ADM')) throw forbidden('Only presales / technical engineers can validate configurations');
    if (cfg.owner_id === ctx.id && !ctx.isAdmin) throw forbidden('Validation requires a second person (separation of duties)');
    await db.query(`UPDATE solution_configs SET status='Validated', validated_by=$2, validated_at=now() WHERE id=$1`, [cfg.id, ctx.id]); await audit(ctx, { event: 'config_validated', entity: 'solution_configs', recordId: cfg.id, label: cfg.name });
  } },
  reject: { label: 'Return / reject', perm: 'A', prompt: 'reason', async run(ctx, cfg, b) { if (!b.reason) throw bad('Reason required'); await db.query(`UPDATE solution_configs SET status='Rejected' WHERE id=$1`, [cfg.id]); await audit(ctx, { event: 'config_rejected', entity: 'solution_configs', recordId: cfg.id, label: cfg.name, detail: b.reason }); } },
  vendor_validate: { label: 'Record vendor validation', perm: 'E', prompt: 'ref', async run(ctx, cfg, b) { if (cfg.status !== 'Validated') throw bad('Only validated configurations can be vendor validated'); if (!b.ref) throw bad('Vendor validation reference required'); await db.query(`UPDATE solution_configs SET status='Vendor validated', vendor_validation_ref=$2 WHERE id=$1`, [cfg.id, b.ref]); await audit(ctx, { event: 'config_vendor_validated', entity: 'solution_configs', recordId: cfg.id, label: cfg.name, detail: b.ref }); } },
  new_version: { label: 'New version', perm: 'C', async run(ctx, cfg) {
    return db.tx(async (c) => {
      const num = await nextNumber('CFG', c);
      const { rows } = await c.query(`INSERT INTO solution_configs (number, owner_id, opportunity_id, requirement_id, name, version_no, status, assumptions, exclusions, risks, created_by, modified_by) VALUES ($1,$2,$3,$4,$5,$6,'Draft',$7,$8,$9,$2,$2) RETURNING id`,
        [num, ctx.id, cfg.opportunity_id, cfg.requirement_id, cfg.name, cfg.version_no + 1, cfg.assumptions, cfg.exclusions, cfg.risks]);
      await c.query(`INSERT INTO bom_lines (config_id, section, product_id, description, quantity, uom, optional, notes, created_by, modified_by) SELECT $1, section, product_id, description, quantity, uom, optional, notes, $3, $3 FROM bom_lines WHERE config_id=$2 AND is_deleted=false`, [rows[0].id, cfg.id, ctx.id]);
      await c.query(`UPDATE solution_configs SET status='Superseded' WHERE id=$1`, [cfg.id]);
      await audit(ctx, { event: 'config_new_version', entity: 'solution_configs', recordId: rows[0].id, label: cfg.name }, c);
      return { id: rows[0].id };
    });
  } },
};
hooks.register('bom_lines', {
  async validate(ctx, v) {
    const errs = [];
    if (!(Number(v.quantity) > 0)) errs.push({ field: 'quantity', message: 'Quantity must be greater than zero' });
    const { rows } = await db.query('SELECT status FROM solution_configs WHERE id=$1', [v.config_id]);
    if (rows[0] && ['Validated', 'Vendor validated'].includes(rows[0].status)) errs.push({ field: 'config_id', message: 'BOM is locked once the configuration is validated (BRULE-SIZ-004)' });
    return errs;
  },
});

// --------------------------------------------------------------- sales targets
approvals.registerHandler('target', {
  async onApproved(ctx, req, i, c) { await c.query(`UPDATE sales_targets SET status='Active' WHERE id=$1`, [req.record_id]); },
  async onRejected(ctx, req, i, c) { await c.query(`UPDATE sales_targets SET status='Draft' WHERE id=$1`, [req.record_id]); },
  async onReturned(ctx, req, i, c) { await c.query(`UPDATE sales_targets SET status='Draft' WHERE id=$1`, [req.record_id]); },
});
hooks.register('sales_targets', {
  validate(ctx, v) {
    const e = [];
    if (v.period_end && v.period_start && v.period_end < v.period_start) e.push({ field: 'period_end', message: 'Period end cannot be before start' });
    if (!(Number(v.target_value) >= 0)) e.push({ field: 'target_value', message: 'Target must be zero or positive' });
    return e;
  },
});
entities.sales_targets.actions = {
  submit: { label: 'Submit for approval', perm: 'S', async run(ctx, t) {
    if (t.status !== 'Draft') throw bad('Only draft targets can be submitted');
    return db.tx(async (c) => {
      const r = await approvals.submit(ctx, { type: 'target', entity: 'sales_targets', recordId: t.id, label: `${t.period_label} ${t.measure}`, amount: t.target_value, currency: t.currency, snapshot: { amount_base: t.target_value } }, c);
      if (!r.required) await c.query(`UPDATE sales_targets SET status='Active' WHERE id=$1`, [t.id]); else await c.query(`UPDATE sales_targets SET status='Submitted' WHERE id=$1`, [t.id]);
      return { approval: r.required ? r.request.number : 'auto-approved' };
    });
  } },
};

// ----------------------------------------------------------------- contracts
hooks.register('contracts', {
  validate(ctx, v) { const e = []; if (v.end_date && v.start_date && v.end_date < v.start_date) e.push({ field: 'end_date', message: 'End date must be after start date' }); return e; },
  async afterCreate(ctx, c0, c) {
    if (['Active', 'Expiring'].includes(c0.status)) {
      const n = await nextNumber('REN', c);
      await c.query(`INSERT INTO renewals (number, owner_id, contract_id, due_date, status, expected_value, created_by, modified_by) VALUES ($1,$2,$3,$4,'Upcoming',$5,$2,$2)`, [n, c0.owner_id, c0.id, c0.end_date, c0.value]);
    }
  },
});
entities.renewals.actions = {
  create_opportunity: {
    label: 'Create renewal opportunity', perm: 'C',
    async run(ctx, r) {
      if (r.opportunity_id) throw bad('A renewal opportunity already exists');
      const { rows: ct } = await db.query('SELECT c.*, a.country FROM contracts c JOIN accounts a ON a.id=c.account_id WHERE c.id=$1', [r.contract_id]);
      const k = ct[0]; const { rows: bu } = await db.query('SELECT id FROM business_units WHERE is_deleted=false ORDER BY id LIMIT 1');
      return db.tx(async (c) => {
        const num = await nextNumber('OPP', c);
        const fx = require('../core/fx');
        const amount = r.expected_value || k.value;
        const { rows } = await c.query(`INSERT INTO opportunities (number, owner_id, name, account_id, opp_type, route, source, stage, status, probability, forecast_category, amount, currency, amount_base, close_date, bu_id, country, stage_entered_at, last_activity_at, created_by, modified_by)
          VALUES ($1,$2,$3,$4,'Renewal','Direct','Existing customer','S01','Open',5,'Pipeline',$5,$6,$7,$8,$9,$10,now(),now(),$2,$2) RETURNING id`,
          [num, r.owner_id, `Renewal: ${k.name}`, k.account_id, amount, k.currency, await fx.toBase(amount, k.currency, null, c), r.due_date > today() ? r.due_date : today(), bu[0] && bu[0].id, k.country]);
        await c.query(`UPDATE renewals SET opportunity_id=$2, status='In progress' WHERE id=$1`, [r.id, rows[0].id]);
        await c.query(`UPDATE contracts SET renewal_opportunity_id=$2 WHERE id=$1`, [k.id, rows[0].id]);
        await c.query('INSERT INTO opportunity_stage_history (opportunity_id, to_stage, changed_by, probability, reason) VALUES ($1,$2,$3,$4,$5)', [rows[0].id, 'S01', ctx.id, 5, 'Created from renewal']);
        await audit(ctx, { event: 'renewal_opportunity', entity: 'renewals', recordId: r.id, label: r.number, detail: num }, c);
        return { opportunity_id: rows[0].id };
      });
    },
  },
};

// ------------------------------------------------------------------ campaigns
hooks.register('campaigns', {
  async decorateOne(o) { const { rows } = await db.query('SELECT count(*)::int n FROM leads WHERE campaign_id=$1 AND is_deleted=false', [o.id]); o.leads_generated = rows[0].n; return o; },
});

module.exports = {};
