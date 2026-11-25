// Measures WCAG contrast for every text/background pair the design system promises, in light and dark.
// Run: npm test (from frontend/). No dependencies: node:test + a tiny CSS custom-property resolver.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selectorRe) {
  const out = {};
  for (const m of css.matchAll(selectorRe)) {
    let i = m.index + m[0].length, depth = 1, body = '';
    while (depth) { const c = css[i++]; if (c === '{') depth++; else if (c === '}') depth--; if (depth) body += c; }
    for (const d of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  }
  return out;
}
const light = block(/(^|\n)\s*:root\s*\{/g);
const darkOverrides = block(/:root\[data-theme='dark'\]\s*\{/g);
const dark = { ...light, ...darkOverrides };

function resolve(vars, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`cycle at ${name}`);
  seen.add(name);
  const v = vars[name];
  assert.ok(v, `token ${name} is not defined`);
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  return ref ? resolve(vars, ref[1], seen) : v;
}
function parse(c) {
  const m = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) return { rgb: [m[1], m[2], m[3]].map((x) => Number(x) / 255), a: m[4] == null ? 1 : Number(m[4]) };
  const h = c.replace('#', '');
  assert.match(h, /^[0-9a-fA-F]{6}$/, `expected a 6-digit hex or rgb(a), got ${c}`);
  return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255), a: 1 };
}
// A translucent colour is measured as it actually appears: blended over the surface underneath.
function over(top, base) { const t = parse(top), b = parse(base); assert.equal(b.a, 1, `base ${base} must be opaque`); return t.rgb.map((v, i) => v * t.a + b.rgb[i] * (1 - t.a)); }
const rgb = (c, base) => (parse(c).a < 1 ? (assert.ok(base, `${c} is translucent; give a base surface`), over(c, base)) : parse(c).rgb);
const lum = (c, base) => { const [r, g, b] = rgb(c, base).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b, base) => { const bg = parse(b).a < 1 ? `rgb(${over(b, base).map((v) => Math.round(v * 255)).join(',')})` : b; const [x, y] = [lum(a, bg), lum(bg)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [foreground, background, minimum, base?] — 4.5 for text, 3 for UI boundaries and large text.
// base: the opaque surface under a translucent background (hover layers, the active nav tint).
const PAIRS = [
  ['--text-primary', '--bg-surface', 4.5], ['--text-primary', '--bg-app', 4.5], ['--text-secondary', '--bg-surface', 4.5],
  ['--text-secondary', '--bg-app', 4.5], ['--text-secondary', '--bg-subtle', 4.5], ['--text-disabled', '--bg-surface', 4.5],
  ['--text-brand', '--bg-surface', 4.5], ['--text-link', '--bg-surface', 4.5], ['--text-accent', '--bg-surface', 4.5],
  ['--text-on-brand', '--action-primary', 4.5], ['--text-on-brand', '--action-primary-hover', 4.5], ['--text-on-accent', '--action-accent', 4.5],
  ['--status-good-fg', '--status-good-bg', 4.5], ['--status-warn-fg', '--status-warn-bg', 4.5], ['--status-bad-fg', '--status-bad-bg', 4.5],
  ['--status-info-fg', '--status-info-bg', 4.5], ['--status-neutral-fg', '--status-neutral-bg', 4.5],
  ['--shell-nav-fg', '--shell-nav-bg', 4.5], ['--shell-nav-group', '--shell-nav-bg', 4.5], ['--shell-nav-active-fg', '--shell-nav-active-bg', 4.5, '--shell-nav-bg'],
  ['--text-primary', '--bg-hover', 4.5, '--bg-surface'], ['--text-primary', '--bg-pressed', 4.5, '--bg-surface'], ['--shell-header-muted', '--shell-header-bg', 4.5],
  ['--brand-surface-fg', '--brand-surface', 4.5], ['--text-accent', '--bg-accent-soft', 4.5], ['--border-strong', '--bg-canvas', 3],
  ['--shell-header-fg', '--shell-header-bg', 4.5], ['--toast-fg', '--toast-bg', 4.5],
  ['--border-strong', '--bg-surface', 3], ['--focus-ring', '--bg-surface', 3], ['--shell-nav-active-icon', '--shell-nav-active-bg', 3, '--shell-nav-bg'],
  ['--viz-1', '--bg-surface', 3], ['--viz-brand', '--bg-surface', 3], ['--viz-good', '--bg-surface', 3],
];

for (const [themeName, vars] of [['light', light], ['dark', dark]]) {
  for (const [fg, bg, min, base] of PAIRS) {
    test(`${themeName}: ${fg} on ${bg} ≥ ${min}:1`, () => {
      const r = ratio(resolve(vars, fg), resolve(vars, bg), base && resolve(vars, base));
      assert.ok(r >= min, `${fg} on ${bg} is ${r.toFixed(2)}:1 in ${themeName}, needs ${min}:1`);
    });
  }
}

test('prefers-color-scheme dark block matches the [data-theme=dark] block', () => {
  const media = block(/:root:not\(\[data-theme='light'\]\)\s*\{/g);
  assert.deepEqual(media, darkOverrides);
});

test('components never use raw hex colours', () => {
  const comp = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual(comp.match(/#[0-9a-fA-F]{3,8}\b/g) || [], []);
});
