# CRM design tokens

**This file is the style of the back-office.** Change a value here and the whole app follows: the dev server rebuilds `src/styles/tokens.css` every time you save this file, and `npm run build` / `npm test` rebuild it too. Don't edit `tokens.css` by hand; it is overwritten.

How to edit:
- Change only the **Value** column. Keep the backticks.
- A value can be a colour (`#0E3762`, `rgba(16, 24, 40, .04)`), a size (`6px`), or a pointer to another token: `var(--navy-70)`.
- Three layers, pointing one way only: **Foundations** (raw brand colours, type, spacing) → **Light theme** / **Dark theme** (what each colour is *for*) → **Components**. To re-brand, change Foundations; to change how one role looks, change the theme row.
- **Dark theme** lists only what differs from Light. Every dark token must also exist in Light.
- Add a token by adding a row; remove one only if nothing in `src/` uses it.
- After a colour change, run `npm test` in `frontend/`: it measures text contrast (WCAG AA) in light and dark and tells you which pair fails.

Guide to what each token is for: [docs/design-system.md](../docs/design-system.md). See every token rendered: sign in → account menu → **Design system**.

## Foundations

Raw values. Named by what they are (hue, step, size), not by what they are for.

### Navy · brand primary

| Token | Value | Note |
|---|---|---|
| `--navy-10` | `#F3F5F7` |  |
| `--navy-20` | `#E2E7EC` |  |
| `--navy-30` | `#C3CDD8` |  |
| `--navy-40` | `#93A5B8` |  |
| `--navy-50` | `#567391` |  |
| `--navy-60` | `#2B4F75` |  |
| `--navy-70` | `#0E3762` |  |
| `--navy-80` | `#0B2C4E` |  |
| `--navy-90` | `#08213B` |  |
| `--navy-100` | `#061627` |  |

### Gold · brand accent (fills only, never text on light)

| Token | Value | Note |
|---|---|---|
| `--gold-10` | `#FCFAF4` |  |
| `--gold-20` | `#F9F4E6` |  |
| `--gold-30` | `#F2E8CA` |  |
| `--gold-40` | `#E7D5A0` |  |
| `--gold-50` | `#DABD6C` |  |
| `--gold-60` | `#D0AC46` |  |
| `--gold-70` | `#CAA12D` |  |
| `--gold-80` | `#A28124` |  |
| `--gold-90` | `#79611B` |  |
| `--gold-100` | `#514012` |  |

### Greys · clean neutrals (ClickUp study)

| Token | Value | Note |
|---|---|---|
| `--grey-0` | `#FFFFFF` |  |
| `--grey-25` | `#FBFBFC` |  |
| `--grey-50` | `#F7F8FA` |  |
| `--grey-100` | `#F1F2F4` |  |
| `--grey-150` | `#E8EAED` |  |
| `--grey-200` | `#DFE2E6` |  |

### Slate · navy-tinted neutrals

| Token | Value | Note |
|---|---|---|
| `--slate-0` | `#FFFFFF` |  |
| `--slate-25` | `#F8FAFC` |  |
| `--slate-50` | `#F4F6F9` |  |
| `--slate-75` | `#EEF2F6` |  |
| `--slate-100` | `#E6EBF0` |  |
| `--slate-150` | `#D6DDE5` |  |
| `--slate-400` | `#8491A0` |  |
| `--slate-500` | `#6B7785` |  |
| `--slate-600` | `#4F5D6D` |  |
| `--slate-900` | `#15202D` |  |

### Ink · dark-mode neutrals

| Token | Value | Note |
|---|---|---|
| `--ink-950` | `#0A1420` |  |
| `--ink-900` | `#111E2D` |  |
| `--ink-850` | `#152437` |  |
| `--ink-800` | `#1A2B40` |  |
| `--ink-750` | `#1E3149` |  |
| `--ink-700` | `#243A55` |  |
| `--ink-600` | `#2A3F58` |  |
| `--ink-500` | `#5B6F86` |  |
| `--ink-300` | `#A7B3C2` |  |
| `--ink-100` | `#E8ECF1` |  |

### Status hues

| Token | Value | Note |
|---|---|---|
| `--green-700` | `#0E6B0E` |  |
| `--green-100` | `#DFF6DD` |  |
| `--amber-700` | `#8A4B00` |  |
| `--amber-100` | `#FFF1E0` |  |
| `--red-700` | `#A4262C` |  |
| `--red-100` | `#FDE7E9` |  |
| `--red-600` | `#C4314B` |  |

### Type

