'use strict';
const db = require('../db');

/** Appends to the immutable audit log (ENT-44). `c` may be a tx client. */
async function audit(ctx, ev, c = db) {
  try {
    await c.query(
      `INSERT INTO audit_log (user_id, user_name, event, entity, record_id, record_label, changes, detail, ip, data_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [ctx && ctx.id || null, ctx && ctx.user && ctx.user.name || ev.userName || null, ev.event, ev.entity || null, ev.recordId || null,
        ev.label || null, ev.changes ? JSON.stringify(ev.changes) : null, ev.detail || null, ctx && ctx.ip || null, ev.source || 'UI']);
  } catch (e) { console.error('audit failed', e.message); }
}

/** Diff of two plain objects over a list of fields. */
function diff(oldRow, newRow, fields) {
  const ch = {};
  for (const f of fields) {
    const a = oldRow ? oldRow[f] : undefined;
    const b = newRow[f];
    if (b === undefined) continue;
    const norm = (v) => (v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));
    if (norm(a) !== norm(b)) ch[f] = [a === undefined ? null : a, b];
  }
  return ch;
}
module.exports = { audit, diff };
