# Enterprise CRM

A role-secured, multi-country CRM for a B2B technology distributor / solutions provider, built from the
*Enterprise CRM Business Requirements Document* (35 modules, 13 workflows, 23 integrations).

| Layer    | Technology                                                    |
|----------|---------------------------------------------------------------|
| Frontend | **React 19** (Vite, React Router, Recharts) — responsive SPA   |
| Backend  | **Node.js 22** / Express REST API, JWT auth            |
| Database | **PostgreSQL 16** — `localhost:5432`, db `postgres`, user `postgres`, password `123456` |

---

## Quick start

```bash
# 1. PostgreSQL on localhost:5432 (db=postgres, user=postgres, password=123456)
./scripts/setup-postgres.sh          # local Debian/Ubuntu install, or:
docker compose up -d postgres        # Docker alternative (same credentials)

# 2. Install, create schema, load reference + demo data
npm run install:all
npm run db:setup                     # migrate + seed (idempotent)

# 3a. Production-style: one server on http://localhost:4000 (API + built UI)
npm run build && npm start

# 3b. …or development with hot reload
npm run dev:api                      # http://localhost:4000
npm run dev:web                      # http://localhost:5173  (proxies /api)
```

Open the app and sign in. **All demo users share the password `Crm@Demo2026`.**
The login page has one-click buttons for each role.

| Login | Role | Good for trying… |
|---|---|---|
| `admin` | System Administrator | permissions matrix, settings, audit, integrations, workflows |
| `sd` / `cm.kh` / `sm.kh` | Sales Director / Country Manager / Sales Manager | approvals, forecast, pipeline, team scope |
| `se1`, `se2`, `am1`, `se3` (VN) | Sales Executives / Account Manager | leads → opportunities → quotations, field-level security |
| `pse1`, `te1` | Presales / Technical | requirements, solution configs, BOM, validation |
| `sop1` | Sales Operations | data quality, merges, quotation support |
| `fin1`, `finv1`, `pay1` | Finance approver / verifier / payment officer | margin approvals, claim verification, reimbursement batches |
| `cpm1` | Channel Partner Manager | deal-registration conflicts, partner onboarding |
| `mkt1`, `evo1` | Marketing / Event organizer | campaigns, events, ROI |
| `aud1`, `roe1` | Auditor / Read-only executive | read-only access, audit trail |
| `ext1` | External partner user | sees only records explicitly shared with their partner |
| `orga1`, `wfa1` | Org admin / Workflow admin | org chart impact preview, workflow designer |

> **Sandbox note** — in the Claude cloud session this repo was built in, PostgreSQL 16 was started locally with exactly
> these credentials. That container is ephemeral; on your machine use step 1 above.

Environment variables (all optional — defaults match the credentials above): see `backend/.env.example`
(`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PORT`, `JWT_SECRET`, `DEMO_PASSWORD`, `SEED_DEMO=0` to skip demo data).

All tables live in their own `crm` schema inside the `postgres` database (override with `PGSCHEMA`), so an existing database is never touched. Useful commands: `npm run db:reset` (⚠ drops and recreates only the `crm` schema — dev only), `npm test` (resets the DB, runs 18 end-to-end suites).

---

## What is implemented

The whole BRD is modelled; every module has working screens and server-side rules. Highlights:

* **Access control (BRD §7)** — four layers enforced on the server: role × module actions (permission matrix parsed
  directly from the BRD and editable in *Admin → Roles & permissions*), record scope (own / team / department / branch /
  country / organisation / shared / reporting line, inherited by child records), **field-level security** (cost, margin,
  commission, personal data masked per role, `ROL-EXT` never sees internal data) and **state locking** (issued quotes,
  converted leads, closed deals, claims in approval are immutable). Account lockout, password policy, session revocation,
  separation-of-duty checks on role assignment.
* **Audit** — append-only `audit_log` (a database trigger rejects UPDATE/DELETE), field-level change history, export audit.
* **Leads** — duplicate detection with override reason, rule-based scoring, BANT-T qualification gate, disqualification
  rules, conversion to account + contact + opportunity, first-response SLA alerts.
