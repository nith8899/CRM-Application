-- Immutability guards (ENT-27, ENT-40: submitted versions & forecast snapshots are never changed in place)
CREATE TABLE IF NOT EXISTS forecast_snapshot_rows (
  id bigserial PRIMARY KEY,
  snapshot_id bigint NOT NULL REFERENCES forecast_snapshots(id),
  opportunity_id bigint NOT NULL,
  opp_number text, opp_name text, account_name text, owner_id bigint, owner_name text, country text,
  stage text, probability numeric(7,2), amount_base numeric(18,2), weighted numeric(18,2),
  forecast_category text, close_date date
);
CREATE INDEX IF NOT EXISTS ix_fsr_snap ON forecast_snapshot_rows(snapshot_id);

DROP TRIGGER IF EXISTS trg_fsr_immutable ON forecast_snapshot_rows;
CREATE TRIGGER trg_fsr_immutable BEFORE UPDATE OR DELETE ON forecast_snapshot_rows
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
DROP TRIGGER IF EXISTS trg_fs_immutable ON forecast_snapshots;
CREATE TRIGGER trg_fs_immutable BEFORE UPDATE OR DELETE ON forecast_snapshots
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Non-draft quotation lines/versions cannot change commercial content.
CREATE OR REPLACE FUNCTION guard_quote_line() RETURNS trigger AS $$
DECLARE st text; vid bigint;
BEGIN
  vid := COALESCE(NEW.version_id, OLD.version_id);
  SELECT status INTO st FROM quotation_versions WHERE id = vid;
  IF st IS NOT NULL AND st <> 'Draft' THEN
    RAISE EXCEPTION 'Issued versions cannot be modified. Create a revision. (BRULE-QUO-005)';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_guard_quote_line ON quotation_lines;
CREATE TRIGGER trg_guard_quote_line BEFORE INSERT OR UPDATE OR DELETE ON quotation_lines
  FOR EACH ROW EXECUTE FUNCTION guard_quote_line();

-- Frequently used indexes
CREATE INDEX IF NOT EXISTS ix_opp_stage ON opportunities(stage) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS ix_opp_owner ON opportunities(owner_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS ix_opp_close ON opportunities(close_date) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS ix_task_owner_due ON tasks(owner_id, due_at) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS ix_apr_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS ix_aps_req ON approval_steps(request_id, seq);
