import rawConfig from '../../.harness/config/evaluation.json';
import {
  computeVerdict,
  FEEDBACK_PLACEHOLDER,
  renderFeedback,
  validateConfig,
  type CheckResult,
  type EvaluationConfig,
} from '../../.harness/tools/evaluation';
import { classifyChanges } from '../../.harness/tools/static-checks';

const config = rawConfig as unknown as EvaluationConfig;

/** A result for every check, all PASS with evidence, optionally overridden. */
function allPass(overrides: Record<string, Partial<CheckResult>> = {}): CheckResult[] {
  return config.checks.map((check) => ({ id: check.id, result: 'PASS', evidence: ['evidence'], ...overrides[check.id] }));
}

describe('evaluation config', () => {
  it('is structurally sound', () => {
    expect(validateConfig(config)).toEqual([]);
  });

  it('has at least one automated hard gate in every dimension', () => {
    for (const dimension of config.dimensions) {
      expect(config.checks.some((c) => c.dimension === dimension.id && c.kind === 'auto' && c.hard)).toBe(true);
    }
  });

  it.each([
    ['weights not summing to 100', { dimensions: config.dimensions.map((d, i) => (i === 0 ? { ...d, weight: d.weight + 1 } : d)) }, /sum to 101/],
    ['duplicate ids', { checks: [...config.checks, ...config.checks.slice(0, 1)] }, /duplicate check id ARCH-01/],
    ['unknown dimension', { checks: config.checks.map((c, i) => (i === 0 ? { ...c, dimension: 'nope' } : c)) }, /unknown dimension nope/],
    ['auto without runner', { checks: config.checks.map((c, i) => (i === 0 ? { ...c, runner: undefined } : c)) }, /ARCH-01 is auto but has no runner/],
    ['llm with a runner', { checks: config.checks.map((c) => (c.kind === 'llm' ? { ...c, runner: 'cmd:x' } : c)) }, /is llm but declares a runner/],
    ['dimension without an automated hard gate', { checks: config.checks.map((c) => (c.id === 'GOV-01' ? { ...c, hard: false } : c)) }, /governance has no automated hard gate/],
    ['inverted thresholds', { thresholds: { pass: 70, conditionalPass: 80 } }, /conditionalPass threshold must be below/],
  ])('rejects %s', (_label, patch, expected) => {
    expect(validateConfig({ ...config, ...patch }).join('\n')).toMatch(expected);
  });
});

