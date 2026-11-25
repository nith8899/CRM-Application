# Back-office redesign · 1. Product, audit and strategy

Phases 1–3 of the redesign: understand the product, audit what exists, and set the strategy and information architecture. **Nothing here is built yet.** The design system proposal is in [02-design-system.md](02-design-system.md).

Evidence comes from: the running app on `dev` (2026-11-25, uncommitted shell changes included), signed in as Sales Executive (`se1`), Sales Manager (`sm.kh`) and Administrator (`admin`); the front-end code in `frontend/src`; `docs/REQUIREMENTS_COVERAGE.md`; and the permission matrix in `backend/src/data/permission-matrix.json`.

Statements marked **Assumption** are my reasoned guesses, not confirmed requirements. Please confirm or correct them.

---

## Phase 1 · Product understanding

### What the product is
A role-secured, multi-country CRM for a B2B technology distributor / solutions provider (Cambodia and Vietnam). It covers 35 modules (M01–M35): sales (leads → opportunities → quotations), channel (partners, vendors, deal registration), presales (requirements, solutions & BOM), pricing and margin, approvals, forecasting, contracts and renewals, activities and tasks, events, claims and reimbursements, targets and commission, reporting, and administration.

### Business goals (from the requirements and modules)
1. Win more profitable deals: pipeline visibility, margin control, governed stage changes.
2. Protect margin and compliance: approvals, field-level security, audit, segregation of duties.
3. Forecast accurately: categories, submissions, immutable snapshots.
4. Work with partners and vendors: deal registration, conflicts, protection dates.
5. Control spending: claims with policy checks, verification, payment batches.

### Users and roles
16 roles. Each sees between 13 and 26 of the 26 navigable modules:

| Role | Code | Modules visible | Main jobs (from the matrix and the README) |
|---|---|---|---|
| System Administrator | ROL-ADM | 26 | Users, permissions, settings, integrations, audit |
| Sales Director | ROL-SD | 23 | Pipeline across countries, approvals, forecast |
| Country Manager | ROL-CM | 23 | Country pipeline, approvals, team performance |
| Sales Manager | ROL-SM | 22 | Team pipeline, approvals, coaching, forecast submissions |
| Sales Executive / Account Manager | ROL-SE / ROL-AM | 22 | Own leads, accounts, opportunities, quotations, activities, claims |
| Presales / Technical | ROL-PSE / ROL-TE | 21 / 15 | Requirements, solution configs, BOM, validation |
| Sales Operations | ROL-SOP | 26 | Data quality, merges, quotation support |
| Finance / Verifier / Payments | ROL-FIN (+FINV, PAY) | 23 | Margin approvals, claim verification, reimbursement batches |
| Pricing | ROL-PRC | 15 | Price lists, vendor costs |
| Marketing / Events | ROL-MKT | 13 | Campaigns, events, ROI |
| Channel Partner Manager | ROL-CPM | 21 | Partner onboarding, deal-registration conflicts |
| Auditor / Read-only executive | ROL-AUD / ROL-ROE | 26 / 22 | Read-only oversight |
| External partner | ROL-EXT | 18 | Only records shared with their partner |

**Assumption A1:** most daily users are Sales Executives and Sales Managers; Finance, Presales and Admin use the system several times a week. This decides what the default navigation and dashboard favour.

### Critical workflows
1. **Lead → opportunity → quotation → won** (SE): capture, qualify, convert, move stages, build a quote, get approval, issue it.
2. **Approve** (SM, CM, SD, FIN): review a request (margin, discount, claim, deal registration), then approve, return or reject.
3. **Forecast** (SE submits, SM adjusts, SD reviews).
4. **Claim → verify → pay** (any employee, then FIN verifier, then payments).
5. **Plan my day** (everyone): tasks, meetings, approvals, expiring quotes and renewals.
6. **Administer** (ADM): users and roles, permissions, picklists, workflows, integrations.

