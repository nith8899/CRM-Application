'use strict';
process.env.NODE_ENV = 'test';
process.env.DISABLE_JOBS = '1';
const http = require('http');
const { createApp } = require('../src/server');
const A = require('../src/core/access');

let server; let base;
async function start() {
  await A.loadPerms();
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}
async function stop() { await new Promise((r) => server.close(r)); await require('../src/db').pool.end(); }

const tokens = {};
async function raw(path, token, init = {}) { return fetch(base + path, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${token}` } }); }
async function call(method, path, body, token) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}
async function as(login, password = 'Crm@Demo2026') {
  if (!tokens[login]) { const r = await call('POST', '/api/auth/login', { login, password }); if (r.status !== 200) throw new Error(`login ${login} failed: ${JSON.stringify(r.data)}`); tokens[login] = r.data.token; }
  const t = tokens[login];
  return { get: (p) => call('GET', '/api' + p, undefined, t), post: (p, b) => call('POST', '/api' + p, b || {}, t), put: (p, b) => call('PUT', '/api' + p, b || {}, t), del: (p, b) => call('DELETE', '/api' + p, b || {}, t), token: t };
}
module.exports = { start, stop, as, call, raw };