describe('computeVerdict', () => {
  it('passes with a perfect score when everything passes', () => {
    const report = computeVerdict(config, allPass());
    expect(report).toMatchObject({ verdict: 'PASS', score: 100, hardGateFailures: [], failedChecks: [], unknownResults: [] });
    expect(report.dimensions.map((d) => d.score)).toEqual([35, 35, 20, 10]);
  });

  it('a single soft failure still passes, with a proportional deduction', () => {
    const report = computeVerdict(config, allPass({ 'ARCH-05': { result: 'FAIL', evidence: ['routes contain business logic'] } }));
    // architecture has 6 checks: 35 * 5/6 = 29.17
    expect(report).toMatchObject({ verdict: 'PASS', score: 94.2, hardGateFailures: [], failedChecks: ['ARCH-05'] });
  });

  it.each(['ARCH-01', 'ARCH-02', 'ARCH-03', 'ARCH-04', 'COR-01', 'COR-02', 'COR-03', 'COR-04', 'SEC-01', 'SEC-02', 'SEC-04', 'GOV-01'])(
    'failing the hard gate %s is an immediate FAIL however high the score is',
    (id) => {
      const report = computeVerdict(config, allPass({ [id]: { result: 'FAIL', evidence: ['x'] } }));
      expect(report.verdict).toBe('FAIL');
      expect(report.hardGateFailures).toEqual([id]);
      expect(report.score).toBeGreaterThan(75);
    },
  );

  it('several soft failures drop to CONDITIONAL PASS', () => {
    const softFailures = Object.fromEntries(['ARCH-05', 'ARCH-06', 'COR-05', 'SEC-05'].map((id) => [id, { result: 'FAIL' as const, evidence: ['x'] }]));
    const report = computeVerdict(config, allPass(softFailures));
    expect(report.verdict).toBe('CONDITIONAL PASS');
    expect(report.score).toBeGreaterThanOrEqual(75);
    expect(report.score).toBeLessThan(90);
    expect(report.hardGateFailures).toEqual([]);
  });

  it('a score below the conditional threshold is a FAIL even with no hard-gate failure', () => {
    const softIds = config.checks.filter((c) => !c.hard).map((c) => c.id);
    const report = computeVerdict(config, allPass(Object.fromEntries(softIds.map((id) => [id, { result: 'FAIL' as const, evidence: ['x'] }]))));
    expect(report.hardGateFailures).toEqual([]);
    expect(report.score).toBeLessThan(75);
    expect(report.verdict).toBe('FAIL');
  });

  it('boundary: exactly the pass threshold passes, just under is conditional', () => {
    const tight = { ...config, thresholds: { pass: 94.2, conditionalPass: 50 } };
    const results = allPass({ 'ARCH-05': { result: 'FAIL', evidence: ['x'] } });
    expect(computeVerdict(tight, results).verdict).toBe('PASS');
    expect(computeVerdict({ ...tight, thresholds: { pass: 94.3, conditionalPass: 50 } }, results).verdict).toBe('CONDITIONAL PASS');
    expect(computeVerdict({ ...tight, thresholds: { pass: 99, conditionalPass: 94.3 } }, results).verdict).toBe('FAIL');
  });

  describe('fail-closed handling of variable evaluator output', () => {
    it('a missing result is a FAIL (a hard gate that was never assessed fails the sprint)', () => {
      const report = computeVerdict(config, allPass().filter((r) => r.id !== 'ARCH-04'));
      expect(report.verdict).toBe('FAIL');
      expect(report.hardGateFailures).toEqual(['ARCH-04']);
      expect(report.checks.find((c) => c.id === 'ARCH-04')?.reason).toMatch(/no result reported/);
    });

    it('UNSURE counts as FAIL', () => {
      const report = computeVerdict(config, allPass({ 'COR-05': { result: 'UNSURE', evidence: ['not clear'] } }));
      expect(report.failedChecks).toEqual(['COR-05']);
      expect(report.checks.find((c) => c.id === 'COR-05')?.reason).toMatch(/UNSURE/);
    });

    it('an LLM PASS without evidence counts as FAIL, an automated PASS needs none', () => {
      const noEvidence = computeVerdict(config, allPass({ 'ARCH-04': { evidence: [] }, 'ARCH-01': { evidence: [] } }));
      expect(noEvidence.failedChecks).toEqual(['ARCH-04']);
      expect(noEvidence.checks.find((c) => c.id === 'ARCH-04')?.reason).toMatch(/without evidence/);
      const blank = computeVerdict(config, allPass({ 'ARCH-04': { evidence: ['  ', ''] } }));
      expect(blank.failedChecks).toEqual(['ARCH-04']);
    });

    it('conflicting duplicate results fail rather than picking one', () => {
      const report = computeVerdict(config, [...allPass(), { id: 'COR-05', result: 'FAIL', evidence: ['second opinion'] }]);
      expect(report.failedChecks).toEqual(['COR-05']);
      expect(report.checks.find((c) => c.id === 'COR-05')?.reason).toMatch(/conflicting duplicate/);
    });

    it('ignores but reports results for unknown checks', () => {
      const report = computeVerdict(config, [...allPass(), { id: 'MADE-UP', result: 'FAIL', evidence: ['x'] }]);
      expect(report.verdict).toBe('PASS');
      expect(report.unknownResults).toEqual(['MADE-UP']);
    });
  });

  it('is deterministic: the same results in any order give an identical report', () => {
    const results = allPass({
      'COR-05': { result: 'FAIL', evidence: ['a'] },
      'SEC-06': { result: 'UNSURE', evidence: ['b'] },
      'ARCH-02': { result: 'FAIL', evidence: ['c'] },
    });
    const baseline = JSON.stringify(computeVerdict(config, results));
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const shuffled = [...results].sort(() => Math.random() - 0.5);
      expect(JSON.stringify(computeVerdict(config, shuffled))).toBe(baseline);
    }
  });
});

