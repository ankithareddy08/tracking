'use strict';

// Vercel's Node.js runtime treats a default-exported Express app as a request
// handler directly — no listen() call, no separate HTTP server; the platform
// owns that part. vercel.json routes every path here.
module.exports = require('../src/app');
