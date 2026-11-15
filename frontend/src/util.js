export const fmtMoney = (n, ccy) => (n == null || n === '' ? '—' : `${ccy ? ccy + ' ' : ''}${Number(n).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`);
export const fmtCompact = (n) => { if (n == null) return '—'; const a = Math.abs(n); if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`; if (a >= 1e3) return `${(n / 1e3).toFixed(0)}K`; return String(Math.round(n)); };
export const fmtDate = (d) => (d ? String(d).slice(0, 10) : '—');
export const fmtDateTime = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
export const fmtPct = (n) => (n == null ? '—' : `${Number(n).toFixed(1)}%`);
export const toInputDateTime = (d) => { if (!d) return ''; const x = new Date(d); if (isNaN(x)) return ''; const p = (n) => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`; };
export const today = () => new Date().toISOString().slice(0, 10);
export const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const GOOD = ['active', 'approved', 'won', 'paid', 'completed', 'validated', 'vendor approved', 'vendor validated', 'accepted', 'converted', 'qualified', 'valid', 'attended', 'open for registration', 'authorised', 'succeeded', 'closed won', 'reviewed', 'ready for payment', 'registered', 'done'];
const BAD = ['rejected', 'lost', 'failed', 'expired', 'blocked', 'cancelled', 'terminated', 'disqualified', 'declined', 'dead-letter', 'suspended', 'deactivated', 'no-show', 'missed', 'high', 'critical', 'vendor rejected', 'withdrawn', 'invalidated', 'overdue'];
const WARN = ['pending', 'submitted', 'in approval', 'pending approval', 'draft', 'returned', 'under review', 'in review', 'on hold', 'expiring', 'in progress', 'pending acceptance', 'under internal review', 'budget pending', 'planned', 'upcoming', 'new', 'medium', 'waitlisted', 'pending authorisation', 'blocked', 'estimated', 'reopened'];
export function badgeClass(v) {
  const s = String(v || '').toLowerCase();
  if (BAD.includes(s) && !['blocked'].includes(s)) return 'bad';
  if (GOOD.includes(s)) return 'good';
  if (WARN.includes(s) || s === 'blocked') return 'warn';
  if (['open', 'sent', 'working', 'active pipeline', 'normal', 'in batch', 'sent to payment'].includes(s)) return 'info';
  return 'neutral';
}
export const initials = (n) => String(n || '?').split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
export const entityPath = (e, id) => `/${e}/${id}`;
