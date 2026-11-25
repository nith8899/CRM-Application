// Live design-system gallery for the back-office. Everything here renders from the real tokens and classes,
// so it doubles as a visual regression page: if a token changes, this page shows it.
import { useEffect, useState } from 'react';
import { ActionBar, Alert, Badge, Breadcrumbs, Card, Confirm, Drawer, Empty, ErrorSummary, KV, Menu, Modal, PageHead, PermissionState, Segmented, Skeleton, SummaryStrip, Tabs } from '../components/ui';
import { Icon, iconNames } from '../components/icons';

const RAMPS = [['navy', 'Brand · Navy (structure and action)'], ['gold', 'Brand · Gold (single decisive step; fills only)']];
const STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const SEMANTIC = [
  ['Surfaces', ['--bg-app', '--bg-surface', '--bg-surface-alt', '--bg-subtle', '--bg-hover', '--bg-selected', '--bg-accent-soft']],
  ['Text', ['--text-primary', '--text-secondary', '--text-disabled', '--text-brand', '--text-accent', '--text-link']],
  ['Borders', ['--border-subtle', '--border-default', '--border-strong', '--border-brand']],
  ['Actions', ['--action-primary', '--action-primary-hover', '--action-accent', '--focus-ring']],
  ['Status (with icon + label)', ['--status-good-fg', '--status-good-bg', '--status-warn-fg', '--status-warn-bg', '--status-bad-fg', '--status-bad-bg', '--status-info-fg', '--status-info-bg']],
  ['Data viz (fixed order)', ['--viz-1', '--viz-2', '--viz-3', '--viz-4', '--viz-5', '--viz-6', '--viz-7', '--viz-8']],
];
const TYPE = [['Display · 24/32 semibold', 'var(--fs-display)', 'var(--lh-display)', 600, 'Sign in'], ['Page title · 20/28 semibold', 'var(--fs-page)', 'var(--lh-page)', 600, 'Opportunities'],
  ['KPI · 28/36 semibold, tabular', 'var(--fs-kpi)', 'var(--lh-kpi)', 600, '2.8M'], ['Card title · 16/22 semibold', 'var(--fs-card)', 'var(--lh-card)', 600, 'Pipeline by stage'],
  ['Body · 14/20 regular', 'var(--fs-body)', 'var(--lh-body)', 400, 'Data Centre Expansion – Tier III for Angkor Telecom'], ['Meta · 13/18', 'var(--fs-meta)', 'var(--lh-meta)', 400, 'Closes 2026-12-01 · 70% probability'],
  ['Caption · 12/16', 'var(--fs-caption)', 'var(--lh-caption)', 400, 'Updated 5 minutes ago'], ['Khmer · body +6 line height', 'var(--fs-body)', '26px', 400, 'ស្វាគមន៍មកកាន់ប្រព័ន្ធ CRM'],
  ['Vietnamese · body', 'var(--fs-body)', 'var(--lh-body)', 400, 'Cơ hội bán hàng — Ngân hàng Kỹ thương Việt Nam']];
const SPACE = [[1, 2], [2, 4], [3, 6], [4, 8], [5, 12], [6, 16], [7, 20], [8, 24], [9, 32], [10, 40]];
const SECTIONS = [['colors', 'Colour'], ['type', 'Typography'], ['space', 'Spacing & radius'], ['buttons', 'Buttons'], ['forms', 'Forms'], ['status', 'Status & feedback'], ['data', 'Data display'], ['patterns', 'Page patterns'], ['overlays', 'Overlays & states'], ['nav', 'Navigation'], ['icons', 'Icons']];

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function Swatch({ name }) {
  const [v, setV] = useState('');
  useEffect(() => { setV(cssVar(name)); });
  return <div className="ds-swatch"><div className="chip-color" style={{ background: `var(${name})` }} /><div className="meta"><code>{name}</code><div className="muted">{v}</div></div></div>;
}

function Section({ id, title, note, children }) {
  return <section id={id} className="ds-section"><Card title={title}>{note && <p className="ds-note">{note}</p>}{children}</Card></section>;
}

