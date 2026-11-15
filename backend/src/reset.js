'use strict';
// Drops everything in the public schema, then recreates schema + seed data. DEV ONLY.
const db = require('./db');
(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset in production');
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await require('./migrate').run();
  await require('./seed').run();
  await db.pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
