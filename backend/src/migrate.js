'use strict';
// Creates the database schema: hand-written core SQL + tables generated from the entity registry.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { entities, sqlType } = require('./entities');

const STD = `created_by bigint, created_at timestamptz NOT NULL DEFAULT now(),
  modified_by bigint, modified_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false, deleted_by bigint, deleted_at timestamptz,
  version integer NOT NULL DEFAULT 1, data_source text DEFAULT 'UI', legacy_id text`;

function defaultSql(f) {
  if (f.def === undefined) return '';
  if (f.type === 'bool') return ` DEFAULT ${f.def ? 'true' : 'false'}`;
  if (typeof f.def === 'number') return ` DEFAULT ${f.def}`;
  return ` DEFAULT '${String(f.def).replace(/'/g, "''")}'`;
}

async function run() {
  await db.query(fs.readFileSync(path.join(__dirname, '..', 'sql', '001_core.sql'), 'utf8'));
  const fks = [];
  const idx = [];
  for (const e of Object.values(entities)) {
    if (e.core) continue;
    const cols = ['id bigserial PRIMARY KEY'];
    for (const f of e.fields) {
      if (f.virtual) continue;
      if (f.name === 'number') { cols.push('number text'); continue; }
      let c = `${f.name} ${sqlType(f)}`;
      if (f.req && f.type !== 'ref' && f.def === undefined && !f.sys) c += ' NOT NULL';
      c += defaultSql(f);
      cols.push(c);
      if (f.type === 'ref') {
        fks.push(`ALTER TABLE ${e.table} ADD CONSTRAINT fk_${e.table}_${f.name} FOREIGN KEY (${f.name}) REFERENCES ${entities[f.ref].table}(id)`);
        idx.push(`CREATE INDEX IF NOT EXISTS ix_${e.table}_${f.name} ON ${e.table}(${f.name})`);
      }
    }
    if (!e.plain) cols.push(STD);
    await db.query(`CREATE TABLE IF NOT EXISTS ${e.table} (\n  ${cols.join(',\n  ')}\n)`);
    // evolve existing tables: add any new columns
    for (const f of e.fields) { if (f.virtual || f.name === 'number') continue; await db.query(`ALTER TABLE ${e.table} ADD COLUMN IF NOT EXISTS ${f.name} ${sqlType(f)}${defaultSql(f)}`); }
    if (e.prefix) idx.push(`CREATE UNIQUE INDEX IF NOT EXISTS ux_${e.table}_number ON ${e.table}(number)`);
    for (const f of e.fields) if (f.uniq && !f.virtual) idx.push(`CREATE UNIQUE INDEX IF NOT EXISTS ux_${e.table}_${f.name} ON ${e.table}(${f.name})${e.plain ? '' : ' WHERE is_deleted = false'}`);
    (e.unique || []).forEach((u, i) => idx.push(`CREATE UNIQUE INDEX IF NOT EXISTS ux_${e.table}_u${i} ON ${e.table}(${u.join(',')})${e.plain ? '' : ' WHERE is_deleted = false'}`));
    if (e.statusField) idx.push(`CREATE INDEX IF NOT EXISTS ix_${e.table}_status ON ${e.table}(${e.statusField})`);
  }
  for (const sql of fks) {
    const name = sql.match(/CONSTRAINT (\S+)/)[1];
    const tbl = sql.match(/ALTER TABLE (\S+)/)[1];
    const r = await db.query('SELECT 1 FROM pg_constraint WHERE conname=$1 AND conrelid=$2::regclass', [name, tbl]);
    if (!r.rowCount) await db.query(sql);
  }
  for (const sql of idx) await db.query(sql);

  // Extra application tables / immutability guards
  await db.query(fs.readFileSync(path.join(__dirname, '..', 'sql', '002_extra.sql'), 'utf8'));
  console.log(`Schema ready: ${Object.values(entities).length} entities.`);
}
module.exports = { run };
if (require.main === module) run().then(() => db.pool.end()).catch((e) => { console.error(e); process.exit(1); });
