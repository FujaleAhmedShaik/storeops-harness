import rawConfig from '../../.harness/config/evaluation.json';
import type { EvaluationConfig } from '../../.harness/tools/evaluation';
import {
  estimateSprintTokens,
  estimateTokens,
  guardDecision,
  parseRunLog,
  renderRunLog,
  summarizeTrends,
  TREND_PLACEHOLDER,
} from '../../.harness/tools/reporting';
import { initialState, type HarnessState } from '../../.harness/tools/routing';

const config = rawConfig as unknown as EvaluationConfig;

function stateWithHistory(): HarnessState {
  return {
    ...initialState('Shift handover bulk update', 2),
    history: [
      { sprint: 1, iteration: 1, verdict: 'FAIL', score: 82.5, failedChecks: ['COR-04', 'ARCH-02'], hardGateFailures: ['COR-04', 'ARCH-02'] },
      { sprint: 1, iteration: 2, verdict: 'PASS', score: 97.5, failedChecks: ['GOV-03'], hardGateFailures: [] },
      { sprint: 2, iteration: 1, verdict: 'PASS', score: 100, failedChecks: [], hardGateFailures: [] },
    ],
  };
}

describe('token estimates', () => {
  it('uses about four characters per token, rounded up', () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
  });

  it('multiplies one iteration of agent traffic by the iterations used', () => {
    const sizes = { iterations: 2, generatorInputChars: 4000, generatorOutputChars: 2000, evaluatorInputChars: 3000, evaluatorOutputChars: 1000 };
    expect(estimateSprintTokens(sizes)).toBe(5000);
    expect(estimateSprintTokens({ ...sizes, iterations: 1 })).toBe(2500);
  });
});

describe('run log', () => {
  const render = (sprint: number) =>
    renderRunLog({ state: stateWithHistory(), sprint, finalVerdict: sprint === 1 ? 'PASS' : 'PASS', finalScore: sprint === 1 ? 97.5 : 100, escalated: false, estimatedTokens: 12345, date: '2026-10-10' });

  it('captures sprint id, verdict, iterations, escalation flag and token estimate', () => {
    const fields = parseRunLog(render(1));
    expect(fields).toMatchObject({
      SPRINT_ID: 'sprint-1',
      FEATURE: 'Shift handover bulk update',
      DATE: '2026-10-10',
      VERDICT: 'PASS',
      SCORE: '97.5',
      ITERATIONS_USED: '2',
      ESCALATED: 'false',
      ESTIMATED_TOKENS: '12345',
      FAILED_CHECKS_BY_ITERATION: '1=COR-04+ARCH-02; 2=GOV-03',
      HARD_GATE_FAILURES: 'COR-04,ARCH-02',
    });
  });

  it('only counts the requested sprint and says none when nothing failed', () => {
    const fields = parseRunLog(render(2));
    expect(fields).toMatchObject({ ITERATIONS_USED: '1', FAILED_CHECKS_BY_ITERATION: '1=none', HARD_GATE_FAILURES: 'none' });
  });

  it('includes an iterations table, an estimate caveat and the trend-notes placeholder', () => {
    const text = render(1);
    expect(text).toContain('| 1 | FAIL | 82.5 | COR-04, ARCH-02 | COR-04, ARCH-02 |');
    expect(text).toContain('| 2 | PASS | 97.5 | GOV-03 | none |');
    expect(text).toContain('estimate');
    expect(text).toContain(TREND_PLACEHOLDER);
  });

  it('records an escalation', () => {
    const text = renderRunLog({ state: stateWithHistory(), sprint: 1, finalVerdict: 'FAIL', finalScore: 60, escalated: true, estimatedTokens: 1, date: '2026-10-10' });
    expect(parseRunLog(text)).toMatchObject({ ESCALATED: 'true', VERDICT: 'FAIL' });
  });

  it('a sprint with no history renders as none', () => {
    const text = renderRunLog({ state: initialState('f', 1), sprint: 1, finalVerdict: 'PASS', finalScore: 100, escalated: false, estimatedTokens: 0, date: 'd' });
    expect(parseRunLog(text)).toMatchObject({ ITERATIONS_USED: '0', FAILED_CHECKS_BY_ITERATION: 'none' });
  });
});