### Missing information
- Real usage data (which pages are used most, by whom). Without it, the navigation priorities rest on Assumption A1.
- Whether external partners (ROL-EXT) use this same portal or a separate partner portal (FE-08 is listed as a gap).
- Device mix. The requirements say responsive (M27), with no native app. **Assumption A2:** desktop first, phone for quick checks and approvals.

---

## Phase 2 · UX and UI audit

### What already works (keep it)
- A token-based design system (Navy + Gold, Inter + Noto Sans Khmer, light and dark) edited in `frontend/design-tokens.md`, with 58+ contrast tests.
- A calm shell: light sidebar with icons, active item without a stripe, white content sheet (ClickUp study).
- Role-based hiding: modules a role can't view are not shown.
- Governed stage track on opportunities with a single primary "next stage" action.
- Inline form validation with a summary ("Please correct the highlighted fields").
- Status badges with a dot and a word, never colour only.

### Findings
Each finding gives: what's wrong · why it matters · who is affected · the fix · the outcome. Priority (P1 high → P3 low) weighs user impact and business value against effort (S/M/L).

#### Information architecture and navigation
| # | What's wrong | Why it's a problem | Who | Recommendation | Outcome | P · Effort |
|---|---|---|---|---|---|---|
| IA-1 | One flat sidebar with 46 links in 7 groups. A Sales Executive sees 33 links, and Administration sits in the same list as daily work | Long lists slow down finding things (Hick's law). Daily destinations get buried among rare ones | Everyone, most for SE/SM | Two levels: **work navigation** grouped by job, and a separate **Admin & settings** area behind a gear in the top bar. Groups can collapse, with each role's defaults open | Faster navigation, less scanning, a cleaner first impression | P1 · M |
| IA-2 | "Pipeline board" and "Opportunities" are two menu items for the same records; "Tasks" duplicates part of "My work" | Users have to know two places for one thing | SE, SM | Make board and list **views** (tabs) of one Opportunities page; fold Tasks into My work | Fewer items, one mental model | P2 · S |
| IA-3 | No breadcrumbs or "back to list" on record pages. The page title doesn't show the record type | Users lose their place after jumping between linked records | Everyone | Breadcrumb above the title (Opportunities › OPP-2026-00002), with the record type as an eyebrow | Clear location, easy return | P1 · S |
| IA-4 | Approvals, notifications and tasks live in three places (Approvals page, bell, My work) | "What do I need to do?" has no single answer | SM, CM, SD, FIN | One **Inbox** in My work with triage tabs: Needs me · Waiting on others · Done (ClickUp pattern) | Nothing missed, fewer clicks | P2 · M |

#### Page structure and hierarchy
| # | What's wrong | Why | Who | Recommendation | Outcome | P · Effort |
|---|---|---|---|---|---|---|
| PS-1 | On list pages the **create button sits in the filter toolbar** under the search box, not in the page header | The main action is hard to find and moves when filters wrap | Everyone creating records | Page header pattern: title + record count on the left, one primary action on the right | Consistent, easy-to-find main action | P1 · S |
| PS-2 | Record pages show 7–9 equal-weight action buttons in a row (Mark lost, Put on hold, Probability…, Forecast…, Cancel deal…) | No hierarchy; risky actions sit next to routine ones | SE, SM | One primary (next stage) + one secondary visible; the rest in a "More" menu; destructive items last, separated | Fewer mis-clicks, clearer next step | P1 · S |
| PS-3 | Record "Details" tab is a flat 3-column dump of ~25 fields. Key facts (amount, stage, status, probability) repeat in the header strip and the details | Hard to find a fact; repetition adds noise | Everyone reading records | Summary strip with the 4–6 key facts once; details grouped into sections (Deal · Customer · Commercials · Organisation) with headings | Faster reading, less repetition | P1 · M |
| PS-4 | Record tabs overflow off-screen (10+ tabs on an opportunity; "Solution configs" is cut off) with no overflow control | Hidden tabs are undiscoverable | SE, PSE | Show the 5 most used tabs and put the rest under "More ▾" with counts; keep counts visible | All related data findable | P2 · S |
| PS-5 | 140 inline styles in pages override the system (one-off margins, widths, colours) | Visual drift between modules; changes to tokens don't reach them | Maintainers, then users | Replace with layout utilities and components; add a lint check | Consistency that lasts | P2 · M |

#### Workflows
| # | What's wrong | Why | Who | Recommendation | Outcome | P · Effort |
|---|---|---|---|---|---|---|
| WF-1 | **Approval decision screen hides the facts.** The approver sees decision buttons first, then the route. The claim amount, lines, receipts and policy flags are only behind "Review claim lines & receipts" (it leaves the page) | Approvers decide blind or bounce between pages. Risky for compliance and slow | SM, CM, SD, FIN | Decision pattern: **summary of what's being approved** (amount, margin, flags, attachments) → reason it needs approval (the rule, not just the step names) → route → decision bar fixed at the bottom | Faster, better-informed approvals; fewer returns | **P1 · M** |
| WF-2 | Approve / Approve with conditions / Return / Reject / Delegate are five equal buttons; Approve is green | Equal weight invites mistakes; green conflicts with the one-primary rule | Approvers | Primary "Approve", secondary "Return for changes", "Reject" as danger outline, the rest in "More". Reject and Return require a reason in a dialog | Clear decisions, fewer accidental rejects | P1 · S |
| WF-3 | Approval list "Progress" shows unlabeled badges ("•1 •2"); no waiting time | Can't tell how far along or how urgent a request is | Approvers | "Step 1 of 2 · Line manager", plus "Waiting 3 days" and SLA due | Prioritise by urgency | P2 · S |
| WF-4 | No bulk actions on any list (assign owner, change status, export selected, approve several) | Repetitive one-by-one work | SOP, SM, FIN | Row selection + bulk action bar on list pages, permission-aware | Hours saved for operations roles | P2 · M |
| WF-5 | Raw codes in user-facing text: "Any ROL-FINV", permission cells "CDEGHIVX/G" | Recognition over recall broken; non-admins can't read it | Approvers, admins | Show role names ("Any Finance verifier"); permission editor with labelled checkboxes and a scope dropdown | Fewer errors in permission changes | P2 · M |

#### Forms
| # | What's wrong | Why | Who | Recommendation | Outcome | P · Effort |
|---|---|---|---|---|---|---|
| FM-1 | Create forms open in a centred dialog, even long ones (New lead: 19 fields, scrolls) | Long forms in dialogs feel cramped, and context behind is hidden | Everyone creating records | Short forms (≤ 8 fields) in a dialog; longer ones in a **side drawer** (keeps the list visible) or a full page for complex records (quotations) | Comfortable data entry | P2 · M |
| FM-2 | Fields are mostly ungrouped (only "Qualification (BANT-T)" has a heading) | Users can't see the shape of the form | Same | Group fields into sections with short headings and helper text where a field is unclear (e.g. Source, BANT) | Fewer errors, faster entry | P2 · S |
| FM-3 | Errors aren't linked to fields for assistive tech (0 `aria-invalid`, 0 `aria-describedby`), and focus stays on the page after a failed submit | Screen-reader users don't know what failed; keyboard users must hunt | Users with assistive tech, keyboard users | Set `aria-invalid` + `aria-describedby` on each field, and move focus to the error summary with links to each field | WCAG 2.2 AA (3.3.1, 3.3.3) | **P1 · S** |

#### Tables and lists
| # | What's wrong | Why | Who | Recommendation | Outcome | P · Effort |
|---|---|---|---|---|---|---|
| TB-1 | Tables overflow the sheet at 1440px (Leads: the Status column is cut off) | Important columns become invisible | Everyone | Column priorities: pin the identifier, hide low-value columns first, horizontal scroll only inside the table with a shadow cue | Key data always visible | P1 · S |
| TB-2 | Filters are only status chips + search. No owner, date, amount or country filters, no saved views, no sort indicator until clicked | Finding a subset is slow; recall over recognition | SM, SOP, FIN | Filter bar: status chips + "Filter" button opening field filters + active-filter chips + saved views ("My open", "Closing this month") | Faster answers from lists | P2 · M |
| TB-3 | "Owner" column shows the same person on every row for Sales Executives (their scope is Own) | Wasted space | SE, AM | Hide columns that can only have one value for the user's scope | More room for useful data | P3 · S |
| TB-4 | Row actions only on click-through; no quick actions | Extra navigation | Everyone | Hover/focus row actions (open, edit, more) at the row end, always reachable by keyboard | Fewer page loads | P3 · S |

#### Dashboard
| # | What's wrong | Why | Who | Recommendation | Outcome | P · Effort |
|---|---|---|---|---|---|---|
| DB-1 | The dashboard leads with 6 metric tiles and 2 charts; actionable items (overdue tasks, approvals, expiring quotes, stalled deals) are further down | The things to *do* come after the things to *look at* | Everyone, most for SE/SM | Order: **Needs your action** (approvals, overdue, expiring, stalled) → 4 decision KPIs vs target → trends → lists. Role-aware content | Next action first (PM System principle) | **P1 · M** |
| DB-2 | KPIs have no comparison (vs target, vs last period) and no as-of time | A number alone doesn't say good or bad | SM, SD, CM | Each KPI: value, delta vs target/last period, record count, as-of time | Decisions at a glance | P2 · S |
| DB-3 | "Pipeline by stage" uses stage codes (S01…S10) on the axis | Codes need recall | Managers | Stage names, horizontal bars, values labelled | Readable chart | P3 · S |

#### States
| # | What's wrong | Why | Who | Recommendation | Outcome | P · Effort |
|---|---|---|---|---|---|---|
| ST-1 | Loading is a "Loading…" text line (30 places); no skeletons; the page jumps when data arrives | Feels slow, layout shifts | Everyone | Skeleton rows / cards shaped like the content; keep the page header static | Perceived speed, no jumps | P2 · S |
| ST-2 | 22 hand-made empty states vs 3 using the shared `<Empty>` component; most say only "Nothing to show" | Inconsistent, and no next step | Everyone | One empty-state pattern: icon + what this is + the action to fill it (if permitted) | Helps first-time users | P2 · S |
| ST-3 | Permission states aren't designed: hidden actions are fine, but direct links to forbidden records show a raw error box | Confusing dead ends | EXT, ROE, AUD | "You don't have access to this record" page with who to ask and a way back | Fewer support requests | P3 · S |
| ST-4 | Record delete and governed actions (cancel deal, disqualify…) already confirm or ask for a reason, but three deletes run immediately: removing a record share, deleting a claim line, removing an approval delegation. The confirm dialogs also differ in wording and layout | Accidental, irreversible changes; inconsistent safety | Everyone | One confirm pattern for every destructive or irreversible action: what happens, what's affected, whether it can be undone, a reason if required | Error prevention, consistency | P1 · S |

#### Accessibility and responsive
| # | What's wrong | Why | Who | Recommendation | Outcome | P · Effort |
|---|---|---|---|---|---|---|
| AC-1 | Charts animate even with reduced motion on | Motion sensitivity | Users with vestibular disorders | Turn off chart animation under `prefers-reduced-motion` | WCAG 2.3.3 | P3 · S |
| AC-2 | 118 `title` attribute tooltips (not keyboard- or touch-reachable) | Info hidden from keyboard and touch users | Keyboard, touch, screen-reader users | Tooltip component on focus and hover; for essential info use visible text | WCAG 1.4.13 | P2 · S |
| AC-3 | On phones, tables keep desktop columns and scroll sideways; record actions wrap into several rows | Hard to use on a phone; approvals on the go are a likely use (A2) | Managers on the move | Phone layouts: list rows become stacked cards (title, status, amount, date); sticky decision bar on approvals | Usable approvals on a phone | P2 · M |

### Top 10 to do first (impact ÷ effort)
1. WF-1 Approval decision screen shows the facts · P1 · M
2. DB-1 Dashboard leads with "Needs your action" · P1 · M
3. FM-3 Accessible form errors and focus · P1 · S
4. PS-2 Action hierarchy on record pages (primary + More) · P1 · S
5. ST-4 Confirm destructive actions · P1 · S
6. PS-1 Page-header pattern with the main action · P1 · S
7. TB-1 Tables never hide key columns · P1 · S
8. IA-3 Breadcrumbs · P1 · S
9. IA-1 Two-level navigation (work vs admin) · P1 · M
10. PS-3 Record summary strip + grouped details · P1 · M

---

## Phase 3 · Strategy and information architecture

### Design objectives (measurable where possible)
1. **Next action first.** Every role finds what needs them within one screen of signing in.
2. **Decide with the facts in view.** No approval needs a second page to decide.
3. **One pattern per job.** One list template, one record template, one form approach, one decision template, used by all 35 modules.
4. **Fewer, clearer choices.** At most one primary action per screen; rare actions in "More".
5. **Accessible by default.** WCAG 2.2 AA, checked in tests where possible.

### Proposed navigation

**Top bar** (always): workspace logo · global search (⌘K) · **Create ▾** (new lead, opportunity, task, claim; only what the role can create) · Inbox bell · Help · Admin & settings (gear, only for roles with admin modules) · account menu.

**Work sidebar** (grouped by job; groups the role can't see are hidden; each role's main groups start open):

| Group | Items | Notes |
|---|---|---|
| Home | Dashboard · My work (tasks + inbox) · Calendar | Approvals become a tab in My work and stay one click away with a count |
| Sales | Leads · Accounts · Contacts · Opportunities (List / Board views) · Quotations · Forecast | "Pipeline board" becomes a view (IA-2) |
| Channel | Partners · Deal registrations · Vendors | |
| Presales & catalog | Requirements · Solutions & BOM · Products · Price lists · Vendor costs | |
| Delivery & renewals | Projects · Contracts & renewals | |
| Marketing | Campaigns · Events | |
| Activity | Activities · Meetings · Activity reports | Tasks move to My work |
| Finance | Claims · Reimbursements · Targets · Commission | |
| Insights | Reports · Activity analytics · Org chart | |

**Admin & settings** (own sidebar, reached from the gear):

| Group | Items |
|---|---|
| Overview | Admin overview |
| People & access | Users · Roles & permissions · Organisation |
| Data | Picklists · Pipeline stages · FX & tax · Import history · Data quality |
| Automation | Workflows · Integrations |
| Security | Audit log |
| System | Configuration |

Nothing is removed: every one of today's 46 destinations keeps a place. The work sidebar drops from 33 links to about 27 for a Sales Executive (8 groups), and admin items no longer mix with daily work.

**Assumption A3:** Org chart stays in Insights (people use it to find colleagues), not only in admin.

### Key journeys and the patterns they use
| Journey | Pattern(s) |
|---|---|
| Find and update a deal | List page → record page (summary strip + sections) → stage move with criteria check |
| Create a lead | Create drawer (sectioned form) → toast with "Open lead" |
| Approve a discount or claim | Inbox → decision page (facts → reason → route → decision bar) → confirm with reason for reject/return |
| Submit a forecast | Forecast page → editable table → review → submit (confirm) |
| Verify and pay claims | Claims list with filters → bulk select → batch → confirm |
| Change a permission | Admin › Roles → role detail → labelled permission editor → change needs a reason → audit entry |

### Approach to the remaining phases
- **Phase 4:** extend the design system: [02-design-system.md](02-design-system.md).
- **Phase 5 (pilot):** build the new Dashboard plus the shared page header, list and record templates, then check them with you before rolling out.
- **Phase 6:** roll the templates out module by module, in this order: Approvals → Opportunities → Leads/Accounts/Contacts → Quotations → Claims → the rest → Admin.
- **Phase 7:** accessibility and responsive review of every template, plus a screenshot check of every module in light and dark.

No business logic changes. Only presentation, layout and front-end interaction change. Where a change needs new API data (e.g. KPI vs target, approval waiting time), I'll flag it before building.
