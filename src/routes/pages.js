'use strict';

const express = require('express');

const db = require('../db');
const { BASE_URL } = require('../config');
const { channelLabel, channelColor } = require('../channels');
const { normalizeDestination } = require('../url');
const { validateSlug } = require('../shortcode');
const { buildReport } = require('../report');
const { requireAdmin } = require('../auth');

const router = express.Router();

const shortUrl = (code) => `${BASE_URL}/${code}`;

/** Shared view locals so templates never have to reach for config themselves. */
function baseLocals(extra = {}) {
  return {
    baseUrl: BASE_URL,
    channelLabel,
    channelColor,
    shortUrl,
    ...extra,
  };
}

/* ------------------------------- home ------------------------------- */

router.get('/', requireAdmin, async (req, res) => {
  const [groups, totals] = await Promise.all([db.listGroups(6), db.totals()]);
  res.render('home', baseLocals({
    title: 'Create a tracking link',
    groups,
    totals,
    error: null,
    form: {},
  }));
});

/* --------------------------- create links --------------------------- */

router.post('/app/links', requireAdmin, async (req, res) => {
  const { destination: rawDestination, title, custom_slug: rawSlug } = req.body;

  const renderError = async (error, form) => {
    const [groups, totals] = await Promise.all([db.listGroups(6), db.totals()]);
    res.status(400).render('home', baseLocals({
      title: 'Create a tracking link',
      groups,
      totals,
      error,
      form,
    }));
  };

  const form = { destination: rawDestination, title, custom_slug: rawSlug };

  const parsed = normalizeDestination(rawDestination);
  if (!parsed.ok) return renderError(parsed.error, form);

  let customSlug = null;
  if (rawSlug && String(rawSlug).trim()) {
    const slug = validateSlug(rawSlug);
    if (!slug.ok) return renderError(slug.error, form);
    if (await db.findLinkByCode(slug.slug)) {
      return renderError(`The custom link "${slug.slug}" is already taken.`, form);
    }
    customSlug = slug.slug;
  }

  let group;
  try {
    // One link per destination. It detects the platform itself; `?s=<channel>`
    // is available on it for the cases where you want certainty instead.
    group = await db.createLinkGroup({
      destination: parsed.url,
      title: (title || '').trim() || parsed.host,
      channels: [],
      customSlug,
    });
  } catch (err) {
    console.error('[create]', err);
    return renderError('Could not create the link. Please try again.', form);
  }

  return res.redirect(`/app/l/${group.groupId}?created=1`);
});

/* ------------------------------ detail ------------------------------ */

router.get('/app/l/:groupId', requireAdmin, async (req, res, next) => {
  const { groupId } = req.params;
  const links = await db.findLinksByGroup(groupId);
  if (!links.length) return next();

  const generic = links.find((l) => !l.channel) || links[0];

  const [perLink, report] = await Promise.all([db.perLinkClicks(groupId), buildReport(groupId)]);

  res.render('group', baseLocals({
    title: generic.title || 'Tracking link',
    justCreated: req.query.created === '1',
    group: {
      id: groupId,
      destination: generic.destination,
      title: generic.title,
      createdAt: generic.created_at,
    },
    links: perLink,
    report,
  }));
});

router.post('/app/l/:groupId/delete', requireAdmin, async (req, res) => {
  await db.deleteGroup(req.params.groupId);
  res.redirect('/app/dashboard');
});

/* ----------------------------- dashboard ---------------------------- */

router.get('/app/dashboard', requireAdmin, async (req, res) => {
  const [groups, totals, report] = await Promise.all([db.listGroups(200), db.totals(), buildReport(null)]);
  res.render('dashboard', baseLocals({
    title: 'Dashboard',
    groups,
    totals,
    report,
  }));
});

module.exports = router;