| Token | Value | Note |
|---|---|---|
| `--font-sans` | `"Inter Variable", Inter, "Noto Sans Khmer", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |  |
| `--font-mono` | `ui-monospace, "SF Mono", Consolas, Menlo, monospace` |  |
| `--fs-caption` | `12px` |  |
| `--lh-caption` | `16px` | nothing below 11px anywhere |
| `--fs-meta` | `13px` |  |
| `--lh-meta` | `18px` |  |
| `--fs-body` | `14px` |  |
| `--lh-body` | `20px` |  |
| `--fs-card` | `16px` |  |
| `--lh-card` | `22px` |  |
| `--fs-page` | `20px` |  |
| `--lh-page` | `28px` |  |
| `--fs-kpi` | `28px` |  |
| `--lh-kpi` | `36px` |  |
| `--fs-display` | `24px` |  |
| `--lh-display` | `32px` |  |
| `--fw-regular` | `400` |  |
| `--fw-medium` | `500` |  |
| `--fw-semibold` | `600` |  |
| `--fw-bold` | `700` |  |

### Spacing · 4px grid

| Token | Value | Note |
|---|---|---|
| `--sp-1` | `2px` |  |
| `--sp-2` | `4px` |  |
| `--sp-3` | `6px` |  |
| `--sp-4` | `8px` |  |
| `--sp-5` | `12px` |  |
| `--sp-6` | `16px` |  |
| `--sp-7` | `20px` |  |
| `--sp-8` | `24px` |  |
| `--sp-9` | `32px` |  |
| `--sp-10` | `40px` |  |

### Radius

| Token | Value | Note |
|---|---|---|
| `--radius-sm` | `2px` | cells, bars, tags |
| `--radius-md` | `6px` | buttons, inputs, nav items |
| `--radius-lg` | `10px` | cards, panels, the content sheet |
| `--radius-xl` | `12px` | dialogs |
| `--radius-pill` | `9999px` |  |

### Elevation

| Token | Value | Note |
|---|---|---|
| `--shadow-card` | `0 1px 2px rgba(16, 24, 40, .04)` |  |
| `--shadow-4` | `0 2px 8px rgba(16, 24, 40, .07), 0 0 1px rgba(16, 24, 40, .10)` |  |
| `--shadow-16` | `0 8px 20px rgba(21, 32, 45, .12), 0 0 1px rgba(21, 32, 45, .12)` |  |
| `--shadow-64` | `0 24px 56px rgba(21, 32, 45, .22), 0 0 1px rgba(21, 32, 45, .14)` |  |

### Sizes & layout

| Token | Value | Note |
|---|---|---|
| `--control-sm` | `24px` |  |
| `--control-md` | `32px` |  |
| `--control-lg` | `40px` |  |
| `--row-default` | `36px` |  |
| `--row-compact` | `32px` |  |
| `--header-h` | `48px` |  |
| `--nav-w` | `248px` |  |
| `--nav-item-h` | `30px` |  |
| `--sheet-gap` | `8px` |  |
| `--content-max` | `1500px` |  |
| `--page-gutter` | `24px` | page padding on desktop (16 on phones) |
| `--drawer-w` | `560px` | side drawer for create/edit forms |
| `--drawer-w-wide` | `760px` |  |
| `--decision-bar-h` | `64px` | sticky approval decision bar |
| `--summary-min` | `150px` | min width of a summary-strip fact |
| `--bp-sm` | `640px` | breakpoints: documented here, mirrored in src/breakpoints.js (media queries can't read variables) |
| `--bp-md` | `980px` |  |
| `--bp-lg` | `1280px` |  |
| `--z-sticky` | `10` |  |
| `--z-nav` | `20` |  |
| `--z-header` | `30` |  |
| `--z-popover` | `40` |  |
| `--z-drawer` | `45` |  |
| `--z-dialog` | `50` |  |
| `--z-toast` | `60` |  |
| `--z-tooltip` | `70` |  |

### Motion

| Token | Value | Note |
|---|---|---|
| `--dur-fast` | `100ms` |  |
| `--dur-normal` | `200ms` |  |
| `--dur-slow` | `300ms` |  |
| `--ease-standard` | `cubic-bezier(.33, 0, .67, 1)` |  |
| `--ease-decelerate` | `cubic-bezier(.1, .9, .2, 1)` |  |
| `--focus-ring-width` | `2px` | visible focus on every control (WCAG 2.4.7) |
| `--focus-ring-offset` | `2px` |  |

### Icons

| Token | Value | Note |
|---|---|---|
| `--ic-sm` | `16px` |  |
| `--ic-md` | `20px` |  |
| `--ic-lg` | `24px` |  |

### Krama check · brand pattern for navy panels

| Token | Value | Note |
|---|---|---|
| `--krama-cell` | `22px` |  |
| `--krama-band` | `rgba(255, 255, 255, .045)` |  |
| `--krama-pin` | `rgba(202, 161, 45, .28)` |  |

## Light theme

Roles: what each colour is for. Components read these.

### Surfaces

| Token | Value | Note |
|---|---|---|
| `--bg-canvas` | `var(--grey-50)` | behind the shell: top bar + sidebar |
| `--bg-app` | `var(--grey-0)` | inside the content sheet |
| `--bg-surface` | `var(--grey-0)` |  |
| `--bg-surface-alt` | `var(--grey-25)` |  |
| `--bg-subtle` | `var(--grey-100)` |  |
| `--bg-hover` | `rgba(16, 24, 40, .04)` | transparent layer: works on any surface |
| `--bg-pressed` | `rgba(16, 24, 40, .08)` |  |
| `--skeleton-bg` | `rgba(16, 24, 40, .06)` | loading placeholders |
| `--skeleton-shine` | `rgba(255, 255, 255, .6)` |  |
| `--bg-selected` | `var(--navy-10)` |  |
| `--bg-accent-soft` | `var(--gold-20)` |  |

### Text

| Token | Value | Note |
|---|---|---|
| `--text-primary` | `var(--slate-900)` |  |
| `--text-secondary` | `var(--slate-600)` |  |
| `--text-disabled` | `var(--slate-500)` |  |
| `--text-brand` | `var(--navy-70)` |  |
| `--text-accent` | `var(--gold-90)` |  |
| `--text-on-brand` | `#FFFFFF` |  |
| `--text-on-accent` | `var(--navy-90)` |  |
| `--text-link` | `var(--navy-60)` |  |

