'use strict';
// Compact field DSL used by the entity registry.  One definition drives:
//   * PostgreSQL DDL (migrate.js)        * REST CRUD + validation (crud.js)
//   * generated UI forms/lists (meta API) * field-level security (access.js)
const mk = (type) => (name, label, o = {}) => ({ name, label, type, ...o });

module.exports = {
  T: mk('text'),
  LT: mk('longtext'),
  I: mk('int'),
  N: mk('decimal'),
  M: mk('money'),
  PCT: mk('pct'),
  D: mk('date'),
  DT: mk('datetime'),
  B: mk('bool'),
  E: mk('email'),
  P: mk('phone'),
  U: mk('url'),
  J: mk('json'),
  // select: options is an array of strings, or a picklist name
  S: (name, label, options, o = {}) => ({ name, label, type: 'select', options, ...o }),
  // reference to another entity (foreign key)
  R: (name, label, ref, o = {}) => ({ name, label, type: 'ref', ref, ...o }),
};
