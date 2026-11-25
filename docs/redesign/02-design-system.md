# Back-office redesign · 2. Proposed design system

Phase 4. This **extends** the system already in the app: tokens in `frontend/design-tokens.md` (compiled to `src/styles/tokens.css`), styles in `src/styles.css`, and the guide in [docs/design-system.md](../design-system.md). Problems referenced as `WF-1`, `PS-2`… are from [01-audit-and-strategy.md](01-audit-and-strategy.md).

Where each decision comes from:
- PM System: Navy + Gold, the one-primary rule, gold only for the decisive step, confirm with reason.
- ClickUp study: the light shell, hover layers, ring + shadow, triage inbox.
- Delivery App / Royalty App: Inter + Noto Sans Khmer, Phosphor icons.
- Logistic Systems: the three token layers, contrast measured in tests.

> **Status (2026-11-25): built on `dev`, not yet committed.** See "Build status" at the end for what's done and what's left.

---

## 1. Foundations

### Keep (already in `design-tokens.md`)
| Foundation | Current value | Note |
|---|---|---|
| Brand | Navy `#0E3762` primary · Gold `#CAA12D` accent (fills only) | Unchanged |
| Neutrals | Clean greys for the shell + navy-tinted slate | From the ClickUp study |
| Type | Inter + Noto Sans Khmer; page 20 · card 16 · body 14 · meta 13 · caption 12 · KPI 28 · display 24 | Nothing below 11 |
| Spacing | 4px grid, `--sp-1…10` (2 → 40) | |
| Radius | sm 2 · md 6 · lg 10 · xl 12 · pill | |
| Controls | 24 / 32 / 40 heights; rows 36 (compact 32) | |
| Shell | top bar 48, sidebar 248 | |
| Motion | Fluent standard / decelerate; fast 100 · normal 200 · slow 300; off under reduced motion | |
| Icons | Phosphor via `<Icon name>`; 16 / 20 / 24 | |
| Themes | Light, dark (+ system) | |

