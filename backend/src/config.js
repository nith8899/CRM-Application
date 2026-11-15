'use strict';
require('dotenv').config({ quiet: true });
module.exports = {
  port: parseInt(process.env.PORT || '4000', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me-crm-jwt-secret',
  jwtExpires: process.env.JWT_EXPIRES || '8h',
  uploadDir: process.env.UPLOAD_DIR || require('path').join(__dirname, '..', 'uploads'),
  db: {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'postgres',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '123456',
  },
  baseCurrency: process.env.BASE_CURRENCY || 'USD',
};
