'use strict';
const db = require('../db');
let cache = { at: 0, map: {} };
async function all() {
  if (Date.now() - cache.at < 15000) return cache.map;
  const { rows } = await db.query('SELECT key, value FROM app_settings');
  cache = { at: Date.now(), map: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  return cache.map;
}
async function get(key, def) { const m = await all(); return m[key] === undefined ? def : m[key]; }
const clear = () => { cache.at = 0; };
module.exports = { get, all, clear };
