'use strict';
const { Pool, types } = require('pg');
const config = require('./config');
// Return NUMERIC as JS numbers (money/decimal), DATE as 'YYYY-MM-DD' strings, BIGINT as numbers.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(1082, (v) => v);

// All CRM objects live in their own schema so an existing database (e.g. a shared local 'postgres') is never touched.
const pool = new Pool({ ...config.db, max: 20, options: `-c search_path=${config.schema},public` });
pool.on('error', (e) => console.error('PG pool error', e.message));

const query = (text, params) => pool.query(text, params);
async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn({ query: (t, p) => c.query(t, p) });
    await c.query('COMMIT');
    return r;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally { c.release(); }
}
module.exports = { pool, query, tx };
