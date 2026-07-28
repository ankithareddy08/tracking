'use strict';

/**
 * Channel catalogue and source attribution.
 *
 * Attribution runs in priority order, best evidence first:
 *
 *   1. tagged     - the link itself was created for a channel, or carries ?s=<channel>.
 *                   Exact, because we control it at share time.
 *   2. referrer   - the Referer header maps to a known host.
 *                   Reliable on the open web, absent inside most mobile apps.
 *   3. user-agent - the request came from an identifiable in-app browser
 *                   (Instagram, Facebook, TikTok... all brand their UA string).
 *   4. direct     - nothing to go on.
 *
 * The honest limitation worth knowing: WhatsApp, Signal and Telegram strip the
 * referrer and use the plain system browser, so a click from a WhatsApp chat is
 * indistinguishable from someone typing the URL. Only a tagged link catches it.
 * That is why the app hands out one link per channel by default.
 */

const CHANNELS = [
  { id: 'whatsapp',  label: 'WhatsApp',    color: '#25d366' },
  { id: 'instagram', label: 'Instagram',   color: '#e1306c' },
  { id: 'facebook',  label: 'Facebook',    color: '#1877f2' },
  { id: 'google',    label: 'Google',      color: '#ea4335' },
  { id: 'youtube',   label: 'YouTube',     color: '#ff0000' },
  { id: 'twitter',   label: 'X / Twitter', color: '#1d9bf0' },
  { id: 'linkedin',  label: 'LinkedIn',    color: '#0a66c2' },
  { id: 'telegram',  label: 'Telegram',    color: '#229ed9' },
  { id: 'tiktok',    label: 'TikTok',      color: '#ff0050' },
  { id: 'snapchat',  label: 'Snapchat',    color: '#c8b900' },
  { id: 'reddit',    label: 'Reddit',      color: '#ff4500' },
  { id: 'pinterest', label: 'Pinterest',   color: '#e60023' },
  { id: 'wechat',    label: 'WeChat',      color: '#07c160' },
  { id: 'email',     label: 'Email',       color: '#8b5cf6' },
  { id: 'sms',       label: 'SMS',         color: '#64748b' },
  { id: 'qr',        label: 'QR Code',     color: '#0f766e' },
  { id: 'bing',      label: 'Bing',        color: '#008373' },
  { id: 'other',     label: 'Other site',  color: '#94a3b8' },
  { id: 'direct',    label: 'Direct / Unknown', color: '#cbd5e1' },
];

const CHANNEL_BY_ID = new Map(CHANNELS.map((c) => [c.id, c]));

// Offered as checkboxes on the create form; the ones most people actually share to.
const SUGGESTED_CHANNELS = [
  'whatsapp', 'instagram', 'facebook', 'google',
  'youtube', 'twitter', 'linkedin', 'telegram', 'email', 'qr',
];

function isChannel(id) {
  return CHANNEL_BY_ID.has(id);
}

function channelLabel(id) {
  return CHANNEL_BY_ID.get(id)?.label || id || 'Direct / Unknown';
}

function channelColor(id) {
  return CHANNEL_BY_ID.get(id)?.color || '#94a3b8';
}

/* ------------------------------------------------------------------ *
 * Referrer host -> channel
 * ------------------------------------------------------------------ */

// Matched against the referrer hostname. First hit wins, so keep the more
// specific hosts above the broad ones.
const REFERRER_RULES = [
  [/(^|\.)l\.instagram\.com$/,                     'instagram'],
  [/(^|\.)instagram\.com$/,                        'instagram'],
  [/(^|\.)(l|lm|m|web|touch)\.facebook\.com$/,     'facebook'],
  [/(^|\.)facebook\.com$/,                         'facebook'],
  [/(^|\.)fb\.(me|watch)$/,                        'facebook'],
  [/(^|\.)messenger\.com$/,                        'facebook'],
  [/(^|\.)(api|web|chat)\.whatsapp\.com$/,         'whatsapp'],
  [/(^|\.)whatsapp\.com$/,                         'whatsapp'],
  [/(^|\.)wa\.me$/,                                'whatsapp'],
  [/(^|\.)t\.me$/,                                 'telegram'],
  [/(^|\.)telegram\.(org|me)$/,                    'telegram'],
  [/(^|\.)t\.co$/,                                 'twitter'],
  [/(^|\.)(twitter|x)\.com$/,                      'twitter'],
  [/(^|\.)lnkd\.in$/,                              'linkedin'],
  [/(^|\.)linkedin\.com$/,                         'linkedin'],
  [/(^|\.)(youtube\.com|youtu\.be)$/,              'youtube'],
  [/(^|\.)tiktok\.com$/,                           'tiktok'],
  [/(^|\.)snapchat\.com$/,                         'snapchat'],
  [/(^|\.)reddit\.com$/,                           'reddit'],
  [/(^|\.)redd\.it$/,                              'reddit'],
  [/(^|\.)pinterest\.[a-z.]+$/,                    'pinterest'],
  [/(^|\.)pin\.it$/,                               'pinterest'],
  [/(^|\.)google\.[a-z.]+$/,                       'google'],
  [/(^|\.)bing\.com$/,                             'bing'],
  [/(^|\.)mail\.(google|yahoo|proton|zoho)\.com$/, 'email'],
  [/(^|\.)outlook\.(com|live\.com|office\.com)$/,   'email'],
];

