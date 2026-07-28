'use strict';

const db = require('./db');
const { channelLabel, channelColor } = require('./channels');

/** Fill gaps so the timeline shows quiet days as zero instead of skipping them. */
function fillDays(rows, days) {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() - (days - 1));

  for (let i = 0; i < days; i += 1) {
    const day = cursor.toISOString().slice(0, 10);
    const row = byDay.get(day);
    out.push({ day, clicks: row?.clicks || 0, visitors: row?.visitors || 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * Everything the analytics view needs for one tracked URL, or for the whole
 * account when groupId is null.
 *
 * All the independent lookups run concurrently rather than one after another —
 * over a network-hosted database each round trip has real latency, and none of
 * these queries depend on each other's results.
 */
async function buildReport(groupId = null, { days = 30 } = {}) {
  const [
    sourceRows,
    dailyRows,
    devices,
    browsers,
    operatingSystems,
    referrers,
    methods,
    confidence,
    countries,
    recent,
  ] = await Promise.all([
    db.sourceBreakdown(groupId),
    db.dailyClicks(groupId, days),
    db.dimension('device_type', groupId),
    db.dimension('browser', groupId),
    db.dimension('os', groupId),
    db.dimension('referrer_domain', groupId),
    db.dimension('source_method', groupId),
    db.dimension('confidence', groupId),
    db.dimension('country', groupId),
    db.recentClicks({ groupId, limit: 40 }),
  ]);

  const sources = sourceRows.map((row) => ({
    ...row,
    label: channelLabel(row.source),
    color: channelColor(row.source),
    // Share of this row that came from a tagged link (exact) versus one that was
    // detected from a referrer or in-app browser (reliable, but still inferred).
    exactShare: row.clicks ? Math.round((row.exact / row.clicks) * 100) : 0,
    reliableShare: row.clicks ? Math.round((row.reliable / row.clicks) * 100) : 0,
  }));

  const totalClicks = sources.reduce((sum, s) => sum + s.clicks, 0);
  for (const s of sources) {
    s.share = totalClicks ? Math.round((s.clicks / totalClicks) * 100) : 0;
  }

  const timeline = fillDays(dailyRows, days);

  return {
    sources,
    totalClicks,
    timeline,
    peakDay: timeline.reduce((max, d) => Math.max(max, d.clicks), 0),
    devices,
    browsers,
    operatingSystems,
    referrers,
    methods,
    confidence,
    countries,
    recent,
  };
}

module.exports = { buildReport, fillDays };
