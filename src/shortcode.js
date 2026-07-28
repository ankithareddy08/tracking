'use strict';

const crypto = require('crypto');
const { RESERVED_CODES } = require('./config');

// No look-alike characters (0/O, 1/l/I) — these codes get read aloud and
// retyped off phone screens.
const ALPHABET = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 7;

function randomCode(length = CODE_LENGTH) {
  // Rejection-free approach: crypto.randomInt gives an unbiased index, unlike
  // `byte % alphabet.length` which skews toward the first few characters.
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return out;
}

const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/;

/**
 * Validate a user-supplied custom slug.
 * @returns {{ok: true, slug: string} | {ok: false, error: string}}
 */
function validateSlug(raw) {
  const slug = String(raw || '').trim();
  if (!slug) return { ok: false, error: 'Custom link cannot be empty.' };
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      error: 'Custom link must be 2-64 characters: letters, numbers, hyphens and underscores only.',
    };
  }
  if (RESERVED_CODES.has(slug.toLowerCase())) {
    return { ok: false, error: `"${slug}" is reserved by the tracker. Pick another.` };
  }
  return { ok: true, slug };
}

function isReserved(code) {
  return RESERVED_CODES.has(String(code).toLowerCase());
}

function slugify(raw, maxLength) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, ''); // A mid-word truncation can leave a trailing dash.
}

/**
 * Derive a readable short-code hint from a destination URL, so a link to
 * flashbackai.xyz/welcome becomes /flashbackai-welcome rather than a random
 * string — the brand name and the page are both recognisable at a glance.
 *
 * Uses the site name alone when there is no path (a bare homepage link), and
 * returns null when nothing usable comes out, leaving the caller to fall back
 * to a fully random code.
 *
 * @param {string} destination A URL already validated by normalizeDestination.
 * @returns {?string}
 */
function deriveSlugHint(destination) {
  let url;
  try {
    url = new URL(destination);
  } catch {
    return null;
  }

  let lastSegment = url.pathname.split('/').filter(Boolean).pop();
  if (lastSegment) {
    // Decode %20 etc. before slugifying — otherwise the digits inside an
    // encoded byte (the "20" in "%20") leak into the slug as literal text.
    try {
      lastSegment = decodeURIComponent(lastSegment);
    } catch {
      /* malformed escape sequence — fall through with the raw segment */
    }
    // Drop a file extension so /welcome.html reads as "welcome".
    lastSegment = lastSegment.replace(/\.(html?|php|aspx?|jsp)$/i, '');
  }

  const site = slugify(url.hostname.replace(/^www\./, '').split('.')[0], 20);
  const page = slugify(lastSegment, 24);

  const slug = [site, page].filter(Boolean).join('-').slice(0, 40).replace(/-+$/, '');

  if (slug.length < 2 || isReserved(slug)) return null;
  return slug;
}

module.exports = { randomCode, validateSlug, isReserved, deriveSlugHint, CODE_LENGTH };
