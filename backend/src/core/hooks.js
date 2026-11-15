'use strict';
// Per-entity business-rule hooks (validate / beforeCreate / afterUpdate ...), registered by modules.
const reg = {};
const EMPTY = Object.freeze({});
module.exports = {
  register(key, h) { reg[key] = { ...(reg[key] || {}), ...h }; },
  get(key) { return reg[key] || EMPTY; },
};
