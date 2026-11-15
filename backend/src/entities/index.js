'use strict';
// Entity registry: merges all entity files, adds standard columns, indexes by key / table.
const lists = [require('./relationship'), require('./sales'), require('./ops')];

const SQL_TYPE = {
  text: 'text', longtext: 'text', email: 'text', phone: 'text', url: 'text', select: 'text',
  int: 'integer', money: 'numeric(18,2)', pct: 'numeric(7,2)', date: 'date', datetime: 'timestamptz', bool: 'boolean', json: 'jsonb', ref: 'bigint',
};
const sqlType = (f) => (f.type === 'decimal' ? `numeric(24,${f.scale || 4})` : SQL_TYPE[f.type]);

const entities = {};
const byTable = {};
for (const list of lists) {
  for (const e of list) {
    e.fields = e.fields.map((f) => ({ ...f }));
    e.fieldMap = Object.fromEntries(e.fields.map((f) => [f.name, f]));
    e.hasOwner = !!e.owned;
    if (e.owned) {
      e.fieldMap.owner_id = { name: 'owner_id', label: e.ownerLabel || 'Owner', type: 'ref', ref: 'users', req: 1, list: 1, std: 1 };
      e.fields.unshift(e.fieldMap.owner_id);
    }
    if (e.prefix) {
      e.fieldMap.number = { name: 'number', label: 'Number', type: 'text', list: 1, readonly: 1, std: 1, search: 1 };
      e.fields.unshift(e.fieldMap.number);
    }
    entities[e.key] = e;
    byTable[e.table] = e;
  }
}
for (const e of Object.values(entities)) {
  for (const f of e.fields) if (f.type === 'ref' && !entities[f.ref]) throw new Error(`${e.key}.${f.name} -> unknown entity ${f.ref}`);
  e.cols = e.fields.filter((f) => !f.virtual).map((f) => f.name);
  e.has = (c) => !!e.fieldMap[c];
}
module.exports = { entities, byTable, sqlType };