describe('renderFeedback', () => {
  it('starts with machine-readable routing lines and ends with the actionable-feedback placeholder', () => {
    const report = computeVerdict(config, allPass({ 'ARCH-02': { result: 'FAIL', evidence: ['src/a/a.service.ts:12: throw new Error("x")'] } }));
    const text = renderFeedback(config, report, 2, 3);
    const lines = text.split('\n');
    expect(lines.slice(0, 5)).toEqual(['VERDICT: FAIL', `SCORE: ${report.score.toFixed(1)}`, 'HARD_GATE_FAILURES: ARCH-02', 'SPRINT: 2', 'ITERATION: 3']);
    expect(text).toContain('### ARCH-02 - No raw Error throws in src (HARD gate)');
    expect(text).toContain('- src/a/a.service.ts:12: throw new Error("x")');
    expect(text).toContain('| ARCH-02 | auto | HARD | FAIL |');
    expect(text).toContain(FEEDBACK_PLACEHOLDER);
  });

  it('explains fail-closed conversions and unknown ids, and omits the failed section when everything passes', () => {
    const converted = computeVerdict(config, [...allPass({ 'COR-05': { result: 'UNSURE', evidence: [] } }), { id: 'X-1', result: 'PASS', evidence: ['x'] }]);
    const text = renderFeedback(config, converted, 1, 1);
    expect(text).toContain('Converted to FAIL: result was UNSURE (fail-closed)');
    expect(text).toContain('- (none)');
    expect(text).toContain('Ignored results for unknown check ids: X-1');

    const clean = renderFeedback(config, computeVerdict(config, allPass()), 1, 1);
    expect(clean).toContain('VERDICT: PASS');
    expect(clean).toContain('HARD_GATE_FAILURES: none');
    expect(clean).not.toContain('## Failed checks');
  });
});

describe('computeVerdict: result values the Evaluator must never be able to smuggle through', () => {
  it.each(['MAYBE', 'pass', 'Pass', '', 'N/A', 'PASS ', 'true'])('turns the result %j into a FAIL, and a hard gate then fails the sprint', (value) => {
    const report = computeVerdict(config, allPass({ 'ARCH-04': { result: value as never } }));
    expect(report.verdict).toBe('FAIL');
    expect(report.hardGateFailures).toEqual(['ARCH-04']);
    expect(report.checks.find((c) => c.id === 'ARCH-04')?.reason).toMatch(/invalid result value/);
  });

  it('an invalid value on a soft check also counts as a failure (not as a pass, not as nothing)', () => {
    const report = computeVerdict(config, allPass({ 'ARCH-05': { result: 'MAYBE' as never } }));
    expect(report.failedChecks).toEqual(['ARCH-05']);
    expect(report.score).toBe(94.2);
  });
});

describe('renderFeedback: tool-supplied change summary', () => {
  const report = computeVerdict(config, allPass());

  it('lists what changed by kind so "no routes changed" is a fact, not a judgement', () => {
    const text = renderFeedback(config, report, 1, 1, classifyChanges(['src/activities/activities.service.ts', 'tests/activities/a.test.ts']));
    expect(text).toContain('## What changed (computed by the tools)');
    expect(text).toContain('| routes | none |');
    expect(text).toContain('| services | src/activities/activities.service.ts |');
    expect(text).toContain('| tests | tests/activities/a.test.ts |');
    expect(text.indexOf('## What changed')).toBeLessThan(text.indexOf('## Dimension scores'));
  });

  it('is omitted when no summary is supplied', () => {
    expect(renderFeedback(config, report, 1, 1)).not.toContain('## What changed');
  });
});