### Borders

| Token | Value | Note |
|---|---|---|
| `--border-subtle` | `var(--grey-100)` |  |
| `--border-default` | `var(--grey-150)` |  |
| `--border-strong` | `var(--slate-400)` | 3.2:1 control boundary |
| `--border-brand` | `var(--navy-70)` |  |

### Actions & focus

| Token | Value | Note |
|---|---|---|
| `--action-primary` | `var(--navy-70)` |  |
| `--action-primary-hover` | `var(--navy-80)` |  |
| `--action-primary-pressed` | `var(--navy-90)` |  |
| `--action-accent` | `var(--gold-70)` |  |
| `--action-accent-hover` | `var(--gold-60)` |  |
| `--action-accent-pressed` | `var(--gold-80)` |  |
| `--focus-ring` | `var(--navy-70)` |  |

### Status (always with an icon or word)

| Token | Value | Note |
|---|---|---|
| `--status-good-fg` | `var(--green-700)` |  |
| `--status-good-bg` | `var(--green-100)` |  |
| `--status-warn-fg` | `var(--amber-700)` |  |
| `--status-warn-bg` | `var(--amber-100)` | orange, distinct from brand gold |
| `--status-bad-fg` | `var(--red-700)` |  |
| `--status-bad-bg` | `var(--red-100)` |  |
| `--status-bad-solid` | `var(--red-600)` |  |
| `--status-info-fg` | `var(--navy-70)` |  |
| `--status-info-bg` | `var(--navy-10)` |  |
| `--status-neutral-fg` | `var(--slate-600)` |  |
| `--status-neutral-bg` | `var(--slate-75)` |  |

### Shell · top bar & sidebar

| Token | Value | Note |
|---|---|---|
| `--shell-header-bg` | `var(--bg-canvas)` |  |
| `--shell-header-fg` | `var(--slate-900)` |  |
| `--shell-header-muted` | `var(--slate-600)` |  |
| `--shell-header-field` | `var(--grey-0)` |  |
| `--shell-header-field-border` | `var(--grey-150)` |  |
| `--shell-header-field-hover` | `var(--grey-25)` |  |
| `--shell-nav-bg` | `var(--bg-canvas)` |  |
| `--shell-nav-fg` | `#2B3645` |  |
| `--shell-nav-group` | `var(--slate-600)` |  |
| `--shell-nav-hover` | `rgba(16, 24, 40, .05)` |  |
| `--shell-nav-active-bg` | `rgba(14, 55, 98, .08)` |  |
| `--shell-nav-active-fg` | `var(--slate-900)` |  |
| `--shell-nav-active-icon` | `var(--navy-70)` |  |
| `--shell-nav-indicator` | `var(--navy-70)` |  |