export default function DesignSystemPage() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const [, force] = useState(0);
  const [tab, setTab] = useState('overview');
  const [dlg, setDlg] = useState(false); const [drawer, setDrawer] = useState(false); const [confirm, setConfirm] = useState(false); const [t2, setT2] = useState('overview');
  useEffect(() => { const prev = document.documentElement.dataset.theme; return () => { if (prev) document.documentElement.dataset.theme = prev; else delete document.documentElement.dataset.theme; }; }, []);
  const switchTheme = (t) => { document.documentElement.dataset.theme = t; setTheme(t); force((n) => n + 1); };

  return (
    <div className="stack">
      <PageHead title="Design system" sub="Back-office tokens and components. Navy + Gold · Inter + Noto Sans Khmer · 4px grid · WCAG 2.2 AA.">
        <div className="row" role="group" aria-label="Preview theme">
          <button className={`chip ${theme === 'light' ? 'on' : ''}`} aria-pressed={theme === 'light'} onClick={() => switchTheme('light')}>Light</button>
          <button className={`chip ${theme === 'dark' ? 'on' : ''}`} aria-pressed={theme === 'dark'} onClick={() => switchTheme('dark')}>Dark</button>
        </div>
      </PageHead>
      <nav className="ds-toc" aria-label="Sections">{SECTIONS.map(([id, l]) => <a key={id} className="chip" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }} href={`#${id}`}>{l}</a>)}</nav>

      <Section id="colors" title="Colour" note="Three layers: brand primitives (named by hue) → semantic roles (light and dark) → component tokens. Components only read semantic and component tokens. Gold is never text on a light surface (2.4:1); gold text uses gold-90.">
        <div className="stack">
          {RAMPS.map(([r, label]) => (
            <div key={r}><h4 style={{ marginBottom: 'var(--sp-4)' }}>{label}</h4>
              <div className="ds-ramp">{STEPS.map((s) => <div key={s} style={{ background: `var(--${r}-${s})`, color: s >= 60 ? '#fff' : 'var(--navy-90)' }}><span>{s}</span></div>)}</div></div>
          ))}
          {SEMANTIC.map(([g, names]) => <div key={g}><h4 style={{ marginBottom: 'var(--sp-4)' }}>{g}</h4><div className="ds-swatches">{names.map((n) => <Swatch key={`${n}${theme}`} name={n} />)}</div></div>)}
        </div>
      </Section>

      <Section id="type" title="Typography" note="Inter (variable) for Latin and Vietnamese, Noto Sans Khmer for Khmer. Fixed roles only, nothing below 11px, tabular figures for amounts.">
        {TYPE.map(([l, fs, lh, fw, sample]) => <div key={l} className="ds-type-row"><span className="muted small">{l}</span><span lang={l.startsWith('Khmer') ? 'km' : l.startsWith('Viet') ? 'vi' : undefined} style={{ fontSize: fs, lineHeight: lh, fontWeight: fw, fontVariantNumeric: 'tabular-nums' }}>{sample}</span></div>)}
      </Section>

      <Section id="space" title="Spacing & radius" note="4px grid. Page padding 24, card padding 16, gap between cards 16. Radius: 2 cells/tags · 4 buttons/inputs · 8 cards · 12 dialogs.">
        <div className="grid g2">
          <div className="stack gap-sm">{SPACE.map(([k, px]) => <div key={k} className="ds-space"><code className="ds-code" style={{ width: 64 }}>--sp-{k}</code><i style={{ width: px * 2 }} /><span className="muted">{px}px</span></div>)}</div>
          <div className="row wrap" style={{ alignItems: 'flex-start', gap: 'var(--sp-6)' }}>{[['sm', 2], ['md', 4], ['lg', 8], ['xl', 12]].map(([k, px]) => <div key={k} style={{ textAlign: 'center' }}><div style={{ width: 72, height: 72, background: 'var(--bg-selected)', border: '1px solid var(--border-brand)', borderRadius: `var(--radius-${k})` }} /><div className="small muted" style={{ marginTop: 'var(--sp-3)' }}>radius-{k} · {px}px</div></div>)}</div>
        </div>
      </Section>

      <Section id="buttons" title="Buttons" note="Heights 24 / 32 / 40, radius 4. One primary (navy) per screen. Gold accent is only for the single decisive step, such as Mark won or Approve. Actions a role cannot perform are hidden, not disabled.">
        <div className="stack">
          <div className="row wrap"><button className="btn primary">Primary</button><button className="btn">Secondary</button><button className="btn accent"><Icon name="check" size={16} />Decisive step</button><button className="btn ghost">Ghost</button><button className="btn danger">Delete</button><button className="btn" disabled>Disabled</button></div>
          <div className="row wrap"><button className="btn primary sm">Small 24</button><button className="btn primary">Medium 32</button><button className="btn primary lg">Large 40</button><button className="btn"><Icon name="add" size={16} />With icon</button><button className="iconbtn" aria-label="Edit"><Icon name="edit" /></button></div>
        </div>
      </Section>

      <Section id="forms" title="Forms" note="Labels sit above fields. Inputs are 32px high with a 3:1 border; focus shows a navy ring (gold in dark mode). Required fields are marked with an asterisk.">
        <div className="form-grid">
          <label className="f"><span>Account name<span className="req"> *</span></span><input type="text" defaultValue="Angkor Telecom Co., Ltd" /></label>
          <label className="f">Stage<select defaultValue="S03"><option value="S03">S03 Discovery</option><option>S04 Solution design</option></select></label>
          <label className="f">Amount (USD)<input type="number" defaultValue={620000} /><span className="help">Converted to base currency at today's rate.</span></label>
          <label className="f">Close date<input type="date" defaultValue="2026-12-01" /></label>
          <label className="f full">Notes<textarea defaultValue="Customer wants a phased rollout in Q1." /></label>
          <label className="f">Read-only<input type="text" readOnly value="OPP-2026-00019" /></label>
          <label className="check"><input type="checkbox" defaultChecked />Mine only</label>
        </div>
      </Section>

      <Section id="status" title="Status & feedback" note="Status is never shown by colour alone: badges carry a dot and a word, alerts carry an icon. Warning orange is kept separate from brand gold.">
        <div className="stack">
          <div className="row wrap"><Badge v="Won" /><Badge v="Pending" /><Badge v="Rejected" /><Badge v="Open" /><Badge v="Archived" /></div>
          <div className="grid g2"><Alert kind="info">Quotation QUO-2026-00012 was sent to the customer.</Alert><Alert kind="good">Claim approved and queued for payment.</Alert><Alert kind="warn">Margin is below 12%. Finance approval is required.</Alert><Alert kind="bad">The deal registration expired on 2026-11-02.</Alert></div>
          <div className="row wrap"><div className="toast success"><Icon name="success" /><span>Saved</span></div><div className="toast"><Icon name="info" /><span>3 records imported</span></div><div className="toast error"><Icon name="error" /><span>Could not save. Try again.</span></div></div>
          <div className="row"><button className="btn" onClick={() => setDlg(true)}>Open a dialog</button></div>
          {dlg && <Modal title="Close opportunity as lost?" size="narrow" onClose={() => setDlg(false)} footer={<><button className="btn" onClick={() => setDlg(false)}>Cancel</button><button className="btn danger" onClick={() => setDlg(false)}>Mark lost</button></>}><p>This moves <b>Smart Factory Connectivity</b> to Closed Lost. It can be reopened by a Sales Manager.</p><label className="f">Reason<select><option>Price</option><option>Competitor</option></select></label></Modal>}
        </div>
      </Section>

      <Section id="data" title="Data display" note="One table pattern everywhere: 36px header, 44px rows, numbers right-aligned in tabular figures, whole row clickable.">
        <div className="stack">
          <div className="grid kpis"><div className="card kpi"><div className="label"><Icon name="pipeline" size={16} />Open pipeline</div><div className="value">2.8M</div><div className="hint">14 opportunities · avg 198K</div></div><div className="card kpi"><div className="label"><Icon name="targets" size={16} />Won this quarter</div><div className="value">296K</div><div className="hint">3 won · win rate 60%</div></div><div className="card kpi"><div className="label"><Icon name="approvals" size={16} />Awaiting approval</div><div className="value">4</div><div className="hint">Oldest 2 days</div></div></div>
          <div className="card"><div className="table-wrap"><table className="t"><thead><tr><th>Number</th><th>Opportunity</th><th>Stage</th><th>Status</th><th className="num">Amount</th></tr></thead><tbody>
            {[['OPP-2026-00019', 'Data Centre Expansion – Tier III', 'S09 Negotiation', 'Open', '620,000'], ['OPP-2026-00011', 'Mobile Banking DR Site', 'S10 Verbal Commitment', 'Won', '450,000'], ['OPP-2026-00006', 'Smart Factory Connectivity', 'S02 Qualification', 'Lost', '85,000']].map((r) => <tr key={r[0]} className="click"><td>{r[0]}</td><td>{r[1]}</td><td><span className="badge info plain">{r[2]}</span></td><td><Badge v={r[3]} /></td><td className="num">{r[4]}</td></tr>)}
          </tbody></table></div><div className="pager"><span>1–3 of 14</span><span className="row"><button className="btn sm" disabled>Previous</button><button className="btn sm">Next</button></span></div></div>
          <div className="stages">{['S01 New', 'S02 Qualification', 'S03 Discovery', 'S04 Design', 'S05 Validation'].map((s, i) => <div key={s} className={`stage ${i < 2 ? 'done' : i === 2 ? 'cur' : ''}`}><b>{s.split(' ')[0]}</b>{s.split(' ').slice(1).join(' ')}</div>)}</div>
          <div className="grid g2"><Card title="Key facts"><KV items={[{ k: 'Account', v: 'Angkor Telecom' }, { k: 'Owner', v: 'Sreyleak Kim' }, { k: 'Close date', v: '2026-12-01' }]} /></Card><Card title="Empty state"><Empty icon="inbox">No quotations yet. Create one from an opportunity.</Empty></Card></div>
        </div>
      </Section>

      <Section id="nav" title="Navigation" note="One light canvas holds the top bar and the sidebar; each page sits in a rounded white sheet. The current page uses a soft navy tint, medium weight and a filled icon (shape, not colour alone). The krama check stays for navy brand panels such as the login hero.">
        <div className="stack">
          <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'quotes', label: 'Quotations', count: 3 }, { key: 'activity', label: 'Activity', count: 12 }]} />
          <div className="row wrap"><button className="chip on">All</button><button className="chip">Open</button><button className="chip">Won</button><button className="chip">Lost</button></div>
          <nav className="card side-list" aria-label="Side list example" style={{ position: 'static', maxWidth: 280 }}>{[['Pipeline by stage', 'RPT-01'], ['Pipeline by owner', 'RPT-02'], ['Win / loss analysis (by month)', 'RPT-05']].map(([n, c], i) => <button key={c} className={`side-list-item ${i === 0 ? 'on' : ''}`} aria-current={i === 0 ? 'true' : undefined}><span className="name">{n}</span><span className="code">{c}</span></button>)}</nav>
          <div className="krama" style={{ borderRadius: 'var(--radius-lg)', height: 64, display: 'flex', alignItems: 'center', padding: '0 var(--sp-6)', color: 'var(--brand-surface-fg)', gap: 'var(--sp-4)' }}><span className="logo">C</span><b>Brand surface · krama check (login hero only)</b></div>
        </div>
      </Section>

      <Section id="patterns" title="Page patterns" note="Every page uses the same header: breadcrumbs, record type, title with status, a meta line, then one primary action. Secondary actions sit next to it; everything else goes in More, with destructive actions last. Key facts appear once, in the summary strip.">
        <div className="stack">
          <div className="card card-b">
            <PageHead crumbs={[{ label: 'Opportunities', to: '/opportunities' }, { label: 'OPP-2026-00002' }]} eyebrow="Opportunity" title={<>Data Centre Expansion – Tier III <Badge v="Open" /></>} sub="OPP-2026-00002 · Owner Sreyleak Kim">
              <ActionBar actions={[{ label: 'Move to Negotiation', icon: 'next', onClick: () => {} }, { label: 'Edit', icon: 'edit', onClick: () => {} }, { label: 'Put on hold', onClick: () => {} }, { label: 'Override probability…', onClick: () => {} }, { label: 'Cancel deal…', danger: true, onClick: () => {} }]} />
            </PageHead>
            <SummaryStrip items={[{ k: 'Amount', v: 'USD 620,000' }, { k: 'Probability', v: '70%' }, { k: 'Weighted', v: '434,000' }, { k: 'Forecast', v: <Badge v="Commit" /> }, { k: 'Close date', v: '2026-12-01' }]} />
            <Tabs value={t2} onChange={setT2} tabs={['Overview', 'Quotations', 'Stakeholders', 'Team', 'Partners', 'Competitors', 'Deal registrations', 'Requirements', 'Documents', 'History'].map((l, i) => ({ key: i ? l : 'overview', label: l, count: i && i < 8 ? i : undefined }))} />
          </div>
          <div className="row wrap"><Segmented value="list" items={[{ key: 'list', label: 'List', icon: 'listView', to: '/opportunities' }, { key: 'board', label: 'Board', icon: 'boardView', to: '/pipeline' }]} /><Menu label="Create" icon="add" buttonClass="btn primary" size="sm" items={[{ label: 'Lead', icon: 'leads' }, { label: 'Opportunity', icon: 'opportunities' }, { label: 'Expense claim', icon: 'claims' }]} /><Menu label="Row actions" iconOnly icon="more" buttonClass="iconbtn" items={[{ label: 'Open' }, { label: 'Edit' }, { divider: true }, { label: 'Delete', danger: true }]} /></div>
          <Breadcrumbs items={[{ label: 'Admin & settings', to: '/admin' }, { label: 'Users', to: '/users' }, { label: 'Sophea Chan' }]} />
          <div className="card"><div className="bulk-bar"><span>3 selected</span><button className="btn sm"><Icon name="download" size={16} />Export selected</button><button className="btn sm"><Icon name="reassign" size={16} />Change owner</button><div className="grow" /><button className="btn sm ghost">Clear selection</button></div><div className="filter-row"><button className="chip active-filter">Country: Cambodia<Icon name="close" size={16} /></button><button className="chip active-filter">Source: Event<Icon name="close" size={16} /></button></div></div>
        </div>
      </Section>

      <Section id="overlays" title="Overlays & states" note="Short forms (8 fields or fewer) open in a dialog; longer ones in a side drawer so the list stays visible. Destructive actions confirm what happens, what's affected, and whether it can be undone. Loading shows skeletons shaped like the content, never a blank page.">
        <div className="stack">
          <div className="row wrap"><button className="btn" onClick={() => setDrawer(true)}>Open a drawer form</button><button className="btn danger" onClick={() => setConfirm(true)}>Open a destructive confirm</button></div>
          <ErrorSummary errors={{ company: 'Company is required', country: 'Country is required' }} />
          <div className="grid g2"><Card title="Skeleton · table"><Skeleton variant="rows" count={3} /></Card><Card title="Skeleton · details"><Skeleton variant="kv" count={6} /></Card></div>
          <div className="grid g2"><Card title="Empty state with next step"><Empty icon="leads" title="No leads yet" action={<button className="btn sm"><Icon name="add" size={16} />New lead</button>}>Leads you capture or import appear here.</Empty></Card><PermissionState what="vendor costs" /></div>
          <div className="row wrap"><span className="muted small">Tooltips: hover or focus →</span><button className="iconbtn" title="Tooltips appear on keyboard focus too" aria-label="Example tooltip"><Icon name="info" /></button></div>
          {drawer && <Drawer title="New lead" sub="Fields marked * are required" onClose={() => setDrawer(false)}><div className="form-grid"><div className="form-section">Company</div><label className="f"><span>Company<span className="req"> *</span></span><input type="text" /></label><label className="f">Industry<select><option>—</option></select></label><div className="form-section">Contact</div><label className="f">First name<input type="text" /></label><label className="f">Last name<input type="text" /></label></div><div className="form-actions"><button className="btn" onClick={() => setDrawer(false)}>Cancel</button><button className="btn primary" onClick={() => setDrawer(false)}>Create lead</button></div></Drawer>}
          {confirm && <Confirm danger title="Delete this expense line?" message="Taxi to client site · USD 18" consequences={['The claim total is recalculated.']} undo={false} reasonLabel="Reason" yesLabel="Delete line" onNo={() => setConfirm(false)} onYes={() => setConfirm(false)} />}
        </div>
      </Section>

      <Section id="icons" title="Icons" note="One family: Phosphor, behind semantic names (use <Icon name=&quot;quotations&quot; />). Regular for chrome, fill for the selected state, duotone for empty states. Sizes 16 / 20 / 24.">
        <div className="ds-icons">{iconNames.map((n) => <div key={n}><Icon name={n} size={24} />{n}</div>)}</div>
      </Section>
    </div>
  );
}
