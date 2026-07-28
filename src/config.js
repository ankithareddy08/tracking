'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);

// Base URL used when building the tracking links we hand back to the user.
// Point this at your real domain once deployed and every new link picks it up.
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'data', 'tracking.db');

// Set both to use a hosted libSQL/Turso database instead of a local file — the
// only option on hosts with no writable disk, like Vercel's serverless
// functions. Leave both unset for local development: db.js falls back to a
// plain SQLite file at DB_PATH, no Turso account needed.
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || null;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || null;

// IPs are never stored in the clear: we keep a salted hash so a visitor can be
// counted as unique without the raw address being recoverable from the database.
// A random salt each boot would break unique-visitor counts across restarts, so
// warn loudly instead of silently changing behaviour.
let IP_SALT = process.env.IP_SALT;
if (!IP_SALT) {
  IP_SALT = crypto.randomBytes(16).toString('hex');
  console.warn(
    '[config] IP_SALT is not set — generated a temporary one. Unique-visitor counts\n' +
    '         will reset on restart. Set IP_SALT in .env for stable numbers.'
  );
}

// Codes that must never be handed out as short codes, because they would
// shadow a real route on this server.
const RESERVED_CODES = new Set([
  'api', 'app', 'assets', 'favicon.ico', 'robots.txt', 'health',
  'dashboard', 'login', 'logout', 'admin', 'static', 'public',
]);

module.exports = {
  PORT,
  BASE_URL,
  DB_PATH,
  TURSO_DATABASE_URL,
  TURSO_AUTH_TOKEN,
  IP_SALT,
  RESERVED_CODES,
};