describe('summarizeTrends', () => {
  const log = (sprint: number, failed: string) =>
    renderRunLog({
      state: { ...initialState('f', 3), history: [{ sprint, iteration: 1, verdict: 'PASS', score: 95, failedChecks: failed === 'none' ? [] : failed.split('+'), hardGateFailures: [] }] },
      sprint,
      finalVerdict: 'PASS',
      finalScore: 95,
      escalated: false,
      estimatedTokens: 1,
      date: 'd',
    });

  it('counts each failing check once per sprint, sorts recurring first and names the skill to refine', () => {
    const trends = summarizeTrends([log(1, 'COR-04+ARCH-05'), log(2, 'COR-04'), log(3, 'none')], config);
    expect(trends.map((t) => [t.checkId, t.sprintsFailed, t.skill])).toEqual([
      ['COR-04', 2, 'how-to-test'],
      ['ARCH-05', 1, 'architecture-principles'],
    ]);
    expect(trends[0]).toMatchObject({ sprints: ['sprint-1', 'sprint-2'], title: 'Tests assert business outcomes, not just status codes' });
  });

  it('reports nothing when no sprint failed a check, and tolerates unknown ids and malformed logs', () => {
    expect(summarizeTrends([log(1, 'none')], config)).toEqual([]);
    expect(summarizeTrends(['no fields here'], config)).toEqual([]);
    expect(summarizeTrends([log(1, 'ZZZ-99')], config)[0]).toMatchObject({ checkId: 'ZZZ-99', skill: 'unknown', title: 'unknown check' });
  });
});

describe('guardDecision', () => {
  const base = { projectRoot: 'D:\\Work\\Agents\\storeops-harness', protectedPaths: config.protectedPaths };

  it('allows everything when no run is active', () => {
    expect(guardDecision({ ...base, active: false, filePath: 'D:\\Work\\Agents\\storeops-harness\\jest.config.js' })).toEqual({ allow: true, reason: 'no active harness run' });
  });

  it.each([
    'jest.config.js',
    'eslint.config.mjs',
    '.dependency-cruiser.cjs',
    'package.json',
    '.harness/config/evaluation.json',
    '.harness/skills/how-to-test/SKILL.md',
    '.github/workflows/ci-cd.yml',
    'CLAUDE.md',
    'infra/main.bicep',
    'tests/harness/evaluation.test.ts',
  ])('blocks %s during a run, for absolute Windows and relative paths alike', (path) => {
    const absolute = `D:\\Work\\Agents\\storeops-harness\\${path.replace(/\//g, '\\')}`;
    for (const filePath of [absolute, path, absolute.toLowerCase()]) {
      const decision = guardDecision({ ...base, active: true, filePath });
      expect(decision.allow).toBe(false);
      expect(decision.reason).toContain('protected file');
    }
  });

  it.each(['src/activities/activities.service.ts', 'tests/activities/x.test.ts', 'docs/openapi.yaml', '.harness/output/spec.md', '.harness/reviews/sprint-1-run-log.md'])(
    'allows %s during a run',
    (path) => {
      expect(guardDecision({ ...base, active: true, filePath: `D:\\Work\\Agents\\storeops-harness\\${path.replace(/\//g, '\\')}` }).allow).toBe(true);
    },
  );

  it('tolerates a trailing slash on the project root and paths outside the project', () => {
    expect(guardDecision({ ...base, projectRoot: 'D:/Work/Agents/storeops-harness/', active: true, filePath: 'D:/Work/Agents/storeops-harness/jest.config.js' }).allow).toBe(false);
    expect(guardDecision({ ...base, active: true, filePath: 'C:/elsewhere/notes.txt' }).allow).toBe(true);
  });
});
