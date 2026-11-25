'use strict';
// Drops only the CRM schema, then recreates schema + seed data. DEV ONLY.
const db = require('./db');
(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset in production');
  const schema = require('./config').schema;
  await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await require('./migrate').run();
  await require('./seed').run();
  await db.pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
