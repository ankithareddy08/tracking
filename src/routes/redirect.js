'use strict';

const express = require('express');
const { UAParser } = require('ua-parser-js');

const db = require('../db');
const {
  detectSource,
  isBot,
  isChannel,
  crawlerApp,
  attributeFromPreviews,
} = require('../channels');
const { withUtmTags } = require('../url');
const { probeToken } = require('../token');

const router = express.Router();

/** First hop in X-Forwarded-For is the client; behind a proxy req.ip may be the proxy. */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || '';
}

/** Country only if a CDN in front of us resolved it; we do no IP geolocation. */
function countryOf(req) {
  const header =
    req.headers['cf-ipcountry'] ||
    req.headers['x-vercel-ip-country'] ||
    req.headers['x-geo-country'] ||
    req.headers['fastly-client-country'];
  if (!header || header === 'XX') return null;
  return String(header).toUpperCase().slice(0, 2);
}

function primaryLanguage(req) {
  const header = req.headers['accept-language'];
  if (!header) return null;
  return String(header).split(',')[0].trim().slice(0, 12) || null;
}

/**
 * GET /:code
 *
 * One link serves every platform. The source is worked out from the request,
 * and only when that comes up empty do we ask the browser for a second opinion.
 *
 *   confident  -> 302 straight through, nothing rendered, no added latency
 *   unsure     -> tiny HTML page that fires a beacon and immediately replaces
 *                 itself with the destination
 *
 * The click row is written before either path, so a visitor with JavaScript
 * disabled still counts — they just stay in the lower-confidence bucket.
 */
router.get('/:code', async (req, res, next) => {
  const { code } = req.params;

  const link = await db.findLinkByCode(code);
  if (!link) return next(); // Falls through to the 404 handler.

  const userAgent = req.get('user-agent') || '';
  const referrer = req.get('referer') || req.get('referrer') || null;
  const secFetchSite = req.get('sec-fetch-site') || null;

  // ?s=whatsapp lets the single link be tagged by hand when you want certainty;
  // a link minted for a channel keeps its own value.
  const queryTag = typeof req.query.s === 'string' ? req.query.s.toLowerCase() : null;
  const taggedChannel = link.channel || (queryTag && isChannel(queryTag) ? queryTag : null);

  let detected = detectSource({ taggedChannel, referrer, userAgent, secFetchSite });
  const bot = isBot(userAgent);

  if (bot) {
    // Record which app's crawler this is. The hit stays excluded from every
    // headline number, but it is the only evidence that this link was shared in
    // that app at all — attributeFromPreviews() reads it back below.
    const app = crawlerApp(userAgent);
    if (app) detected = { ...detected, source: app, method: 'crawler', confidence: 'exact' };
  } else if (!detected.conclusive) {
    // Nothing in the request identifies the source, which is the normal case for
    // WhatsApp/Telegram desktop. Fall back to "who previewed this link".
    try {
      const fromPreview = attributeFromPreviews(await db.previewAppsForLink(link.id));
      if (fromPreview) detected = { ...detected, ...fromPreview };
    } catch (err) {
      console.error(`[redirect] preview lookup failed for ${code}:`, err.message);
    }
  }

  let clickId = null;
  try {
    const ua = new UAParser(userAgent).getResult();
    clickId = await db.recordClick({
      link_id: link.id,
      group_id: link.group_id,
      source: detected.source,
      source_method: detected.method,
      confidence: detected.confidence,
      referrer: referrer ? referrer.slice(0, 500) : null,
      referrer_domain: detected.referrerDomain,
      user_agent: userAgent.slice(0, 400) || null,
      device_type: ua.device.type || 'desktop',
      browser: ua.browser.name || null,
      os: ua.os.name || null,
      visitor_hash: db.visitorHash(clientIp(req), userAgent),
      country: countryOf(req),
      language: primaryLanguage(req),
      sec_fetch_site: secFetchSite,
      is_bot: bot ? 1 : 0,
    });
  } catch (err) {
    console.error(`[redirect] failed to record click on ${code}:`, err.message);
  }

  const destination = withUtmTags(
    link.destination,
    taggedChannel || (detected.source !== 'direct' && detected.source !== 'other' ? detected.source : null)
  );

  // 302, never 301: a permanent redirect gets cached by the browser and every
  // click after the first would bypass this server entirely, silently.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Referrer-Policy', 'unsafe-url'); // Pass our URL on so the destination can attribute too.

  // Crawlers get the plain redirect: they will not run the probe, and rendering
  // HTML for them only risks a preview card showing our interstitial.
  if (detected.conclusive || bot || clickId === null) {
    return res.redirect(302, destination);
  }

  return res.render('interstitial', {
    destination,
    clickId,
    token: probeToken(clickId),
  });
});

module.exports = router;
