import rawConfig from '../../.harness/config/evaluation.json';
import { computeVerdict, FEEDBACK_PLACEHOLDER, type CheckResult, type EvaluationConfig, type VerdictReport } from '../../.harness/tools/evaluation';
import { initialState, renderEscalation, route, type HarnessState } from '../../.harness/tools/routing';

const config = rawConfig as unknown as EvaluationConfig;
const pass = (id: string): CheckResult => ({ id, result: 'PASS', evidence: ['e'] });

function report(failing: string[] = []): VerdictReport {
  return computeVerdict(
    config,
    config.checks.map((c) => (failing.includes(c.id) ? { id: c.id, result: 'FAIL' as const, evidence: ['x'] } : pass(c.id))),
  );
}

const withFeedback = 'VERDICT: FAIL\n\n## Actionable feedback\n\n- src/a.ts:10 fix the thing\n';

describe('route', () => {
  it('starts a run at sprint 1, iteration 1', () => {
    expect(initialState('Bulk update', 3)).toEqual({ feature: 'Bulk update', active: true, status: 'RUNNING', totalSprints: 3, sprint: 1, iteration: 1, history: [] });
  });

  it('ADVANCEs to the next sprint on PASS and resets the iteration counter', () => {
    const state: HarnessState = { ...initialState('f', 3), sprint: 1, iteration: 2 };
    const decision = route(state, report(), 3, '');
    expect(decision.action).toBe('ADVANCE');
    expect(decision.state).toMatchObject({ sprint: 2, iteration: 1, active: true, status: 'RUNNING' });
    expect(decision.state.history).toEqual([{ sprint: 1, iteration: 2, verdict: 'PASS', score: 100, failedChecks: [], hardGateFailures: [] }]);
  });

  it('ADVANCEs on CONDITIONAL PASS too, recording what failed', () => {
    const decision = route(initialState('f', 2), report(['ARCH-05', 'ARCH-06', 'COR-05', 'SEC-05']), 3, '');
    expect(decision.action).toBe('ADVANCE');
    expect(decision.state.history[0]).toMatchObject({ verdict: 'CONDITIONAL PASS', failedChecks: ['ARCH-05', 'ARCH-06', 'COR-05', 'SEC-05'] });
  });

  it('COMPLETEs and deactivates after the last sprint passes', () => {
    const decision = route({ ...initialState('f', 2), sprint: 2 }, report(), 3, '');
    expect(decision.action).toBe('COMPLETE');
    expect(decision.state).toMatchObject({ active: false, status: 'COMPLETE', sprint: 2 });
    expect(decision.message).toContain('All 2 sprints done');
  });

  it('RETRYs the same sprint on FAIL below the iteration limit', () => {
    const decision = route(initialState('f', 3), report(['COR-04']), 3, withFeedback);
    expect(decision.action).toBe('RETRY');
    expect(decision.state).toMatchObject({ sprint: 1, iteration: 2, active: true });
    expect(decision.message).toContain('1/3');
  });

  it('ESCALATEs on FAIL at the iteration limit and deactivates the run', () => {
    const decision = route({ ...initialState('f', 3), iteration: 3 }, report(['COR-04']), 3, withFeedback);
    expect(decision.action).toBe('ESCALATE');
    expect(decision.state).toMatchObject({ active: false, status: 'ESCALATED', sprint: 1, iteration: 3 });
  });

  it('refuses to route a FAIL whose actionable feedback was never written', () => {
    expect(() => route(initialState('f', 3), report(['COR-04']), 3, `x\n${FEEDBACK_PLACEHOLDER}\n`)).toThrow(/placeholder/);
  });

  it('does not require feedback for a passing verdict', () => {
    expect(() => route(initialState('f', 3), report(), 3, FEEDBACK_PLACEHOLDER)).not.toThrow();
  });

  it('three failing iterations in a row end in escalation (full walk)', () => {
    let state = initialState('f', 1);
    const actions: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const decision = route(state, report(['ARCH-01']), 3, withFeedback);
      actions.push(decision.action);
      state = decision.state;
    }
    expect(actions).toEqual(['RETRY', 'RETRY', 'ESCALATE']);
    expect(state.history).toHaveLength(3);
  });
});

describe('renderEscalation', () => {
  it('names the sprint, iteration count, blocking gates and the options', () => {
    let state = initialState('Shift handover bulk update', 3);
    let last = route(state, report(['ARCH-01', 'COR-04']), 3, withFeedback);
    state = last.state;
    last = route(state, report(['ARCH-01']), 3, withFeedback);
    state = last.state;
    last = route(state, report(['ARCH-01']), 3, withFeedback);
    const text = renderEscalation(last.state, report(['ARCH-01']), 3);

    expect(text).toContain('# Escalation - sprint 1');
    expect(text).toContain('Feature: Shift handover bulk update');
    expect(text).toContain('Iterations used: 3 of 3');
    expect(text).toContain('Blocking hard gates: ARCH-01');
    expect(text).toContain('| 1 | FAIL | ');
    expect(text).toContain('ARCH-01, COR-04');
    expect(text).toContain('Decision needed from the developer');
  });

  it('says so when the failure is a low score rather than a hard gate', () => {
    const soft = config.checks.filter((c) => !c.hard).map((c) => c.id);
    const low = report(soft);
    const text = renderEscalation({ ...initialState('f', 1), iteration: 3, history: [] }, low, 3);
    expect(text).toContain('Blocking hard gates: none (score below threshold)');
  });
});

describe('renderEscalation: the destructive option carries a warning', () => {
  it('names the exact commands and warns that they delete uncommitted work', () => {
    const text = renderEscalation({ ...initialState('f', 1), iteration: 3 }, report(['ARCH-01']), 3);
    expect(text).toContain('git restore --source=HEAD --staged --worktree -- src tests docs/openapi.yaml');
    expect(text).toContain('git clean -fd -- src tests');
    expect(text).toContain('CAUTION');
    expect(text).toContain('permanently deletes uncommitted work');
  });
});
