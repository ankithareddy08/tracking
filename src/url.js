'use strict';

/**
 * Destination URL validation.
 *
 * A link shortener is an open redirect by design, so the guard rails here are
 * about what we refuse to redirect *to*: only http and https ever get through.
 * Schemes like javascript:, data: and vbscript: would turn a tracking link into
 * a way to run script in a visitor's browser under our domain's reputation.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * @returns {{ok: true, url: string, host: string} | {ok: false, error: string}}
 */
function normalizeDestination(raw) {
  let input = String(raw || '').trim();
  if (!input) return { ok: false, error: 'Paste the link you want to track.' };

  // Be forgiving about a missing scheme — people paste "example.com/page".
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)) {
    input = `https://${input}`;
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: 'That does not look like a valid URL.' };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, error: 'Only http:// and https:// links can be tracked.' };
  }

  if (!url.hostname || !url.hostname.includes('.')) {
    return { ok: false, error: 'The URL needs a valid domain name.' };
  }

  return { ok: true, url: url.toString(), host: url.hostname.replace(/^www\./, '') };
}

/**
 * Append our channel tag to the destination as UTM parameters.
 *
 * This is what makes the tracker cooperate with the analytics the destination
 * already runs: the visit shows up in their Google Analytics under the same
 * source we recorded, instead of as unattributed referral traffic from us.
 * Existing utm_* values on the destination are left untouched.
 */
function withUtmTags(destination, channel) {
  if (!channel) return destination;
  try {
    const url = new URL(destination);
    if (!url.searchParams.has('utm_source')) url.searchParams.set('utm_source', channel);
    if (!url.searchParams.has('utm_medium')) {
      const medium = ['whatsapp', 'telegram', 'sms', 'wechat'].includes(channel)
        ? 'chat'
        : ['google', 'bing'].includes(channel)
          ? 'organic'
          : channel === 'email'
            ? 'email'
            : channel === 'qr'
              ? 'qr'
              : 'social';
      url.searchParams.set('utm_medium', medium);
    }
    return url.toString();
  } catch {
    return destination;
  }
}

module.exports = { normalizeDestination, withUtmTags };
