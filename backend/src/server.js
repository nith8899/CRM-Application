'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');
const db = require('./db');
const A = require('./core/access');
const crud = require('./core/crud');
const { authenticate } = require('./middleware/auth');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  if (process.env.NODE_ENV !== 'test') app.use(morgan('tiny'));

  app.get('/api/health', async (req, res) => {
    try { await db.query('select 1'); res.json({ status: 'ok', db: 'up', time: new Date().toISOString() }); }
    catch (e) { res.status(503).json({ status: 'degraded', db: 'down' }); }
  });
  app.use('/api/auth', require('./modules/auth').router);

  // everything below requires a valid session
  const api = express.Router();
  api.use(authenticate);
  // business modules (load order matters: hooks before generic CRUD handles requests)
  for (const m of ['hooks', 'opportunities', 'leads', 'quotations', 'approvals', 'dealreg', 'finance', 'workforce', 'platform', 'forecast', 'reports', 'admin', 'ai']) {
    const mod = require(`./modules/${m}`);
    if (mod.router) api.use(mod.router);
  }
  api.use('/e', crud.router);       // generic metadata-driven CRUD for all entities
  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  // Serve built frontend (production)
  const dist = path.join(__dirname, '..', '..', 'frontend', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.code === '23505' ? 409 : err.code === '23503' ? 409 : err.code === '23502' ? 400 : 500);
    if (status >= 500) console.error(err);
    let message = err.message;
    if (err.code === '23505') message = 'A record with the same unique value already exists';
    if (err.code === '23503') message = 'Operation conflicts with related records';
    if (err.code === '23502') message = `Missing required value: ${err.column || ''}`;
    if (status >= 500 && process.env.NODE_ENV === 'production') message = 'Internal server error';
    res.status(status).json({ error: message, ...(err.extra || {}) });
  });
  return app;
}

async function start() {
  await A.loadPerms();
  const app = createApp();
  const server = app.listen(config.port, () => console.log(`CRM API listening on http://localhost:${config.port}`));
  require('./jobs').start();
  return server;
}
module.exports = { createApp, start };
if (require.main === module) start().catch((e) => { console.error(e); process.exit(1); });
