'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../db');
const A = require('../core/access');
const { audit } = require('../core/audit');
const { bad, wrap, HttpError } = require('../core/errors');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const MAX_FAILS = 5;
const LOCK_MIN = 15;

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain upper-case, lower-case and a digit';
  return null;
}

router.post('/login', rateLimit({ windowMs: 60000, max: 60, standardHeaders: true, legacyHeaders: false }), wrap(async (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) throw bad('Login and password are required');
  const { rows } = await db.query('SELECT * FROM users WHERE (lower(login)=lower($1) OR lower(email)=lower($1)) AND is_deleted=false', [login]);
  const u = rows[0];
  const ctx = { ip: req.ip, user: { name: login } };
  if (!u) { await audit(ctx, { event: 'login_failed', detail: `unknown user ${login}` }); throw new HttpError(401, 'Invalid login or password'); }
  if (u.locked_until && new Date(u.locked_until) > new Date()) throw new HttpError(423, 'Account temporarily locked after repeated failed attempts. Try again later.');
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) {
    const fails = u.failed_logins + 1;
    await db.query('UPDATE users SET failed_logins=$2::int, locked_until = CASE WHEN $2::int >= $3::int THEN now() + ($4::text || \' minutes\')::interval ELSE locked_until END WHERE id=$1', [u.id, fails, MAX_FAILS, String(LOCK_MIN)]);
    await audit({ id: u.id, ip: req.ip, user: u }, { event: 'login_failed', detail: `failed attempt ${fails}` });
    throw new HttpError(401, 'Invalid login or password');
  }
  if (u.status !== 'Active') throw new HttpError(403, `Account is ${u.status}`);
  await db.query('UPDATE users SET failed_logins=0, locked_until=NULL, last_login_at=now() WHERE id=$1', [u.id]);
  await audit({ id: u.id, ip: req.ip, user: u }, { event: 'login', detail: 'successful sign-in' });
  const token = jwt.sign({ sub: u.id, tv: u.token_version }, config.jwtSecret, { expiresIn: config.jwtExpires });
  res.json({ token });
}));

router.get('/me', authenticate, wrap(async (req, res) => {
  const ctx = req.ctx; const u = ctx.user;
  const modules = {};
  for (let i = 1; i <= 35; i++) {
    const m = 'M' + String(i).padStart(2, '0');
    const actions = ['V', 'C', 'E', 'D', 'S', 'A', 'X', 'I', 'G', 'H', 'F', 'U', 'K'].filter((a) => A.can(ctx, m, a));
    if (actions.length) modules[m] = { actions, scopes: [...A.scopesFor(ctx, m, actions[0])] };
  }
  const { rows: us } = await db.query('SELECT key, value FROM user_settings WHERE user_id=$1', [u.id]);
  const { rows: unread } = await db.query(`SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND status='Sent' AND read_at IS NULL`, [u.id]);
  const { rows: team } = u.team_id ? await db.query('SELECT name FROM teams WHERE id=$1', [u.team_id]) : { rows: [] };
  res.json({
    id: u.id, name: u.name, login: u.login, email: u.email, job_title: u.job_title, country: u.country, time_zone: u.time_zone, locale: u.locale,
    user_type: u.user_type, must_change_password: u.must_change_password, team: team[0] && team[0].name,
    roles: [...ctx.roles], modules, settings: Object.fromEntries(us.map((x) => [x.key, x.value])), unread_notifications: unread[0].n,
  });
}));

router.post('/change-password', authenticate, wrap(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  const ok = await bcrypt.compare(current_password || '', req.ctx.user.password_hash);
  if (!ok) throw bad('Current password is incorrect');
  const err = checkPassword(new_password); if (err) throw bad(err);
  const hash = await bcrypt.hash(new_password, 10);
  await db.query('UPDATE users SET password_hash=$2, must_change_password=false, token_version=token_version+1 WHERE id=$1', [req.ctx.id, hash]);
  await audit(req.ctx, { event: 'password_change', entity: 'users', recordId: req.ctx.id });
  const { rows } = await db.query('SELECT token_version FROM users WHERE id=$1', [req.ctx.id]);
  res.json({ token: jwt.sign({ sub: req.ctx.id, tv: rows[0].token_version }, config.jwtSecret, { expiresIn: config.jwtExpires }) });
}));

router.post('/logout', authenticate, wrap(async (req, res) => {
  await audit(req.ctx, { event: 'logout' });
  res.json({ ok: true });
}));

module.exports = { router, checkPassword };
