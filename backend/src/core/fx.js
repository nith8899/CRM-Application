'use strict';
const db = require('../db');
const settings = require('./settings');
const { bad } = require('./errors');

async function directRate(from, to, date, type = 'Corporate', c = db) {
  const { rows } = await c.query(
    `SELECT rate FROM exchange_rates WHERE from_ccy=$1 AND to_ccy=$2 AND rate_type=$3 AND effective_date <= $4 AND is_deleted=false
     ORDER BY effective_date DESC LIMIT 1`, [from, to, type, date]);
  return rows[0] ? rows[0].rate : null;
}
/** Rate converting 1 unit of `from` into `to` on `date` (direct, inverse, or via base currency). */
async function rate(from, to, date, c = db) {
  if (!from || !to || from === to) return 1;
  const d = date || new Date().toISOString().slice(0, 10);
  let r = await directRate(from, to, d, 'Corporate', c);
  if (r) return r;
  const inv = await directRate(to, from, d, 'Corporate', c);
  if (inv) return 1 / inv;
  const base = await settings.get('base_currency', 'USD');
  const a = from === base ? 1 : (await directRate(from, base, d, 'Corporate', c)) || ((await directRate(base, from, d, 'Corporate', c)) ? 1 / (await directRate(base, from, d, 'Corporate', c)) : null);
  const b = to === base ? 1 : (await directRate(base, to, d, 'Corporate', c)) || ((await directRate(to, base, d, 'Corporate', c)) ? 1 / (await directRate(to, base, d, 'Corporate', c)) : null);
  if (a && b) return a * b;
  throw bad(`No exchange rate available for ${from} -> ${to} on ${d}`);
}
const toBase = async (amount, ccy, date, c = db) => {
  const base = await settings.get('base_currency', 'USD');
  return amount == null ? null : round2(amount * (await rate(ccy, base, date, c)));
};
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
module.exports = { rate, toBase, round2 };