* **Opportunity governance (BRD §11)** — configurable stage model S01–S13, permitted transitions, exit-criteria
  checklists, manager overrides with reason, probability override range, close-date slippage tracking, risk flags,
  On Hold / Reopen / Cancel rules, Closed Won requires an accepted quotation + PO, kanban pipeline board.
* **Quotations (BRD §9.13)** — versioned & immutable once submitted (also enforced by a DB trigger), the BRD calculation
  formulas incl. recurring terms / header discount / tax / multi-currency (the worked example AC-QUO-01 is a test),
  cost sourcing from price & cost records, margin-driven approval routing, customer PDF without cost/margin, DRAFT
  watermark, issue → accept lifecycle, validity extension, expiry job.
* **Approval engine** — rule-driven (conditions → steps referencing configurable thresholds), sequential and parallel
  steps, manager-chain / authority / role / country-scoped resolution, delegation, escalation (SLA job), withdrawal,
  conditions, versioned workflow definitions with a rule editor and simulator. Used by quotations, deal registrations,
  partners, claims, targets, event budgets and sensitive configuration changes.
* **Deal registration** — eligibility (partner active/authorised, vendor minimum), conflict detection and decision case,
  protection-period tracking, renewal limits, partner-neutral view, expiry alerts.
* **Claims & reimbursement** — multi-line claims, policy validation, org-based approval chain, finance verification with
  line adjustments, approval status kept separate from payment status, payment batches with authorisation and
  segregation of duties, result recording, event-cost reconciliation.
* **Forecasting & performance** — forecast categories, immutable snapshots, submissions & manager adjustment, accuracy,
  targets and attainment, commission estimation (plan rates, accelerators, caps, team splits).
* **Work management** — tasks (queues, recurrence, escalation, auto-generated), activities and reports with review,
  calendar with free/busy that never treats unknown availability as free, attendee response vs attendance,
  events with budgets/registrations/ROI/leads, org chart with effective-dated reporting lines and impact preview.
* **Platform** — documents (versions, restricted, access-checked downloads), notifications with preferences, CSV
  import/export with validation, 18 standard reports + CSV, role dashboards, configuration centre (approval for sensitive
  changes, version history, rollback), integration monitor (retry / dead-letter), rule-based AI assistance
  (human-in-the-loop), global search, light/dark theme, responsive layout.

Architecture in one paragraph: `backend/src/entities/*` is a declarative **entity registry** (62 entities). From it
`migrate.js` generates the PostgreSQL schema, `core/crud.js` serves validated REST CRUD with scope + field security +
audit + optimistic locking, and the UI generates lists/forms from the same metadata. Business rules live in
`backend/src/modules/*` (hooks and actions per entity plus bespoke endpoints for quotations, approvals, claims, …).

```
backend/   sql/ (core DDL) · src/entities · src/core (access, crud, audit, …) · src/modules · seed.js · test/
frontend/  src/pages · src/components (generic list/form/actions) · styles.css
docs/      REQUIREMENTS_COVERAGE.md   module-by-module status against the BRD
```

## Scope notes & known gaps

Be aware of what this build does **not** do (see `docs/REQUIREMENTS_COVERAGE.md` for the full table):

* External systems (ERP, e-mail/calendar, vendor portals, e-signature, HR, accounting, OCR, SSO/MFA …) are represented by
  the integration monitor, outbound message logs and a simulated worker; **no real connectors** are included.
* No MFA / SSO yet (JWT + password with lockout). No dedicated partner-portal UI (external users use the main UI with
  share-based visibility). No native mobile app (responsive web only, as in the BRD's initial release).
* Predictive AI features (FE-01…FE-06) are out of scope; AI assistance is rule-based.
* Workflow definitions are edited as structured JSON with a simulator, not a drag-and-drop designer.
* Policy values (margin floors, claim limits, probabilities, thresholds) are the BRD's *illustrative* defaults and are
  configurable under *Configuration*; they must be confirmed by the business (BRD open questions OQ-004/005/011).
