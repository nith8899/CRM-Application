-- ============================================================================
-- Enterprise CRM - core (hand-written) schema.
-- Business entities are generated from src/entities/* by src/migrate.js.
-- All timestamps are timestamptz (UTC); date-only business fields are DATE.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sequences (
  key        text NOT NULL,
  year       integer NOT NULL DEFAULT 0,
  last_value bigint  NOT NULL DEFAULT 0,
  PRIMARY KEY (key, year)
);

-- ---- Organisation (ENT-04 .. ENT-08) --------------------------------------
CREATE TABLE IF NOT EXISTS org_units (
  id bigserial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  country text NOT NULL,
  base_currency text NOT NULL DEFAULT 'USD',
  tax_id text,
  parent_id bigint REFERENCES org_units(id),
  status text NOT NULL DEFAULT 'Active',
  created_by bigint, created_at timestamptz NOT NULL DEFAULT now(),
  modified_by bigint, modified_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false, deleted_by bigint, deleted_at timestamptz,
  version integer NOT NULL DEFAULT 1, data_source text DEFAULT 'UI', legacy_id text
);
CREATE TABLE IF NOT EXISTS business_units (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  org_unit_id bigint REFERENCES org_units(id),
  margin_floor_pct numeric(6,2),
  status text NOT NULL DEFAULT 'Active',
  created_by bigint, created_at timestamptz NOT NULL DEFAULT now(),
  modified_by bigint, modified_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false, deleted_by bigint, deleted_at timestamptz,
  version integer NOT NULL DEFAULT 1, data_source text DEFAULT 'UI', legacy_id text
);
CREATE TABLE IF NOT EXISTS branches (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  org_unit_id bigint REFERENCES org_units(id),
  country text NOT NULL,
  address text,
  status text NOT NULL DEFAULT 'Active',
  created_by bigint, created_at timestamptz NOT NULL DEFAULT now(),
  modified_by bigint, modified_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false, deleted_by bigint, deleted_at timestamptz,
  version integer NOT NULL DEFAULT 1, data_source text DEFAULT 'UI', legacy_id text
);
CREATE TABLE IF NOT EXISTS teams (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  parent_id bigint REFERENCES teams(id),
  manager_id bigint,
  branch_id bigint REFERENCES branches(id),
  bu_id bigint REFERENCES business_units(id),
  status text NOT NULL DEFAULT 'Active',
  created_by bigint, created_at timestamptz NOT NULL DEFAULT now(),
  modified_by bigint, modified_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false, deleted_by bigint, deleted_at timestamptz,
  version integer NOT NULL DEFAULT 1, data_source text DEFAULT 'UI', legacy_id text
);

-- ---- Identity & access (ENT-01 .. ENT-03) ----------------------------------
CREATE TABLE IF NOT EXISTS users (
  id bigserial PRIMARY KEY,
  login text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'Active',        -- Invited, Active, Suspended, Deactivated
  user_type text NOT NULL DEFAULT 'internal',   -- internal / external
  phone text,
  job_title text,
  job_grade text,
  country text,
  org_unit_id bigint REFERENCES org_units(id),
  branch_id bigint REFERENCES branches(id),
  bu_id bigint REFERENCES business_units(id),
  team_id bigint REFERENCES teams(id),
  manager_id bigint REFERENCES users(id),
  partner_id bigint,                            -- for external partner users
  approval_limit numeric(18,2),                 -- approval authority (base currency)
  time_zone text NOT NULL DEFAULT 'UTC',
  locale text NOT NULL DEFAULT 'en',
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  token_version integer NOT NULL DEFAULT 1,
  must_change_password boolean NOT NULL DEFAULT false,
  created_by bigint, created_at timestamptz NOT NULL DEFAULT now(),
  modified_by bigint, modified_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false, deleted_by bigint, deleted_at timestamptz,
  version integer NOT NULL DEFAULT 1, data_source text DEFAULT 'UI', legacy_id text
);
CREATE INDEX IF NOT EXISTS ix_users_manager ON users(manager_id);
CREATE INDEX IF NOT EXISTS ix_users_team ON users(team_id);

CREATE TABLE IF NOT EXISTS roles (
  id bigserial PRIMARY KEY,
  code text NOT NULL UNIQUE,                    -- e.g. ROL-SE
  name text NOT NULL,
  description text,
  type text NOT NULL DEFAULT 'Functional',
  internal boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'Active'
);
CREATE TABLE IF NOT EXISTS user_roles (
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE TABLE IF NOT EXISTS permissions (
  id bigserial PRIMARY KEY,
  role_code text NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  module text NOT NULL,                         -- M01..M35
  actions text NOT NULL DEFAULT '',             -- V C E D S A X I G H F ...
  scope text NOT NULL DEFAULT 'O',              -- O T D B N G R L
  note text,
  UNIQUE (role_code, module)
);

-- Manual / rule based sharing (scope R) with optional expiry (FR-SEC-007)
CREATE TABLE IF NOT EXISTS record_shares (
  id bigserial PRIMARY KEY,
  entity text NOT NULL,
  record_id bigint NOT NULL,
  user_id bigint REFERENCES users(id),
  team_id bigint REFERENCES teams(id),
  partner_id bigint,
  access text NOT NULL DEFAULT 'read',          -- read / write
  expires_at timestamptz,
  created_by bigint, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_shares_rec ON record_shares(entity, record_id);

-- Approval delegation (FR-APR-007)
CREATE TABLE IF NOT EXISTS delegations (
  id bigserial PRIMARY KEY,
  delegator_id bigint NOT NULL REFERENCES users(id),
  delegate_id bigint NOT NULL REFERENCES users(id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

-- Effective-dated reporting lines (M33, FR-ORG-005)
CREATE TABLE IF NOT EXISTS reporting_lines (
  id bigserial PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES users(id),
  manager_id bigint NOT NULL REFERENCES users(id),
  purpose text NOT NULL DEFAULT 'Primary',      -- Primary / Visibility / Approval
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  reason text,
  created_by bigint, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (employee_id <> manager_id)
);
CREATE INDEX IF NOT EXISTS ix_rl_emp ON reporting_lines(employee_id, purpose);

-- ---- Audit (ENT-44) - append-only -----------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  user_id bigint,
  user_name text,
  event text NOT NULL,            -- create / update / delete / action / login / denied / export ...
  entity text,
  record_id bigint,
  record_label text,
  changes jsonb,
  detail text,
  ip text,
  data_source text DEFAULT 'UI'
);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_log(entity, record_id);
CREATE INDEX IF NOT EXISTS ix_audit_ts ON audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS ix_audit_user ON audit_log(user_id);

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only / immutable', TG_TABLE_NAME;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_immutable ON audit_log;
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---- Notifications (ENT-43) ------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id),
  type text NOT NULL,
  title text NOT NULL,
  body text,
  entity text,
  record_id bigint,
  channel text NOT NULL DEFAULT 'in-app',
  status text NOT NULL DEFAULT 'Sent',      -- Queued, Sent, Failed, Suppressed, Read
  dedup_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_notif_dedup ON notifications(user_id, dedup_key) WHERE dedup_key IS NOT NULL;

-- ---- Configuration: picklists, settings ------------------------------------
CREATE TABLE IF NOT EXISTS picklists (
  id bigserial PRIMARY KEY,
  list text NOT NULL,
  value text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  meta jsonb,
  UNIQUE (list, value)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  area text NOT NULL DEFAULT 'General',
  description text,
  sensitive boolean NOT NULL DEFAULT false,   -- changes need approval (FR-SET-009)
  secret boolean NOT NULL DEFAULT false,      -- write-only (BRULE-SET-009)
  version integer NOT NULL DEFAULT 1,
  modified_by bigint,
  modified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_setting_versions (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  version integer NOT NULL,
  value jsonb,
  changed_by bigint,
  changed_at timestamptz NOT NULL DEFAULT now(),
  effective_from date,
  note text,
  status text NOT NULL DEFAULT 'Active'      -- Active / Pending approval / Rejected / Superseded
);
CREATE TABLE IF NOT EXISTS user_settings (
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb,
  PRIMARY KEY (user_id, key)
);

-- ---- Documents (ENT-42) ----------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id bigserial PRIMARY KEY,
  filename text NOT NULL,
  title text,
  mime text,
  size bigint,
  sha256 text,
  storage_path text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  confidentiality text NOT NULL DEFAULT 'Internal',
  version_no integer NOT NULL DEFAULT 1,
  parent_document_id bigint REFERENCES documents(id),
  entity text,
  record_id bigint,
  expiry_date date,
  portal_share boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'Active',     -- Active, Expired, Archived, Deleted
  uploaded_by bigint REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_by bigint, deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_docs_rec ON documents(entity, record_id);

-- ---- Immutable stage / forecast evidence -----------------------------------
CREATE TABLE IF NOT EXISTS opportunity_stage_history (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL,
  from_stage text,
  to_stage text NOT NULL,
  changed_by bigint,
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  days_in_stage integer,
  amount numeric(18,2),
  probability integer,
  override boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ix_osh_opp ON opportunity_stage_history(opportunity_id);

CREATE TABLE IF NOT EXISTS field_history (
  id bigserial PRIMARY KEY,
  entity text NOT NULL,
  record_id bigint NOT NULL,
  field text NOT NULL,
  old_value text,
  new_value text,
  changed_by bigint,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_fh_rec ON field_history(entity, record_id);

-- ---- Integration monitoring (ENT-45) --------------------------------------
CREATE TABLE IF NOT EXISTS integration_logs (
  id bigserial PRIMARY KEY,
  integration_code text NOT NULL,
  direction text NOT NULL DEFAULT 'Outbound',
  entity text,
  record_id bigint,
  status text NOT NULL DEFAULT 'Pending',     -- Pending, Succeeded, Failed, Dead-letter, Resubmitted, Discarded
  attempts integer NOT NULL DEFAULT 0,
  idempotency_key text UNIQUE,
  payload jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_logs (
  id bigserial PRIMARY KEY,
  user_id bigint,
  feature text NOT NULL,
  entity text,
  record_id bigint,
  output text,
  accepted boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);
