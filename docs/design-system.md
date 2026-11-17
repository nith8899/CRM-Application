# Back-office design system

The visual system for the CRM back-office (`frontend/`). It is a website for staff who work in it all day, so it favours calm, dense, familiar layouts over decoration.

- **Live gallery:** sign in, open the account menu → **Design system** (`/design-system`). It renders every token and component from the real code, in light and dark.
- **Tokens:** [`frontend/src/styles/tokens.css`](../frontend/src/styles/tokens.css)
- **Components:** [`frontend/src/styles.css`](../frontend/src/styles.css) (no raw hex values allowed; a test enforces it)
- **Icons:** [`frontend/src/components/icons.jsx`](../frontend/src/components/icons.jsx)
- **Contrast tests:** `npm test` in `frontend/` (58 checks, light and dark)

## Where each decision comes from

| Decision | Choice | From |
|---|---|---|
| Brand colours | Navy `#0E3762` for structure and action; Gold `#CAA12D` only for the single decisive step | PM System |
| Neutrals | Navy-tinted canvas `#F4F6F9`, white surfaces | PM System |
| Font | Inter (variable) + Noto Sans Khmer, bundled with the app | Delivery App, Royalty App |
| Type roles | Page 20 · card 16 · body 14 · meta 13 · caption 12 · KPI 28 · nothing below 11 | PM System |
| Khmer | +6px line height, no letter spacing | Delivery App, Royalty App |
| Token layers | Brand primitives → semantic (light/dark) → component tokens | Sinvonix, Logistic Systems |
| Spacing | 4px grid | PM System, Delivery App |
| Radius | 2 cells/tags · 4 buttons/inputs · 8 cards · 12 dialogs | PM System |
| Buttons | Heights 24 / 32 / 40; one primary per screen | PM System, Logistic Systems |
| Shell | Navy header with the krama-check pattern; light Planner-style side panel | PM System |
| Icons | Phosphor, semantic names; regular / fill (selected) / duotone (empty states) | Delivery App, Royalty App |
| Dark mode | Separate theme: lighter surfaces for elevation, brand steps lighter, gold focus ring | Logistic Systems, Delivery App, PM System |
| Motion | Fluent easing; 150–200ms opacity fades; off under reduced motion | PM System |
| Accessibility | WCAG 2.2 AA; status never by colour alone; contrast measured in tests | PM System, Delivery App |

## 1. Tokens

Three layers. Each layer only points at the one before it.

1. **Brand primitives**, named by hue: `--navy-10…100`, `--gold-10…100`, `--slate-*`, `--ink-*` (dark neutrals).
2. **Semantic roles**, light and dark: `--bg-*`, `--text-*`, `--border-*`, `--action-*`, `--status-*`, `--shell-*`, `--viz-*`.
3. **Component tokens**: `--btn-primary-bg`, `--input-border`, `--card-bg`, `--table-head-bg`…

Rules:
- Components read layers 2 and 3 only. Never write a hex value in `styles.css` or in a page.
- Missing a value? Add a step to the scale in `tokens.css`. Don't add a one-off.
- Dark mode lives entirely in layer 2, so components never branch on theme. The `prefers-color-scheme` block must match the `[data-theme='dark']` block (a test checks this).
- Charts read colours through `components/chart.js` (`VIZ`, `AXIS`, `GRID`, `TIP`), which point at `--viz-*` tokens.

## 2. Colour

| Role | Light | Dark | Use |
|---|---|---|---|
| `--action-primary` | navy-70 `#0E3762` | `#3E6A98` | Primary buttons, current stage |
| `--action-accent` | gold-70 `#CAA12D` | gold-70 | The single decisive step (Mark won, Approve), counts, focus in dark |
| `--text-primary` | `#15202D` (16.4:1) | `#E8ECF1` | Body text |
| `--text-secondary` | `#4F5D6D` (6.7:1) | `#A7B3C2` | Meta, labels |
| `--text-accent` | gold-90 `#79611B` | gold-50 | Gold as text. Never use gold-70 as text: it's 2.4:1 |
| `--border-strong` | `#8491A0` (3.2:1) | `#5B6F86` | Input and control borders |

Status pairs (`good`, `warn`, `bad`, `info`, `neutral`) each have an `-fg` and a `-bg`. Warning is orange (`#8A4B00`), kept separate from brand gold. **A status is always shown with a word and a dot or icon**, never by colour alone.

## 3. Typography

