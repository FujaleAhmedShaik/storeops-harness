#!/usr/bin/env node
/**
 * End-to-end smoke test against a running StoreOps API (local container or Azure).
 *   BASE_URL=http://localhost:3000 DEMO_PASSWORD=... node scripts/smoke.js
 * Exercises all 9 base endpoints plus login, with readable output suitable for DEPLOYMENT.md screenshots.
 * Requires the target to run with SEED_DEMO_DATA=true (local / dev only).
 */
/** The target comes from the environment, so accept only a plain http(s) origin: no credentials, path, query or other schemes. */
function parseBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    console.error(`BASE_URL is not a valid URL: ${raw}`);
    process.exit(2);
  }
  const plainOrigin = (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  if (!plainOrigin) {
    console.error('BASE_URL must be an http(s) origin such as http://localhost:3000 (no credentials, path or query).');
    process.exit(2);
  }
  return url;
}

const baseUrl = parseBaseUrl(process.env.BASE_URL ?? 'http://localhost:3000');
const password = process.env.DEMO_PASSWORD;

if (!password) {
  console.error('DEMO_PASSWORD is required (the value the target was started with).');
  process.exit(2);
}

let failures = 0;

async function call(label, method, path, { token, body, expect } = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  const ok = response.status === expect;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${method.padEnd(6)} ${path.padEnd(48)} -> ${response.status} (expected ${expect})  ${label}`);
  return json;
}

async function login(email) {
  const result = await call(`login as ${email}`, 'POST', '/api/auth/login', { body: { email, password }, expect: 200 });
  return result?.accessToken;
}

async function main() {
  console.log(`StoreOps smoke test -> ${baseUrl.origin}\n`);
  await call('liveness', 'GET', '/health/live', { expect: 200 });
  await call('readiness', 'GET', '/health/ready', { expect: 200 });
  await call('unauthenticated request is rejected', 'GET', '/api/activities', { expect: 401 });

  const manager = await login('manager.s1@storeops.example');
  const associate = await login('associate.s1@storeops.example');
  const otherStore = await login('manager.s2@storeops.example');
  if (!manager || !associate || !otherStore) {
    console.error('Login failed - is the target seeded with demo data and is DEMO_PASSWORD correct?');
    process.exit(1);
  }

  const programme = await call('create programme', 'POST', '/api/programmes', { token: manager, body: { name: 'Smoke programme' }, expect: 201 });
  await call('list programmes', 'GET', '/api/programmes', { token: manager, expect: 200 });

  const task = await call('create restocking activity', 'POST', '/api/activities', {
    token: manager,
    body: { title: 'Restock dairy', programmeId: programme?.id, category: 'RESTOCKING', priority: 'HIGH' },
    expect: 201,
  });
  const id = task?.id;
  await call('list activities', 'GET', `/api/activities?programmeId=${programme?.id}`, { token: manager, expect: 200 });
  await call('get activity', 'GET', `/api/activities/${id}`, { token: associate, expect: 200 });
  await call('other store cannot see it (404, not 403)', 'GET', `/api/activities/${id}`, { token: otherStore, expect: 404 });
  await call('start work', 'PATCH', `/api/activities/${id}`, { token: manager, body: { status: 'IN_PROGRESS' }, expect: 200 });
  await call('complete work', 'PATCH', `/api/activities/${id}`, { token: manager, body: { status: 'DONE' }, expect: 200 });
  await call('reopening a DONE activity is refused (409)', 'PATCH', `/api/activities/${id}`, { token: manager, body: { status: 'TODO' }, expect: 409 });
  await call('associate cannot raise priority (403)', 'PATCH', `/api/activities/${id}`, { token: associate, body: { priority: 'CRITICAL' }, expect: 403 });
  await call('associate cannot delete someone else\'s activity', 'DELETE', `/api/activities/${id}`, { token: associate, expect: 403 });
  await call('manager deletes the activity', 'DELETE', `/api/activities/${id}`, { token: manager, expect: 204 });
  await call('alerts endpoint', 'GET', '/api/alerts', { token: manager, expect: 200 });

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`Smoke test aborted: ${error.message}`);
  process.exit(1);
});
