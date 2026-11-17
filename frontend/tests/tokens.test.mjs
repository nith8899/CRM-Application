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
function rgb(hex) {
  const h = hex.replace('#', '');
  assert.match(h, /^[0-9a-fA-F]{6}$/, `expected a 6-digit hex, got ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
const lum = (c) => { const [r, g, b] = rgb(c).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [foreground, background, minimum] — 4.5 for text, 3 for UI boundaries and large text.
const PAIRS = [
  ['--text-primary', '--bg-surface', 4.5], ['--text-primary', '--bg-app', 4.5], ['--text-secondary', '--bg-surface', 4.5],
  ['--text-secondary', '--bg-app', 4.5], ['--text-secondary', '--bg-subtle', 4.5], ['--text-disabled', '--bg-surface', 4.5],
  ['--text-brand', '--bg-surface', 4.5], ['--text-link', '--bg-surface', 4.5], ['--text-accent', '--bg-surface', 4.5],
  ['--text-on-brand', '--action-primary', 4.5], ['--text-on-brand', '--action-primary-hover', 4.5], ['--text-on-accent', '--action-accent', 4.5],
  ['--status-good-fg', '--status-good-bg', 4.5], ['--status-warn-fg', '--status-warn-bg', 4.5], ['--status-bad-fg', '--status-bad-bg', 4.5],
  ['--status-info-fg', '--status-info-bg', 4.5], ['--status-neutral-fg', '--status-neutral-bg', 4.5],
  ['--shell-nav-fg', '--shell-nav-bg', 4.5], ['--shell-nav-group', '--shell-nav-bg', 4.5], ['--shell-nav-active-fg', '--shell-nav-active-bg', 4.5],
  ['--shell-header-fg', '--shell-header-bg', 4.5], ['--toast-fg', '--toast-bg', 4.5],
  ['--border-strong', '--bg-surface', 3], ['--focus-ring', '--bg-surface', 3], ['--shell-nav-active-icon', '--shell-nav-active-bg', 3],
  ['--viz-1', '--bg-surface', 3], ['--viz-brand', '--bg-surface', 3], ['--viz-good', '--bg-surface', 3],
];

for (const [themeName, vars] of [['light', light], ['dark', dark]]) {
  for (const [fg, bg, min] of PAIRS) {
    test(`${themeName}: ${fg} on ${bg} ≥ ${min}:1`, () => {
      const r = ratio(resolve(vars, fg), resolve(vars, bg));
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
