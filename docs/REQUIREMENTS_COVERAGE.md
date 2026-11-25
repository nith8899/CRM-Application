# Requirements coverage

Module-by-module status against the BRD (`CRM_BRD_RTM` lists ~310 functional requirements across M01–M35).
**Full** = the module's core functional requirements work end-to-end in this build; **Partial** = core flow works,
listed items are deferred; this is an honest self-assessment, not an acceptance result (all RTM rows are still
*Not tested* in the formal sense — the automated suite in `backend/test` covers the highest-risk business rules).

| Module | Status | Implemented | Deferred / simplified |
|---|---|---|---|
| M01 Dashboard & Home | Partial | Role-aware KPI cards, pipeline/won charts, task/approval/meeting/renewal/quote widgets | Per-user widget layout configuration |
| M02 Leads | Full | Capture, duplicate check, rule-based score, assignment to account owner, BANT-T qualify, disqualify, convert, SLA alerts, CSV import | Marketing-automation sync |
| M03 Accounts | Full | Hierarchy (cycle-safe), classification, account plans, 360 view, merge with audit, duplicate detection, owner transfer | ERP credit data is read-only fields (no feed) |
| M04 Contacts | Full | Roles, consent, duplicate warning, anonymisation action | — |
| M05 Partners | Partial | Onboarding approval, tiers, certifications (expiry), performance, deal-reg authorisation | Partner portal UX (FE-08), partner targets UI |
| M06 Vendors | Full | Profiles, registration policy (min value, protection days, renewals, exclusivity), versioned policy number | Vendor agreement document workflow |
| M07 Catalog | Partial | Categories, products, recurring attributes, EOS/EOL, price lists with validity, cost records | Bundles/alternates as first-class objects, vendor catalog feeds (INT-08) |
| M08 Opportunities | Full | Stage model, transition & criteria governance, team, stakeholders, partners/vendors, competitors, risk flags, hold/reopen/cancel, slippage, probability override, pipeline board | Duplicate-resolution task for SOP |
| M09 Deal Registration | Full | Eligibility, conflict case & decision, internal approval, vendor decision, protection dates, renewal limits, partner-neutral view, expiry alerts | Vendor portal submission (INT-07 is a simulated outbound message) |
| M10 Activity & Task | Full | Activity log with org snapshot, tasks with recurrence/queues/priorities | — |
| M11 Meetings | Partial | Meetings, attendees, minutes, decisions, follow-up tasks | E-mail logging and calendar provider sync (INT-01/02) |
| M12 Sizing & BOM | Partial | Requirements, configurations (versioned, validated, locked), BOM, BOM→quotation lines | Vendor sizing-tool import, templates designer |
| M13 Quotation | Full | Versioning, formulas, optional/alternative lines, header discount, tax, PDF (watermark), approval, issue, accept, extend, expiry, primary quotation sync | E-signature (INT-09), e-mail delivery (logged only) |
| M14 Pricing & Margin | Full | Price lists, cost records (source, validity), margin thresholds, field-level cost/margin security | Special-bid approval workflow UI |
| M15 Approval Engine | Full | Sequential/parallel, delegated, escalated, conditional, return/reject/withdraw, versioned definitions, simulator | Visual designer |
| M16 Projects | Partial | Register, milestones, linkage to opportunities | PM-tool status feed (INT-13) |
| M17 Targets & Commission | Partial | Targets (approval), attainment, plans (rate/accelerator/cap), estimates, approval, payroll export message | Clawbacks and adjustments UI |
| M18 Forecasting | Full | Categories, submissions, manager adjustment, immutable snapshots (weekly job), accuracy | AI forecasting (FE-01) |
| M19 Support & Renewal | Full | Contracts, renewals, auto renewal opportunities in the lead window, expiry status | ITSM entitlement feed |
| M20 Documents | Full | Upload, versions, categories, expiry, restricted docs, access-checked download, audit | External DMS (INT-03), virus scanning |
| M21 Notifications | Partial | In-app notifications, de-duplication, per-type preferences | E-mail digests, messaging platform (INT-16) |
| M22 Reporting | Partial | 18 standard reports with scope + field security, CSV export (audited), dashboards | Custom report builder, schedules, BI feed (INT-17) |
| M23 Import / Export | Partial | CSV import with validation, duplicate rejection, history; CSV export for every entity | Migration reconciliation reports, mapping templates |
| M24 Administration | Full | Users, roles↔users (SoD), permission matrix editor, picklists, FX, tax, stages, org units/BU/branches/teams, data-quality view | — |
| M25 Integration Mgmt | Partial | Connector registry (23 interfaces), secrets write-only, message log, retry/resubmit/discard, dead-letter, simulated worker | **Real connectors** |
| M26 Audit & Security | Partial | Immutable audit, lockout, password policy, session revocation, scoped access, field security, access to restricted fields audited | MFA/SSO (INT-10), retention/anonymisation jobs |
| M27 Mobile & Responsive | Full (responsive) | Responsive layouts (dashboard checked at 390 px: sidebar collapses, no page-level horizontal overflow) | Native app / offline (FE-07) |
| M28 AI-Assisted CRM | Partial | Rule-based opportunity summary, next actions, e-mail draft (human send only, logged) | Predictive scoring/forecast, meeting summaries |
| M29 Activity Reporting | Partial | Period reports, submit/review/return/reopen, effort-vs-outcome analytics, activity targets | Full 17-report catalogue |
| M30 Task Management | Full | Lifecycle, queues + claim, escalation job (levels), recurrence, auto-generated tasks, my-work view | Task templates designer |
| M31 Calendar & Attendees | Partial | Month calendar, free/busy with *unknown ≠ free*, holidays/non-working days, response vs attendance, sharing preferences | Provider sync, online-meeting links (INT-22) |
| M32 Settings | Full | Personal settings, configuration centre, sensitive changes via approval, version history, rollback | Scheduled effective dates |
| M33 Org & Workflow | Partial | Effective-dated reporting lines, org chart, impact preview, dynamic approver resolution, versioned workflow rules | Visual org/workflow designer, acting assignments |
| M34 Events | Full | Lifecycle, budget approval, registration + waitlist, attendance, leads from attendees, ROI, sensitive-data clearing | Webinar platform sync (INT-23) |
| M35 Claims & Reimbursement | Full | Categories & policy checks, multi-currency lines, receipts, approval chain, finance verification/adjustment, batches, authorisation, payment results, SoD | OCR (INT-21), card feed (INT-20), accounting push (simulated INT-19) |

## Tests

`npm test` (from the repo root) resets the database and runs 18 end-to-end suites against the real API and PostgreSQL:
authentication & lockout · record scope · field-level security · external-user isolation · lead duplicate/qualification/conversion ·
opportunity governance · quotation calculation (BRD worked example) · quotation lifecycle & immutability (also at DB level) ·
approval engine · deal-registration rules · claims end-to-end with segregation of duties · audit immutability ·
forecast snapshot immutability · administration, SoD and sensitive-setting approval · documents · user lifecycle.
