#!/usr/bin/env node
/**
 * Learning aid: pretend certain checks failed and see what verdict the harness would give.
 *   npm run harness:demo                       everything passes
 *   npm run harness:demo -- ARCH-05            one soft check fails
 *   npm run harness:demo -- COR-04             one HARD gate fails
 *   npm run harness:demo -- ARCH-05 ARCH-06 COR-05 SEC-05
 * It uses the real evaluation config and the real verdict code, so the answers are exactly what a harness run would produce.
 */
require('tsx/cjs');
const config = require('../.harness/config/evaluation.json');
const { computeVerdict } = require('../.harness/tools/evaluation.ts');

const failing = process.argv.slice(2).map((id) => id.toUpperCase());
const known = new Set(config.checks.map((check) => check.id));
const unknown = failing.filter((id) => !known.has(id));
if (unknown.length > 0) {
  console.error(`Unknown check id(s): ${unknown.join(', ')}. Valid ids: ${[...known].join(', ')}`);
  process.exit(2);
}

const results = config.checks.map((check) => ({
  id: check.id,
  result: failing.includes(check.id) ? 'FAIL' : 'PASS',
  evidence: ['demo'],
}));
const report = computeVerdict(config, results);

console.log(`Pretending these checks FAIL: ${failing.join(', ') || '(none)'}\n`);
for (const dimension of report.dimensions) {
  console.log(`  ${dimension.name.padEnd(38)} ${dimension.passed}/${dimension.total} checks pass  weight ${String(dimension.weight).padStart(2)}  ->  ${dimension.score.toFixed(1)} points`);
}
console.log(`\n  Total score: ${report.score}   (PASS needs ${config.thresholds.pass}, CONDITIONAL PASS needs ${config.thresholds.conditionalPass})`);
console.log(`  Hard gates failed: ${report.hardGateFailures.join(', ') || 'none'}`);
console.log(`\n  VERDICT: ${report.verdict}`);
if (report.hardGateFailures.length > 0) {
  console.log('  (a failed hard gate means FAIL no matter what the score is)');
}
