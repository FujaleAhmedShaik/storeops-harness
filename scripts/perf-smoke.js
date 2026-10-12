#!/usr/bin/env node
/**
 * Lightweight performance gate (no extra dependencies).
 *   BASE_URL=http://localhost:3000 DEMO_PASSWORD=... node scripts/perf-smoke.js
 * Fails (exit 1) if the error rate is above 0% or p95 latency exceeds P95_BUDGET_MS.
 * Deliberately modest: it guards against regressions, it is not a capacity test.
 */
const baseUrl = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const password = process.env.DEMO_PASSWORD;
const total = Number(process.env.PERF_REQUESTS ?? 400);
const concurrency = Number(process.env.PERF_CONCURRENCY ?? 20);
const p95Budget = Number(process.env.P95_BUDGET_MS ?? 250);

if (!password) {
  console.error('DEMO_PASSWORD is required.');
  process.exit(2);
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function main() {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'manager.s1@storeops.example', password }),
  });
  if (!login.ok) throw new Error(`login failed with ${login.status}`);
  const { accessToken } = await login.json();

  const latencies = [];
  let errors = 0;
  let next = 0;

  async function worker() {
    while (next < total) {
      next += 1;
      const started = performance.now();
      try {
        const response = await fetch(`${baseUrl}/api/activities?limit=50`, { headers: { Authorization: `Bearer ${accessToken}` } });
        await response.arrayBuffer();
        if (!response.ok) errors += 1;
      } catch {
        errors += 1;
      }
      latencies.push(performance.now() - started);
    }
  }

  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const seconds = (performance.now() - started) / 1000;

  latencies.sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  console.log(`requests=${total} concurrency=${concurrency} duration=${seconds.toFixed(1)}s rps=${(total / seconds).toFixed(0)}`);
  console.log(`p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms errors=${errors} (budget: p95<=${p95Budget}ms, errors=0)`);

  if (errors > 0 || p95 > p95Budget) {
    console.error('Performance gate FAILED');
    process.exit(1);
  }
  console.log('Performance gate passed');
}

main().catch((error) => {
  console.error(`Performance run aborted: ${error.message}`);
  process.exit(1);
});
