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

/**
 * Derive a readable short-code hint from a destination URL, so a link to
 * flashbackai.xyz/welcome defaults to /welcome instead of a random string.
 * Falls back to the hostname's main label when the path is empty (a bare
 * homepage link), and returns null when neither yields anything usable — the
 * caller falls back to a fully random code in that case.
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
  }
  const hostLabel = url.hostname.replace(/^www\./, '').split('.')[0];
  const raw = lastSegment || hostLabel || '';

  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);

  if (slug.length < 2 || isReserved(slug)) return null;
  return slug;
}

module.exports = { randomCode, validateSlug, isReserved, deriveSlugHint, CODE_LENGTH };
