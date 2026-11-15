'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const A = require('../core/access');
const settings = require('../core/settings');
const { HttpError } = require('../core/errors');

async function authenticate(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.access_token;
    if (!token) throw new HttpError(401, 'Authentication required');
    let payload;
    try { payload = jwt.verify(token, config.jwtSecret); } catch (e) { throw new HttpError(401, 'Session expired. Please sign in again.'); }
    const { rows } = await db.query('SELECT * FROM users WHERE id=$1 AND is_deleted=false', [payload.sub]);
    const u = rows[0];
    if (!u || u.status !== 'Active' || u.token_version !== payload.tv) throw new HttpError(401, 'Session is no longer valid');
    req.ctx = await A.buildContext(u);
    req.ctx.ip = req.ip;
    A.setAllowSeMargin(req.ctx, !!(await settings.get('se_can_view_margin', true)));
    next();
  } catch (e) { next(e); }
}
module.exports = { authenticate };