### Brand surface · navy panels

| Token | Value | Note |
|---|---|---|
| `--brand-surface` | `var(--navy-70)` | navy panels: login hero, brand strip |
| `--brand-surface-fg` | `#FFFFFF` |  |
| `--brand-surface-muted` | `rgba(255, 255, 255, .72)` |  |

### Charts

| Token | Value | Note |
|---|---|---|
| `--viz-1` | `#2F6DB5` |  |
| `--viz-2` | `#B8860B` |  |
| `--viz-3` | `#1E9A8A` |  |
| `--viz-4` | `#8B5CB8` |  |
| `--viz-5` | `#C4314B` |  |
| `--viz-6` | `#567391` |  |
| `--viz-7` | `#D46B08` |  |
| `--viz-8` | `#0B5E56` |  |
| `--viz-brand` | `var(--navy-70)` |  |
| `--viz-good` | `#107C10` |  |
| `--viz-grid` | `var(--slate-150)` |  |
| `--viz-axis` | `var(--slate-600)` |  |

### Overlays & toasts

| Token | Value | Note |
|---|---|---|
| `--overlay-scrim` | `rgba(6, 22, 39, .45)` |  |
| `--toast-bg` | `var(--slate-900)` |  |
| `--toast-fg` | `#FFFFFF` |  |

## Dark theme

Only the roles that change in dark mode. A separate theme, not an inversion: lighter surfaces sit higher; brand steps go lighter.

### Surfaces

| Token | Value | Note |
|---|---|---|
| `--bg-canvas` | `#070E18` |  |
| `--bg-app` | `var(--ink-950)` |  |
| `--bg-surface` | `var(--ink-900)` |  |
| `--bg-surface-alt` | `var(--ink-850)` |  |
| `--bg-subtle` | `var(--ink-800)` |  |
| `--bg-hover` | `rgba(255, 255, 255, .05)` |  |
| `--bg-pressed` | `rgba(255, 255, 255, .09)` |  |
| `--skeleton-bg` | `rgba(255, 255, 255, .06)` |  |
| `--skeleton-shine` | `rgba(255, 255, 255, .08)` |  |
| `--bg-selected` | `#16283D` |  |
| `--bg-accent-soft` | `#2E2A18` |  |

### Text

| Token | Value | Note |
|---|---|---|
| `--text-primary` | `var(--ink-100)` |  |
| `--text-secondary` | `var(--ink-300)` |  |
| `--text-disabled` | `#8D9AAA` |  |
| `--text-brand` | `#A9BFD6` |  |
| `--text-accent` | `var(--gold-50)` |  |
| `--text-on-brand` | `#FFFFFF` |  |
| `--text-on-accent` | `var(--navy-90)` |  |
| `--text-link` | `#A9BFD6` |  |

### Borders

| Token | Value | Note |
|---|---|---|
| `--border-subtle` | `#1E3048` |  |
| `--border-default` | `var(--ink-600)` |  |
| `--border-strong` | `var(--ink-500)` |  |
| `--border-brand` | `#A9BFD6` |  |

### Actions & focus

| Token | Value | Note |
|---|---|---|
| `--action-primary` | `#3E6A98` |  |
| `--action-primary-hover` | `#4A78A8` |  |
| `--action-primary-pressed` | `#33597F` |  |
| `--focus-ring` | `var(--gold-60)` |  |

### Status (always with an icon or word)

| Token | Value | Note |
|---|---|---|
| `--status-good-fg` | `#7BD17B` |  |
| `--status-good-bg` | `#0F2E14` |  |
| `--status-warn-fg` | `#FFB86B` |  |
| `--status-warn-bg` | `#3A2408` |  |
| `--status-bad-fg` | `#FF99A4` |  |
| `--status-bad-bg` | `#3D1419` |  |
| `--status-bad-solid` | `#E5566E` |  |
| `--status-info-fg` | `#A9BFD6` |  |
| `--status-info-bg` | `#16283D` |  |
| `--status-neutral-fg` | `#B3B9C2` |  |
| `--status-neutral-bg` | `#262E3A` |  |

### Shell · top bar & sidebar

