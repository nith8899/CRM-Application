'use strict';
class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const bad = (m, x) => new HttpError(400, m, x);
const forbidden = (m = 'You do not have permission to perform this action') => new HttpError(403, m);
const notFound = (m = 'Record not found') => new HttpError(404, m);
const conflict = (m, x) => new HttpError(409, m, x);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
module.exports = { HttpError, bad, forbidden, notFound, conflict, wrap };
