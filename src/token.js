'use strict';

const crypto = require('crypto');
const { IP_SALT } = require('./config');

/**
 * Signs a click id so the probe endpoint will only accept refinements for rows
 * this server actually created. Without it, anyone could POST arbitrary click
 * ids and rewrite the attribution on someone else's visits.
 */
function probeToken(clickId) {
  return crypto
    .createHmac('sha256', IP_SALT)
    .update(`probe:${clickId}`)
    .digest('base64url')
    .slice(0, 22);
}

function verifyProbeToken(clickId, token) {
  const expected = probeToken(clickId);
  if (typeof token !== 'string' || token.length !== expected.length) return false;
  // Constant-time compare so a wrong token cannot be brute-forced byte by byte.
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

module.exports = { probeToken, verifyProbeToken };
