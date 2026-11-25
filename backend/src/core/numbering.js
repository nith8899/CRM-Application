'use strict';
const db = require('../db');
/** Sequential, never-reused business numbers, e.g. OPP-2026-00042 (BRULE-QUO-001 etc.). */
async function nextNumber(prefix, c = db, width = 5) {
  const year = new Date().getUTCFullYear();
  const { rows } = await c.query(
    `INSERT INTO sequences (key, year, last_value) VALUES ($1,$2,1)
     ON CONFLICT (key, year) DO UPDATE SET last_value = sequences.last_value + 1 RETURNING last_value`, [prefix, year]);
  return `${prefix}-${year}-${String(rows[0].last_value).padStart(width, '0')}`;
}
module.exports = { nextNumber };
