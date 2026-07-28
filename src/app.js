'use strict';

/**
 * Express app, with no listen() call — that lives in server.js for local/
 * traditional hosting. Vercel's serverless entry (api/index.js) imports this
 * file directly and hands it straight to the platform's own request handler,
 * since a serverless function owns the HTTP server itself.
 */

const path = require('path');
const express = require('express');

const { BASE_URL } = require('./config');
const pages = require('./routes/pages');
const api = require('./routes/api');
const redirect = require('./routes/redirect');

const app = express();

// Needed so req.ip and the forwarded-for parsing see the real client address
// when this sits behind nginx, Cloudflare, Vercel, etc.
app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.disable('x-powered-by');

app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(express.json({ limit: '32kb' }));

// A malformed body must not reach the HTML error page. This matters most for the
// beacon endpoint, which fires from a page that is already navigating away and
// can be cut off mid-write.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body.' });
  }
  return next(err);
});
app.use('/assets', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/robots.txt', (req, res) => {
  // Keep crawlers off the tracking links so preview bots and search engines do
  // not generate clicks, and keep the dashboard out of search results.
  res.type('text/plain').send('User-agent: *\nDisallow: /\n');
});

app.use('/api', api);
app.use('/', pages);

// Registered last: this owns every remaining single-segment path, so it must not
// get a chance to shadow the routes above.
app.use('/', redirect);

app.use((req, res) => {
  res.status(404).render('404', { title: 'Link not found', baseUrl: BASE_URL });
});

app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  return res.status(500).render('error', { title: 'Something went wrong', baseUrl: BASE_URL });
});

module.exports = app;
