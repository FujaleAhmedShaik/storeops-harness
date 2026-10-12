#!/usr/bin/env node
/** Creates .env with freshly generated random secrets. Never overwrites an existing .env. */
const { existsSync, writeFileSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const { join } = require('node:path');

const target = join(__dirname, '..', '.env');
if (existsSync(target)) {
  console.log('.env already exists - leaving it untouched.');
  process.exit(0);
}

const lines = [
  'APP_ENV=local',
  'LOG_LEVEL=info',
  `JWT_SECRET=${randomBytes(48).toString('base64url')}`,
  'SEED_DEMO_DATA=true',
  `DEMO_PASSWORD=${randomBytes(18).toString('base64url')}`,
  '',
];
writeFileSync(target, lines.join('\n'), { mode: 0o600 });
console.log('Created .env (git-ignored). The demo password for every seeded user is DEMO_PASSWORD in that file.');
