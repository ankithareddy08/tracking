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

module.exports = { randomCode, validateSlug, isReserved, CODE_LENGTH };
