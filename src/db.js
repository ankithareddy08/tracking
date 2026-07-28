'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

const { DB_PATH, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, IP_SALT } = require('./config');
const { randomCode, isReserved, deriveSlugHint } = require('./shortcode');

// Same client, two modes: a local file when TURSO_DATABASE_URL is unset (local
// dev, or any host with real persistent disk), a hosted libSQL database when it
// is set (required on Vercel, whose functions cannot write to local disk). Both
// speak the same SQL dialect, so nothing else in this file needs to know which
// mode it is running in.
let client;
if (TURSO_DATABASE_URL) {
  client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });
} else {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  client = createClient({ url: `file:${DB_PATH}` });
}

/** Additive migration: adds a column only if an existing database lacks it. */
async function addColumnIfMissing(table, column, definition) {
  const { rows } = await client.execute(`PRAGMA table_info(${table})`);
  if (!rows.some((c) => c.name === column)) {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Schema setup, run once per cold start and cached. Every exported function
 * awaits this before its own query, so a fresh serverless instance always has
 * the schema ready without needing a separate deploy-time migration step.
 */
const ready = (async () => {
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS links (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        code           TEXT    NOT NULL UNIQUE,
        destination    TEXT    NOT NULL,
        title          TEXT,
        channel        TEXT,
        group_id       TEXT    NOT NULL,
        created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
      )`,
      'CREATE INDEX IF NOT EXISTS idx_links_group   ON links (group_id)',
      'CREATE INDEX IF NOT EXISTS idx_links_created ON links (created_at DESC)',
      `CREATE TABLE IF NOT EXISTS clicks (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        link_id         INTEGER NOT NULL REFERENCES links (id) ON DELETE CASCADE,
        group_id        TEXT    NOT NULL,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        source          TEXT    NOT NULL,
        source_method   TEXT    NOT NULL,
        referrer        TEXT,
        referrer_domain TEXT,
        user_agent      TEXT,
        device_type     TEXT,
        browser         TEXT,
        os              TEXT,
        visitor_hash    TEXT,
        country         TEXT,
        language        TEXT,
        is_bot          INTEGER NOT NULL DEFAULT 0
      )`,
      'CREATE INDEX IF NOT EXISTS idx_clicks_link    ON clicks (link_id, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_clicks_group   ON clicks (group_id, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_clicks_created ON clicks (created_at DESC)',
    ],
    'write'
  );

  await addColumnIfMissing('clicks', 'confidence', "TEXT NOT NULL DEFAULT 'none'");
  await addColumnIfMissing('clicks', 'sec_fetch_site', 'TEXT');
  await addColumnIfMissing('clicks', 'client_referrer', 'TEXT');
  await addColumnIfMissing('clicks', 'viewport', 'TEXT');
  await addColumnIfMissing('clicks', 'refined', 'INTEGER NOT NULL DEFAULT 0');

  // PRAGMA foreign_keys defaults off per-connection in SQLite; each new
  // connection this client opens needs it set explicitly for the clicks
  // cascade-on-delete to actually fire.
  await client.execute('PRAGMA foreign_keys = ON');
})();

/** Every exported function funnels through this so schema setup always wins the race. */
async function query(sql, args) {
  await ready;
  const result = await client.execute(args === undefined ? sql : { sql, args });
  return result;
}

/* ------------------------------------------------------------------ *
 * Privacy helpers
 * ------------------------------------------------------------------ */

/**
 * Identify a returning visitor without retaining anything that points back at a
 * person. IP + User-Agent are hashed together with a server-side salt: good
 * enough to count uniques, one-way so the database holds no personal data.
 */
function visitorHash(ip, userAgent) {
  return crypto
    .createHmac('sha256', IP_SALT)
    .update(`${ip || ''}|${userAgent || ''}`)
    .digest('hex')
    .slice(0, 32);
}

/* ------------------------------------------------------------------ *
 * Links
 * ------------------------------------------------------------------ */

async function findLinkByCode(code) {
  const { rows } = await query('SELECT * FROM links WHERE code = @code', { code });
  return rows[0];
}

async function findLinkById(id) {
  const { rows } = await query('SELECT * FROM links WHERE id = @id', { id });
  return rows[0];
}

async function findLinksByGroup(groupId) {
  const { rows } = await query(
    'SELECT * FROM links WHERE group_id = @group_id ORDER BY (channel IS NOT NULL), channel',
    { group_id: groupId }
  );
  return rows;
}

async function codeExists(code) {
  return Boolean(await findLinkByCode(code));
}

/** Draw a random code that is neither reserved nor already taken. */
async function allocateCode() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    // Widen the code after repeated collisions rather than looping forever.
    const code = randomCode(attempt < 8 ? 7 : 9);
    if (!isReserved(code) && !(await codeExists(code))) return code;
  }
  throw new Error('Could not allocate a unique short code.');
}

/**
 * Prefer a code that reads like the destination (e.g. "/welcome" for
 * flashbackai.xyz/welcome) over a random one. Tries the plain hint, then a
 * few numbered variants, and only falls back to a fully random code once
 * those are exhausted — a link with a distinctive path rarely collides.
 */
async function allocateCodeFor(destination) {
  const hint = deriveSlugHint(destination);
  if (hint) {
    if (!(await codeExists(hint))) return hint;
    for (let n = 2; n <= 9; n += 1) {
      const candidate = `${hint}-${n}`;
      if (!(await codeExists(candidate))) return candidate;
    }
  }
  return allocateCode();
}

/**
 * Create a tracking link group: one auto-detect link plus one link per channel.
 *
 * Code allocation happens first (sequential lookups — the tiny residual race
 * window on a random 7+ character code is caught by the UNIQUE constraint
 * below, which fails loudly rather than corrupting anything), then every row
 * is written in a single atomic batch.
 *
 * @param {object}   input
 * @param {string}   input.destination Validated http(s) URL.
 * @param {?string}  input.title       Optional human label.
 * @param {string[]} input.channels    Channel ids to mint dedicated links for.
 * @param {?string}  input.customSlug  Preferred code for the auto-detect link.
 * @returns {Promise<{groupId: string, links: object[]}>}
 */
async function createLinkGroup({ destination, title, channels, customSlug }) {
  await ready;

  const groupId = crypto.randomUUID();
  const rows = [
    { code: customSlug || (await allocateCodeFor(destination)), channel: null },
    ...(await Promise.all(channels.map(async (channel) => ({ code: await allocateCode(), channel })))),
  ];

  await client.batch(
    rows.map((row) => ({
      sql: `INSERT INTO links (code, destination, title, channel, group_id)
            VALUES (@code, @destination, @title, @channel, @group_id)`,
      args: {
        code: row.code,
        destination,
        title: title || null,
        channel: row.channel,
        group_id: groupId,
      },
    })),
    'write'
  );

  return { groupId, links: await findLinksByGroup(groupId) };
}

/* ------------------------------------------------------------------ *
 * Clicks
 * ------------------------------------------------------------------ */

/** @returns {Promise<number>} the new click id, needed to refine it from the browser. */
async function recordClick(click) {
  const result = await query(
    `INSERT INTO clicks (
       link_id, group_id, source, source_method, confidence, referrer, referrer_domain,
       user_agent, device_type, browser, os, visitor_hash, country, language,
       sec_fetch_site, is_bot
     ) VALUES (
       @link_id, @group_id, @source, @source_method, @confidence, @referrer, @referrer_domain,
       @user_agent, @device_type, @browser, @os, @visitor_hash, @country, @language,
       @sec_fetch_site, @is_bot
     )`,
    click
  );
  return Number(result.lastInsertRowid);
}

/**
 * Which apps' preview crawlers have fetched this link. Feeds
 * attributeFromPreviews() so a signal-less click can still be traced back to
 * the chat app it was most likely shared in.
 *
 * @returns {Promise<string[]>} distinct channel ids
 */
async function previewAppsForLink(linkId) {
  const { rows } = await query(
    `SELECT DISTINCT source
       FROM clicks
      WHERE link_id = @link_id
        AND is_bot = 1
        AND source_method = 'crawler'`,
    { link_id: linkId }
  );
  return rows.map((r) => r.source);
}

// `refined = 0` makes this idempotent: a replayed or duplicated beacon cannot
// rewrite an already-refined row, and the WHERE guard means a probe can only
// ever upgrade a visit we ourselves classified as inconclusive.
async function refineClick(data) {
  const result = await query(
    `UPDATE clicks
        SET source          = COALESCE(@source, source),
            source_method   = COALESCE(@source_method, source_method),
            confidence      = COALESCE(@confidence, confidence),
            client_referrer = @client_referrer,
            viewport        = @viewport,
            refined         = 1
      WHERE id = @id
        AND refined = 0
        AND confidence IN ('none', 'low')`,
    data
  );
  return result.rowsAffected > 0;
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

// Bots are stored but excluded from every headline number — a link pasted into a
// WhatsApp group generates a preview fetch that is not a visitor.
const HUMAN = 'is_bot = 0';

async function listGroups(limit = 100) {
  const { rows } = await query(
    `SELECT
       l.group_id,
       MIN(l.created_at)                                  AS created_at,
       MAX(l.destination)                                 AS destination,
       MAX(l.title)                                       AS title,
       (SELECT code FROM links WHERE group_id = l.group_id AND channel IS NULL) AS primary_code,
       COUNT(DISTINCT l.id)                               AS link_count,
       (SELECT COUNT(*) FROM clicks c
          WHERE c.group_id = l.group_id AND ${HUMAN})      AS clicks,
       (SELECT COUNT(DISTINCT visitor_hash) FROM clicks c
          WHERE c.group_id = l.group_id AND ${HUMAN})      AS visitors,
       (SELECT MAX(created_at) FROM clicks c
          WHERE c.group_id = l.group_id AND ${HUMAN})      AS last_click
     FROM links l
     GROUP BY l.group_id
     ORDER BY created_at DESC
     LIMIT @limit`,
    { limit }
  );
  return rows;
}

async function totals() {
  const { rows } = await query(`
    SELECT
      (SELECT COUNT(DISTINCT group_id) FROM links)                      AS links,
      (SELECT COUNT(*) FROM clicks WHERE ${HUMAN})                     AS clicks,
      (SELECT COUNT(DISTINCT visitor_hash) FROM clicks WHERE ${HUMAN}) AS visitors,
      (SELECT COUNT(*) FROM clicks WHERE is_bot = 1)                   AS bots
  `);
  return rows[0];
}

/** Clicks per source. Pass a groupId to scope it to one tracked URL. */
async function sourceBreakdown(groupId = null) {
  const { rows } = await query(
    `SELECT
       source,
       COUNT(*)                     AS clicks,
       COUNT(DISTINCT visitor_hash) AS visitors,
       SUM(CASE WHEN confidence = 'exact' THEN 1 ELSE 0 END)            AS exact,
       SUM(CASE WHEN confidence IN ('exact', 'high') THEN 1 ELSE 0 END) AS reliable,
       SUM(CASE WHEN source_method = 'preview-match' THEN 1 ELSE 0 END) AS likely
     FROM clicks
     WHERE ${HUMAN} AND (@group_id IS NULL OR group_id = @group_id)
     GROUP BY source
     ORDER BY clicks DESC`,
    { group_id: groupId }
  );
  return rows;
}

/**
 * Group human clicks by one of a fixed set of columns.
 * The column name is whitelisted rather than interpolated blindly.
 */
const DIMENSION_COLUMNS = {
  device_type: 'device_type',
  browser: 'browser',
  os: 'os',
  country: 'country',
  referrer_domain: 'referrer_domain',
  source_method: 'source_method',
  confidence: 'confidence',
};

async function dimension(name, groupId = null, limit = 12) {
  const column = DIMENSION_COLUMNS[name];
  if (!column) throw new Error(`Unsupported dimension: ${name}`);

  const { rows } = await query(
    `SELECT COALESCE(NULLIF(${column}, ''), 'Unknown') AS value,
            COUNT(*) AS clicks
     FROM clicks
     WHERE ${HUMAN} AND (@group_id IS NULL OR group_id = @group_id)
     GROUP BY value
     ORDER BY clicks DESC
     LIMIT @limit`,
    { group_id: groupId, limit }
  );
  return rows;
}

async function dailyClicks(groupId = null, days = 30) {
  const { rows } = await query(
    `SELECT DATE(created_at) AS day,
            COUNT(*)         AS clicks,
            COUNT(DISTINCT visitor_hash) AS visitors
     FROM clicks
     WHERE ${HUMAN}
       AND created_at >= DATE('now', @since)
       AND (@group_id IS NULL OR group_id = @group_id)
     GROUP BY day
     ORDER BY day`,
    { group_id: groupId, since: `-${days} days` }
  );
  return rows;
}

async function recentClicks({ groupId = null, limit = 50, includeBots = false } = {}) {
  const { rows } = await query(
    `SELECT c.*, l.code, l.channel AS link_channel
     FROM clicks c
     JOIN links l ON l.id = c.link_id
     WHERE (@group_id IS NULL OR c.group_id = @group_id)
       AND (@include_bots = 1 OR c.is_bot = 0)
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT @limit`,
    { group_id: groupId, limit, include_bots: includeBots ? 1 : 0 }
  );
  return rows;
}

async function perLinkClicks(groupId) {
  const { rows } = await query(
    `SELECT l.id, l.code, l.channel,
            COUNT(c.id) AS clicks,
            COUNT(DISTINCT c.visitor_hash) AS visitors
     FROM links l
     LEFT JOIN clicks c ON c.link_id = l.id AND c.is_bot = 0
     WHERE l.group_id = @group_id
     GROUP BY l.id
     ORDER BY (l.channel IS NOT NULL), clicks DESC`,
    { group_id: groupId }
  );
  return rows;
}

/** Clicks cascade via the foreign key. */
async function deleteGroup(groupId) {
  const result = await query('DELETE FROM links WHERE group_id = @group_id', { group_id: groupId });
  return result.rowsAffected;
}

module.exports = {
  visitorHash,
  createLinkGroup,
  findLinkByCode,
  findLinkById,
  findLinksByGroup,
  recordClick,
  refineClick,
  previewAppsForLink,
  listGroups,
  totals,
  sourceBreakdown,
  dimension,
  dailyClicks,
  recentClicks,
  perLinkClicks,
  deleteGroup,
};
