'use strict';

/**
 * JSON API — same capabilities as the UI, for scripting or a future frontend.
 *
 * Everything below /probe requires ADMIN_PASSWORD (see ../auth.js) once it is
 * set. /probe stays open: it is called by an anonymous visitor's browser via
 * sendBeacon and must work without credentials.
 */

const express = require('express');

const db = require('../db');
const { BASE_URL } = require('../config');
const { CHANNELS, isChannel, refineFromClient } = require('../channels');
const { normalizeDestination } = require('../url');
const { validateSlug } = require('../shortcode');
const { buildReport } = require('../report');
const { verifyProbeToken } = require('../token');
const { requireAdmin } = require('../auth');

const router = express.Router();

/**
 * POST /api/probe
 *
 * Second-pass attribution from the interstitial page. Fired by sendBeacon, so it
 * must stay cheap and must never make the client wait: it always answers 204,
 * even when the refinement is rejected.
 */
router.post('/probe', async (req, res) => {
  const { id, token, referrer, userAgent, webview, viewport } = req.body || {};

  const clickId = Number(id);
  if (!Number.isInteger(clickId) || !verifyProbeToken(clickId, token)) {
    return res.status(204).end();
  }

  const refined = refineFromClient({ referrer, userAgent, webview });

  try {
    await db.refineClick({
      id: clickId,
      source: refined ? refined.source : null,
      source_method: refined ? refined.method : null,
      confidence: refined ? refined.confidence : null,
      client_referrer: typeof referrer === 'string' ? referrer.slice(0, 500) : null,
      viewport: typeof viewport === 'string' ? viewport.slice(0, 64) : null,
    });
  } catch (err) {
    console.error('[api/probe]', err.message);
  }

  return res.status(204).end();
});

// Every route declared after this line requires ADMIN_PASSWORD; /probe above
// stays public.
router.use(requireAdmin);

const present = (link) => ({
  code: link.code,
  url: `${BASE_URL}/${link.code}`,
  channel: link.channel,
  destination: link.destination,
});

router.get('/channels', (req, res) => {
  res.json({ channels: CHANNELS });
});

router.post('/links', async (req, res) => {
  const { destination, title, channels: rawChannels, customSlug } = req.body || {};

  const parsed = normalizeDestination(destination);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const channels = [...new Set([].concat(rawChannels || []).filter(isChannel))];

  let slug = null;
  if (customSlug) {
    const check = validateSlug(customSlug);
    if (!check.ok) return res.status(400).json({ error: check.error });
    if (await db.findLinkByCode(check.slug)) {
      return res.status(409).json({ error: `Custom link "${check.slug}" is already taken.` });
    }
    slug = check.slug;
  }

  try {
    const group = await db.createLinkGroup({
      destination: parsed.url,
      title: (title || '').trim() || parsed.host,
      channels,
      customSlug: slug,
    });
    return res.status(201).json({
      groupId: group.groupId,
      destination: parsed.url,
      links: group.links.map(present),
      statsUrl: `${BASE_URL}/api/links/${group.groupId}`,
    });
  } catch (err) {
    console.error('[api/links]', err);
    return res.status(500).json({ error: 'Could not create the link.' });
  }
});

router.get('/links', async (req, res) => {
  const [totals, groups] = await Promise.all([db.totals(), db.listGroups(200)]);
  res.json({ totals, groups });
});

router.get('/links/:groupId', async (req, res) => {
  const links = await db.findLinksByGroup(req.params.groupId);
  if (!links.length) return res.status(404).json({ error: 'Not found.' });

  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);

  const [perLink, report] = await Promise.all([
    db.perLinkClicks(req.params.groupId),
    buildReport(req.params.groupId, { days }),
  ]);

  return res.json({
    groupId: req.params.groupId,
    destination: links[0].destination,
    title: links[0].title,
    links: perLink.map((l) => ({
      ...present(l),
      clicks: l.clicks,
      visitors: l.visitors,
    })),
    report,
  });
});

router.delete('/links/:groupId', async (req, res) => {
  const removed = await db.deleteGroup(req.params.groupId);
  if (!removed) return res.status(404).json({ error: 'Not found.' });
  return res.status(204).end();
});

module.exports = router;
