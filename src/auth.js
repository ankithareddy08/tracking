'use strict';

const crypto = require('crypto');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;

if (!ADMIN_PASSWORD) {
  console.warn(
    '[auth] ADMIN_PASSWORD is not set — the dashboard and link-management API are\n' +
    '       running WITHOUT a password. Fine on localhost, not fine on a public host.\n' +
    '       Set ADMIN_PASSWORD before deploying.'
  );
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  // timingSafeEqual throws on length mismatch rather than just returning false,
  // so pad to equal length first — an early return here would leak the length
  // of the real password through response timing.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Gates the dashboard and link-management endpoints behind a single shared
 * password (HTTP Basic Auth; any username is accepted). Deliberately not
 * applied to the redirect route or the probe endpoint — those are hit by
 * anonymous visitors and must keep working without credentials.
 *
 * A no-op when ADMIN_PASSWORD is unset, so local development is unaffected.
 */
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return next();

  const header = req.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    const [, password = ''] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (safeEqual(password, ADMIN_PASSWORD)) return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Tracker", charset="UTF-8"');
  return res.status(401).send('Authentication required.');
}

module.exports = { requireAdmin };
