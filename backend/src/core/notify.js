'use strict';
const db = require('../db');
/** Creates an in-app notification (ENT-43). dedupKey suppresses duplicates per user. */
async function notify(userId, { type, title, body, entity, recordId, dedupKey }, c = db) {
  if (!userId) return;
  try {
    // respect user preferences (FR-NOT): muted types
    const pref = await c.query(`SELECT value FROM user_settings WHERE user_id=$1 AND key='notification_prefs'`, [userId]);
    const muted = pref.rows[0] && pref.rows[0].value && pref.rows[0].value.muted;
    const status = Array.isArray(muted) && muted.includes(type) ? 'Suppressed' : 'Sent';
    await c.query(
      `INSERT INTO notifications (user_id,type,title,body,entity,record_id,dedup_key,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
      [userId, type, title, body || null, entity || null, recordId || null, dedupKey || null, status]);
  } catch (e) { console.error('notify failed', e.message); }
}
async function notifyRole(roleCode, payload, c = db) {
  const { rows } = await c.query(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
     WHERE r.code=$1 AND u.status='Active' AND u.is_deleted=false`, [roleCode]);
  for (const r of rows) await notify(r.id, payload, c);
}
module.exports = { notify, notifyRole };