// Android and iOS hand us an app-scheme referrer instead of a hostname when the
// click comes straight out of a native app. This is the single most useful
// signal for mobile traffic, so it is checked before the hostname rules.
const APP_REFERRER_RULES = [
  [/com\.google\.android\.googlequicksearchbox|com\.google\.android\.gm\.lite/, 'google'],
  [/com\.google\.android\.gm$/,        'email'],
  [/com\.whatsapp/,                    'whatsapp'],
  [/com\.instagram\.android/,          'instagram'],
  [/com\.facebook\.(katana|orca|lite)/, 'facebook'],
  [/org\.telegram\.messenger/,         'telegram'],
  [/com\.twitter\.android|com\.x\.android/, 'twitter'],
  [/com\.linkedin\.android/,           'linkedin'],
  [/com\.zhiliaoapp\.musically|com\.ss\.android/, 'tiktok'],
  [/com\.snapchat\.android/,           'snapchat'],
  [/com\.reddit\.frontpage/,           'reddit'],
  [/com\.pinterest/,                   'pinterest'],
  [/com\.google\.android\.youtube/,    'youtube'],
  [/com\.tencent\.mm/,                 'wechat'],
  [/com\.microsoft\.office\.outlook/,  'email'],
  [/com\.android\.mms|com\.google\.android\.apps\.messaging/, 'sms'],
];

/* ------------------------------------------------------------------ *
 * In-app browser User-Agent -> channel
 * ------------------------------------------------------------------ */