### Add
| Token group | Proposed tokens | Why |
|---|---|---|
| Breakpoints | `--bp-sm 640` · `--bp-md 980` · `--bp-lg 1280` · `--bp-xl 1536` (documented; CSS media queries can't read variables, so the values also sit in one `breakpoints.js`) | Same breakpoints everywhere; today 640/980/1280 are typed by hand |
| Layout | `--content-max 1500` (exists) · `--drawer-w 560` · `--drawer-w-wide 760` · `--decision-bar-h 64` · `--page-gutter` (24 desktop / 16 phone) | Drawer and decision patterns (FM-1, WF-1) |
| Z-index | `--z-sticky 10 · nav 20 · header 30 · dropdown 40 · drawer 45 · dialog 50 · toast 60 · tooltip 70` | One stacking order |
| Interaction layers | `--layer-hover` (black 4% light / white 6% dark) · `--layer-pressed` (8% / 10%) · `--layer-selected` | Hover works on any surface (ClickUp) |
| Elevation | `--elev-ring` (hairline) + `--elev-1…4` → `--elev-card`, `--elev-popover`, `--elev-drawer`, `--elev-dialog` | Cards outlined without hard borders |
| Focus | `--focus-ring-width 2px` · `--focus-ring-offset 2px` | Consistent visible focus (WCAG 2.4.7, 2.4.11) |
| Density | `--row-default 36` / `--row-comfortable 44`, user-selectable later | Data-heavy screens |
| Skeleton | `--skeleton-bg` · `--skeleton-shine` | ST-1 |

### Colour roles (semantic, unchanged in meaning)
- **Primary action** = navy. **Decisive step** = gold accent (Approve, Mark won, Submit forecast). Only one per screen.
- **Secondary** = white with a strong border. **Tertiary** = ghost.
- **Status**: good / warn (orange, never gold) / bad / info / neutral. Always with a word plus a dot or icon.
- **Danger** for destructive actions only: outline by default, filled only inside the confirm dialog.

### Grid and layout rules
- Desktop: sidebar + content sheet; content uses a 12-column grid with a 16px gap. Dashboards use 8 + 4 (main + side rail).
- Page = **header** (breadcrumb, title, meta, actions) → optional **summary strip** → **body** (tabs or sections).
- Phone (< 640): sidebar becomes a drawer; tables become stacked rows; actions collapse into one primary + "More".

---

## 2. Component library

Status: **Have** = exists and stays; **Rework** = exists but changes; **New** = to build. Every component reads tokens only and has a section in the `/design-system` gallery.

### Navigation
| Component | Status | Variants · sizes | Notes |
|---|---|---|---|
| Top bar | Rework | — | Add Create ▾ and the Admin gear; search shows recent items before typing |
| Sidebar + nav group | Rework | expanded / collapsed (icon-only 56px) | Collapsible groups, remembers per user; separate Admin sidebar (IA-1) |
| Breadcrumbs | **New** | — | Truncates the middle on small screens; last item is the current page (IA-3) |
| Tabs | Rework | line (page) / segmented (views like List · Board) | Overflow into "More ▾" with counts (PS-4) |
| Pagination | Rework | full / compact | Page size, "1–25 of 312", keyboard reachable |

### Actions
| Component | Status | Variants · sizes | Notes |
|---|---|---|---|
| Button | Have | primary · accent · secondary · tertiary (ghost) · danger · sm 24 / md 32 / lg 40 | Add a `loading` state (spinner + label kept, width locked) |
| Icon button | Have | ghost / outline · 24 / 32 | `aria-label` required, tooltip on hover and focus |
| Dropdown menu | **New** | — | Items with icon, shortcut, description; destructive items last and separated; keyboard arrows |
| Split button | **New** | primary / secondary | e.g. "Save" + ▾ "Save and new" |
| Action bar (record) | **New** | — | One primary + one secondary + "More" (PS-2) |
| Bulk action bar | **New** | — | Appears when rows are selected: count, actions, clear (WF-4) |

### Form elements
| Component | Status | Notes |
|---|---|---|
| Text field, textarea | Rework | Label above, optional hint, error below linked with `aria-describedby`, `aria-invalid` (FM-3); prefix/suffix (currency, %) |
| Search field | Rework | Icon, clear button, `/` shortcut on list pages |
| Select | Have (native) | Keep native for accessibility |
| Lookup / combobox | Rework (`Lookup`) | Async search, recent items, "Create new…" when allowed |
| Multi-select | **New** | Chips inside the field, keyboard remove |
| Date / date-time | Have (native) | Keep native; add range picker for filters |
| Checkbox, radio | Rework | Group with legend; 16px box, 24px hit area |
| Switch | **New** | Only for settings that apply immediately |
| File upload | **New** | Drop zone + list with progress, type and size limits stated up front |
| Validation message + error summary | **New** | Summary at the top links to each field; focus moves to it (FM-3) |

### Data display
| Component | Status | Notes |
|---|---|---|
| Data table | Rework (`EntityTable`) | Pinned first column, column priorities (TB-1), row selection, sort indicator always visible, hover row actions (TB-4), density, phone stacked rows (AC-3) |
| Filter bar | **New** | Status chips + "Filter" popover + active-filter chips + saved views (TB-2) |
| Status badge | Have | Dot + word; `plain` for categories |
| Metric card (KPI) | Rework | Value, delta vs target or last period with an arrow and word ("+12% vs target"), record count, as-of time (DB-2) |
| Chart | Rework | Labels in words, units, direct labels when ≤ 5 series, no animation under reduced motion (AC-1, DB-3) |
| Summary strip | **New** | 4–6 key facts of a record, shown once (PS-3) |
| Description list (KV) | Rework | Grouped sections with headings |
| Avatar | **New** | Initials or photo; 24 / 32; with name for accessibility |
| Tooltip | **New** | Hover and focus, 300ms delay, never holds essential info (AC-2) |
| Empty state | Rework (`Empty`) | Icon + title + one sentence + action if permitted (ST-2) |
| Info panel | **New** | Side panel for context: "Why approval is needed", policy flags |
| Timeline | Have | Activity history, approval route |

### Feedback and overlays
| Component | Status | Notes |
|---|---|---|
| Dialog (modal) | Have | For short forms (≤ 8 fields) and confirmations |
| Drawer | **New** | Right side, 560 / 760; for create/edit of longer forms and quick record preview (FM-1) |
| Confirm dialog | Rework (`Confirm`) | What happens · affected items · can it be undone · reason field when required; danger button filled only here (ST-4) |
| Toast | Have | Success / info / error; action link ("Open lead"); errors stay until dismissed |
| Alert / banner | Have | Page-level messages; account-level notice bar |
| Loading | Rework | Spinner only for actions; **skeletons** for page and section loads (ST-1) |
| Skeleton | **New** | Table rows, cards, KV sections |
| Error state | Rework (`ErrorBox`) | Plain-language message, what to do, retry; technical details collapsed |
| Permission state | **New** | "You don't have access" + who to ask + back link (ST-3) |

---

## 3. Component states

Every interactive component defines these states. Hover and pressed use the interaction layers, so they look the same on any surface.

| State | When | Visual rule |
|---|---|---|
| Default | Resting | Token colours |
| Hover | Pointer over (desktop only) | `--layer-hover` over the surface; border to `--text-secondary` on inputs |
| Focus | Keyboard focus | 2px ring `--focus-ring`, 2px offset; never removed |
| Active / pressed | While pressed | `--layer-pressed` |
| Selected | Chosen item (row, tab, chip, nav) | `--bg-selected` + a shape cue (check, underline, filled icon), not colour alone |
| Disabled | Allowed for the role but not possible right now | `--text-disabled`, no hover; explain why in a tooltip or hint. **Not allowed for the role → hide it** |
| Loading | Waiting on the server | Button: spinner + label, width locked, not clickable. Section: skeleton |
| Error | Invalid or failed | `--status-bad-fg` border + message + icon; `aria-invalid` |
| Success | Completed | Toast or inline check with a word; never only a colour flash |

The gallery page shows each component in every state, in light and dark.

---

## 4. Reusable patterns

| Pattern | Structure | Rules |
|---|---|---|
| **List page** | Header (breadcrumb, title + count, primary "New …") → view tabs (List · Board) → filter bar → table → pagination | One primary action in the header. Filters never move it (PS-1) |
| **Search, filter, sort** | Search for text; status chips for the top filter; "Filter" popover for the rest; active filters shown as removable chips; sort from the column header with an indicator | Saved views per user; URL holds the filter state so links can be shared |
| **Create / edit** | ≤ 8 fields → dialog; 9–30 → drawer with sections; complex documents (quotation) → full page with a sticky summary | Required marked with *, helper text where needed, error summary + inline errors, primary "Create …" at bottom right |
| **Record (detail) page** | Breadcrumb → title + status + key meta → action bar (primary, secondary, More) → summary strip → tabs (Overview, related records, Documents, History) with overflow | Facts shown once. Destructive actions last in More |
| **Multi-step workflow** | Stepper (stage track) + criteria checklist before moving on | Blocked steps say what's missing |
| **Bulk actions** | Checkbox column → bulk bar with count and permitted actions → confirm if destructive | Only actions allowed for every selected record |
| **Permissions** | Hide what the role can't do; disable only temporary blocks, with the reason | Field-level security: show "Restricted" instead of an empty value |
| **Confirm and delete** | Dialog: title as a question, what happens, affected count, undo or not, reason if required, danger button | Soft delete says how to restore |
| **Review and approval** | Facts card (what, amount, margin, flags, attachments) → "Why approval is needed" (the rule) → route timeline → sticky decision bar: Approve (accent), Return, Reject, More | Reject and Return need a reason. Approver can't approve their own request (already enforced) |
| **Inbox / triage** | Tabs: Needs me · Waiting on others · Done; grouped by date; row = what, who, amount, waiting time | Counts on tabs; actions on hover |
| **Empty, loading, error** | Skeleton → content; empty with next action; error with retry | Never a blank page |

---

## 5. Accessibility standard
- WCAG 2.2 AA. Text ≥ 4.5:1, controls and focus ≥ 3:1. Measured by `npm test` (keep extending the pair list with each new token).
- Keyboard: every action reachable, visible focus, skip link, dialogs and drawers trap focus and return it on close, `Esc` closes.
- Forms: visible labels, `aria-invalid`, `aria-describedby`, error summary that takes focus.
- Targets ≥ 24px (WCAG 2.5.8), 44px on touch layouts.
- Status never by colour alone. Charts get a data table alternative ("View as table").
- Reduced motion turns off page fades, skeleton shine and chart animation.
- Khmer content: `lang="km"`, +6px line height.

---

## 6. Pilot (Phase 5): what I'll build first, after your approval
1. Tokens: the additions in section 1.
2. Components: page header with breadcrumbs, action bar with "More" menu, dropdown menu, skeleton, tooltip, KPI card with delta, confirm dialog with reason, accessible form errors.
3. **Dashboard redesign**: Needs your action → 4 KPIs vs target → trends → lists, role-aware.
4. **Approval decision page** (WF-1, WF-2): the biggest workflow win.
5. Gallery sections and tests for each new component; screenshots in light, dark and phone width.

Then I stop for your review before rolling out to every module (Phase 6).

### Data I may need from the back-end
These would need API changes, so I'll confirm before building:
- KPI targets and last-period values for deltas (targets exist in M17; the dashboard API may not return them).
- Approval waiting time and SLA due (route steps already carry an SLA time).
- The rule that triggered an approval ("margin below 12%"), not just the step names.

---

## Build status (2026-11-25)

**Built and tested in the app:**
- Tokens: page gutter, drawer widths, decision bar, summary width, breakpoints (`src/breakpoints.js`), drawer and tooltip z-levels, focus-ring size, skeleton colours (light + dark).
- Navigation (IA-1, IA-2): work sidebar in 9 job groups with collapsible, role-aware defaults; a separate Admin & settings area (gear); a Create menu; Opportunities List · Board views. `tests/nav.test.mjs` proves no old destination was lost.
- Components: PageHead with breadcrumbs (IA-3), ActionBar + Menu (PS-2), SummaryStrip (PS-3), Tabs overflow (PS-4), Segmented, Drawer (FM-1), Confirm with consequences/undo/reason (ST-4), ErrorSummary + accessible fields (FM-3), Skeleton (ST-1), Empty with next step (ST-2), PermissionState + 404 (ST-3), TooltipLayer (AC-2).
- Lists (TB-1, TB-2, WF-4, AC-3): status column kept in view, max 8 columns, Filter panel + active-filter chips, row selection with bulk export and change owner, phone stacked rows.
- Dashboard pilot (DB-1, DB-3): Needs your action, 4 KPIs with counts and as-of time, stage names, labelled bars, side rail; charts respect reduced motion (AC-1).
- Approvals (WF-1, WF-2, WF-3, WF-5): readable progress and waiting time; decision page with facts (claim lines, receipts, policy flags), why, route with role names, fixed decision bar; Reject and Return need a reason.
- Permissions matrix in words; confirmations on revoking a share, deleting a claim line, ending a delegation, and withdrawing a request.

**Not done yet:**
- DB-2 KPI deltas vs target / last period: needs the dashboard API to return targets (back-end change; not made).
- IA-4 one inbox with triage tabs in My work (approvals stay a separate page for now).
- TB-3 hiding single-value columns, TB-4 hover row actions, saved views.
- PS-5 the remaining inline styles in older pages (Finance, Quotation editor, Admin panels).
- New form controls: multi-select, switch, file drop zone, split button, avatar.
- The Quotation editor, Claim page, Forecast and Reports keep their own layouts (restyled by tokens, not restructured).

