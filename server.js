'use strict';

const app = require('./src/app');
const { PORT, BASE_URL } = require('./src/config');

app.listen(PORT, () => {
  console.log(`\n  Tracker running:  ${BASE_URL}`);
  console.log(`  Dashboard:        ${BASE_URL}/app/dashboard\n`);
});