// Social apps open links in an embedded webview and brand the UA string. When
// the referrer is missing this is the only thing left to go on.
const USER_AGENT_RULES = [
  [/Instagram/i,                            'instagram'],
  [/FBAN|FBAV|FB_IAB|FBIOS|FBDV|FBSN|FBSV/i, 'facebook'],
  [/Messenger(?:Lite|ForiOS)?/i,            'facebook'],
  [/TikTok|BytedanceWebview|musical_ly|trill_|Aweme/i, 'tiktok'],
  [/Snapchat/i,                             'snapchat'],
  [/LinkedInApp|LinkedIn\//i,               'linkedin'],
  [/Twitter(?:Android|ForiPhone)?/i,        'twitter'],
  [/MicroMessenger|WeChat/i,                'wechat'],
  [/Pinterest/i,                            'pinterest'],
  [/Telegram/i,                             'telegram'],
  [/RedditAndroid|Reddit\//i,               'reddit'],
  [/YouTube|YouTubeAndroid/i,               'youtube'],
  [/GSA\//i,                                'google'],  // Google app's in-app browser on iOS
  [/Line\//i,                               'other'],
  [/KAKAOTALK/i,                            'other'],
  [/Slack/i,                                'other'],
  [/DiscordAndroid|Discord\//i,             'other'],
];

/* ------------------------------------------------------------------ *
 * Bots and link-preview crawlers
 * ------------------------------------------------------------------ */

// Chat apps fetch a URL the moment it is pasted, to render the preview card.
// Those hits arrive before any human clicks and would otherwise inflate every
// count — note that `WhatsApp/2.x` is the *crawler*, never a real visitor.
const BOT_PATTERN = new RegExp([
  'bot', 'crawl', 'spider', 'slurp', 'archiver', 'monitor', 'preview', 'fetcher',
  'facebookexternalhit', 'WhatsApp/', 'TelegramBot', 'Twitterbot', 'Slackbot',
  'Slack-ImgProxy', 'Discordbot', 'LinkedInBot', 'SkypeUriPreview', 'vkShare',
  'redditbot', 'Applebot', 'Googlebot', 'bingbot', 'DuckDuckGo', 'YandexBot',
  'Embedly', 'Quora Link Preview', 'nuzzel', 'curl/', 'Wget/', 'python-requests',
  'axios/', 'node-fetch', 'Go-http-client', 'okhttp', 'Java/', 'HeadlessChrome',
  'PhantomJS', 'Lighthouse', 'GTmetrix', 'Pingdom', 'UptimeRobot',
].join('|'), 'i');

function isBot(userAgent) {
  if (!userAgent) return true; // A real browser always sends a User-Agent.
  return BOT_PATTERN.test(userAgent);
}

/* ------------------------------------------------------------------ *
 * Attribution
 * ------------------------------------------------------------------ */

function hostnameOf(referrer) {
  try {
    return new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function fromReferrer(referrer) {
  if (!referrer) return null;

  // android-app:// and similar schemes carry a package name, not a host.
  if (!/^https?:\/\//i.test(referrer)) {
    for (const [pattern, channel] of APP_REFERRER_RULES) {
      if (pattern.test(referrer)) return channel;
    }
    return null;
  }

  const host = hostnameOf(referrer);
  if (!host) return null;

  for (const [pattern, channel] of REFERRER_RULES) {
    if (pattern.test(host)) return channel;
  }
  return 'other';
}

function fromUserAgent(userAgent) {
  if (!userAgent) return null;
  for (const [pattern, channel] of USER_AGENT_RULES) {
    if (pattern.test(userAgent)) return channel;
  }
  return null;
}

/**
 * How much to trust a given attribution. Surfaced in the UI so an inferred
 * result is never displayed as though it were measured.
 */
const CONFIDENCE = {
  tagged: 'exact',
  referrer: 'high',
  'app-referrer': 'high',
  'user-agent': 'high',
  'client-referrer': 'high',
  'client-webview': 'medium',
  'sec-fetch': 'low',
  none: 'none',
};

/** Human-readable explanation of each method, for tooltips. */
const METHOD_LABELS = {
  tagged: 'Link was tagged with the channel',
  referrer: 'Referer header matched a known site',
  'app-referrer': 'Native app package sent as referrer',
  'user-agent': 'Recognised in-app browser',
  'client-referrer': 'Referrer read in the browser',
  'client-webview': 'In-app webview detected in the browser',
  'sec-fetch': 'Came from a website that hid its identity',
  none: 'No signal available',
};

/**
 * Resolve where a click came from, using only what the request itself carries.
 *
 * @param {object}  input
 * @param {?string} input.taggedChannel Channel baked into the link, or from ?s=.
 * @param {?string} input.referrer      Raw Referer header.
 * @param {?string} input.userAgent     Raw User-Agent header.
 * @param {?string} input.secFetchSite  Sec-Fetch-Site header, if the browser sent one.
 * @returns {{source, method, confidence, referrerDomain, conclusive}}
 *   `conclusive` tells the redirect handler whether it is worth asking the
 *   browser for more signals before giving up on this visit.
 */
function detectSource({ taggedChannel, referrer, userAgent, secFetchSite }) {
  const referrerDomain = referrer ? hostnameOf(referrer) : null;
  const finish = (source, method) => ({
    source,
    method,
    confidence: CONFIDENCE[method],
    referrerDomain,
    conclusive: CONFIDENCE[method] === 'exact' || CONFIDENCE[method] === 'high',
  });

  if (taggedChannel && isChannel(taggedChannel)) return finish(taggedChannel, 'tagged');

  const isAppReferrer = referrer && !/^https?:\/\//i.test(referrer);
  const viaReferrer = fromReferrer(referrer);
  if (viaReferrer && viaReferrer !== 'other') {
    return finish(viaReferrer, isAppReferrer ? 'app-referrer' : 'referrer');
  }

  const viaUserAgent = fromUserAgent(userAgent);
  if (viaUserAgent) return finish(viaUserAgent, 'user-agent');

  // A referrer we do not recognise still beats calling it direct.
  if (viaReferrer === 'other') return finish('other', 'referrer');

  // No referrer at all, but the browser told us the navigation came from another
  // site. That rules out "typed the URL" even though the site hid its identity,
  // so it belongs in its own bucket rather than lumped in with direct traffic.
  if (secFetchSite === 'cross-site' || secFetchSite === 'same-site') {
    return finish('other', 'sec-fetch');
  }

  return finish('direct', 'none');
}

/* ------------------------------------------------------------------ *
 * Client-side refinement
 * ------------------------------------------------------------------ */

// Globals that only exist inside an embedded webview. Useful when an in-app
// browser forwards a generic User-Agent, which is exactly the case server-side
// detection cannot handle on its own.
const WEBVIEW_MARKERS = {
  reactNative: 'other',
  androidWebView: 'other',
  iosWebView: 'other',
};

/**
 * Second-pass attribution from signals the browser can see but the request
 * cannot carry. Only ever used to *upgrade* an inconclusive result — it never
 * overrides a tagged link or a recognised referrer.
 *
 * @param {object} signals Posted by the interstitial page.
 * @returns {?{source: string, method: string, confidence: string}}
 */
function refineFromClient(signals = {}) {
  // The document referrer occasionally survives when the header was dropped,
  // e.g. some webviews omit the header on the initial navigation only.
  if (signals.referrer) {
    const viaReferrer = fromReferrer(signals.referrer);
    if (viaReferrer && viaReferrer !== 'other') {
      return { source: viaReferrer, method: 'client-referrer', confidence: 'high' };
    }
  }

  // A branded UA that the server missed (some webviews rewrite it late).
  if (signals.userAgent) {
    const viaUserAgent = fromUserAgent(signals.userAgent);
    if (viaUserAgent) {
      return { source: viaUserAgent, method: 'user-agent', confidence: 'high' };
    }
  }

  // Definitely an in-app browser, but the app did not identify itself. Better
  // recorded as "some app" than as a direct visit.
  if (signals.webview && WEBVIEW_MARKERS[signals.webview]) {
    return { source: 'other', method: 'client-webview', confidence: 'medium' };
  }

  return null;
}

module.exports = {
  CHANNELS,
  SUGGESTED_CHANNELS,
  CONFIDENCE,
  METHOD_LABELS,
  isChannel,
  channelLabel,
  channelColor,
  detectSource,
  refineFromClient,
  isBot,
};