| Role | Size / line | Weight |
|---|---|---|
| Display (login) | 24 / 32 | 600 |
| Page title (`h1`) | 20 / 28 | 600 |
| KPI value | 28 / 36 | 600, tabular figures |
| Card title (`h2`, `h3`) | 16 / 22 | 600 |
| Body | 14 / 20 | 400 |
| Meta | 13 / 18 | 400–500 |
| Caption | 12 / 16 | 400 |

Amounts and record numbers use tabular figures (`.mono`, `td.num`). Mark Khmer content with `lang="km"` to get the taller line height.

## 4. Spacing, radius, elevation

- Spacing `--sp-1…10` = 2, 4, 6, 8, 12, 16, 20, 24, 32, 40px.
- Page padding 24 (16 on phones). Card padding 16. Gap between cards 16. Page title to content 20.
- Radius: `sm` 2 · `md` 4 · `lg` 8 · `xl` 12 · `pill`.
- Shadows: `--shadow-card` (resting cards), `--shadow-4` (hover), `--shadow-16` (menus, popovers), `--shadow-64` (dialogs).

## 5. Layout

- **Header** (48px, navy, krama check): menu button (phones), logo + environment tag (`UAT`), global search, notifications, account.
- **Side panel** (240px, light navy-tinted): grouped links with icons. The current page uses a white item, a filled icon and semibold text.
- **Content**: max 1500px wide, 24px padding.
- Breakpoints: below 980px the side panel becomes a drawer with a scrim, and 4-column grids drop to 2. Below 640px, grids, forms and key-value lists drop to 1 column.

## 6. Components (class names)

| Component | Classes | Rules |
|---|---|---|
| Button | `.btn` + `primary` / `accent` / `danger` / `ghost`, sizes `sm` (24) / default (32) / `lg` (40) | One `primary` per screen. `accent` only for the decisive step. Hide actions a role can't perform; don't disable them |
| Icon button | `.iconbtn` | Always has an `aria-label` |
| Input, select, textarea | `label.f` wraps label text + field; `.help`, `.err`, `.req` | 32px high, label above |
| Card | `.card`, `.card-h`, `.card-b` or `<Card>` | |
| KPI | `.card.kpi` inside `.grid.kpis` | Label with icon, value, hint. Link the whole card |
| Table | `.table-wrap > table.t`, `td.num`, `tr.click`, `.toolbar`, `.pager` | 36px header, 44px rows, `aria-sort` on sortable headers |
| Badge | `<Badge v="Won" />` → `.badge.good/warn/bad/info` | Dot + word. `.plain` drops the dot for categories (type, stage) |
| Chip filter | `.chip`, `.chip.on` | |
| Tabs | `<Tabs>` → `.tabs .tab.on` + `.n` count | |
| Alert | `<Alert kind="bad|warn|info|good">` | Icon is added automatically |
| Toast | `useToast()(message, 'success'|'error')` | Icon is added automatically |
| Dialog | `<Modal>` / `<Confirm>` | Destructive confirm says what happens and whether it can be undone |
| Empty state | `<Empty icon="inbox">…</Empty>` | Duotone icon + one sentence on what to do next |
| Stage track | `.stages .stage.done/.cur` | Current stage is navy with a gold underline |

## 7. Icons

Phosphor, through `<Icon name="…" />` only (never import from `@phosphor-icons/react` in a page). The names say what, not how: `quotations`, `approvals`, `ai`.

- **Regular**: everyday chrome. **Fill**: the selected state (current nav item). **Duotone**: empty states.
- Sizes 16 (in buttons and badges), 20 (default), 24 (empty states, gallery).
- Icons beside text are decorative (`aria-hidden`). Icon-only buttons need an `aria-label`.
- Don't use emoji or text symbols (✓ ✕ ▲ ✨) as icons.

To add an icon: import it in `icons.jsx`, add a semantic name to `MAP`, and it appears in the gallery automatically.

## 8. Accessibility checklist

- Text ≥ 4.5:1, controls and focus rings ≥ 3:1. Measured in `frontend/tests/tokens.test.mjs`.
- A visible focus ring on every interactive element (navy in light mode, gold in dark mode).
- A skip link to the main content.
- Status is never colour only.
- Reduced motion turns off fades and the spinner animation.

## 9. Changing the system

1. Change the token in `tokens.css` (light **and** both dark blocks).
2. Run `npm test` in `frontend/`.
3. Open `/design-system` and check light and dark.
4. If you add a component, give it a section in `pages/DesignSystem.jsx` and a row in section 6 above.