| Token | Value | Note |
|---|---|---|
| `--shell-header-bg` | `var(--bg-canvas)` |  |
| `--shell-header-fg` | `var(--ink-100)` |  |
| `--shell-header-muted` | `var(--ink-300)` |  |
| `--shell-header-field` | `var(--ink-900)` |  |
| `--shell-header-field-border` | `var(--ink-600)` |  |
| `--shell-header-field-hover` | `var(--ink-850)` |  |
| `--shell-nav-bg` | `var(--bg-canvas)` |  |
| `--shell-nav-fg` | `#C8D2DD` |  |
| `--shell-nav-group` | `#8D9AAA` |  |
| `--shell-nav-hover` | `rgba(255, 255, 255, .05)` |  |
| `--shell-nav-active-bg` | `rgba(255, 255, 255, .08)` |  |
| `--shell-nav-active-fg` | `#FFFFFF` |  |
| `--shell-nav-active-icon` | `var(--gold-60)` |  |
| `--shell-nav-indicator` | `var(--gold-60)` |  |

### Brand surface · navy panels

| Token | Value | Note |
|---|---|---|
| `--brand-surface` | `#0B1B2E` |  |

### Charts

| Token | Value | Note |
|---|---|---|
| `--viz-1` | `#5B8FD0` |  |
| `--viz-2` | `#B8891F` |  |
| `--viz-3` | `#2FA894` |  |
| `--viz-4` | `#A07BD0` |  |
| `--viz-5` | `#E5566E` |  |
| `--viz-6` | `#8AA3BD` |  |
| `--viz-7` | `#E38A3A` |  |
| `--viz-8` | `#3FB5A6` |  |
| `--viz-brand` | `#5B8FD0` |  |
| `--viz-good` | `#4CAF50` |  |
| `--viz-grid` | `var(--ink-600)` |  |
| `--viz-axis` | `var(--ink-300)` |  |

### Overlays & toasts

| Token | Value | Note |
|---|---|---|
| `--overlay-scrim` | `rgba(0, 0, 0, .6)` |  |
| `--toast-bg` | `var(--ink-100)` |  |
| `--toast-fg` | `var(--ink-950)` |  |

### Elevation

| Token | Value | Note |
|---|---|---|
| `--shadow-card` | `0 1px 2px rgba(0, 0, 0, .3)` |  |
| `--shadow-4` | `0 2px 6px rgba(0, 0, 0, .35)` |  |
| `--shadow-16` | `0 8px 20px rgba(0, 0, 0, .45)` |  |
| `--shadow-64` | `0 24px 56px rgba(0, 0, 0, .6)` |  |

## Components

Per-component tokens. Each points at a theme role, so components follow both themes.

### Buttons

| Token | Value | Note |
|---|---|---|
| `--btn-primary-bg` | `var(--action-primary)` |  |
| `--btn-primary-bg-hover` | `var(--action-primary-hover)` |  |
| `--btn-primary-bg-pressed` | `var(--action-primary-pressed)` |  |
| `--btn-primary-fg` | `var(--text-on-brand)` |  |
| `--btn-accent-bg` | `var(--action-accent)` |  |
| `--btn-accent-bg-hover` | `var(--action-accent-hover)` |  |
| `--btn-accent-fg` | `var(--text-on-accent)` |  |
| `--btn-secondary-bg` | `var(--bg-surface)` |  |
| `--btn-secondary-border` | `var(--border-strong)` |  |

### Inputs

| Token | Value | Note |
|---|---|---|
| `--input-bg` | `var(--bg-surface)` |  |
| `--input-border` | `var(--border-strong)` |  |
| `--input-border-focus` | `var(--focus-ring)` |  |

### Cards

| Token | Value | Note |
|---|---|---|
| `--card-bg` | `var(--bg-surface)` |  |
| `--card-border` | `var(--border-default)` |  |

### Tables

| Token | Value | Note |
|---|---|---|
| `--table-head-bg` | `var(--bg-surface)` |  |
| `--table-row-hover` | `var(--bg-hover)` |  |

### Badges

| Token | Value | Note |
|---|---|---|
| `--badge-radius` | `var(--radius-pill)` |  |

### Stage track

| Token | Value | Note |
|---|---|---|
| `--stage-current-bg` | `var(--action-primary)` |  |
| `--stage-current-fg` | `var(--text-on-brand)` |  |

### Legacy aliases · read by old inline styles; prefer the roles above

| Token | Value | Note |
|---|---|---|
| `--surface` | `var(--bg-surface)` |  |
| `--surface-2` | `var(--bg-surface-alt)` |  |
| `--border` | `var(--border-default)` |  |
| `--primary` | `var(--action-primary)` |  |
| `--primary-soft` | `var(--bg-selected)` |  |
| `--good` | `var(--status-good-fg)` |  |
| `--warn` | `var(--status-warn-fg)` |  |
