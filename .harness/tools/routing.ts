/** Deterministic routing: what happens after each evaluator verdict. CLAUDE.md documents these rules; this implements them. */
import { FEEDBACK_PLACEHOLDER, type Verdict, type VerdictReport } from './evaluation';

export type Action = 'ADVANCE' | 'RETRY' | 'ESCALATE' | 'COMPLETE';

export interface HistoryEntry {
  readonly sprint: number;
  readonly iteration: number;
  readonly verdict: Verdict;
  readonly score: number;
  readonly failedChecks: readonly string[];
  readonly hardGateFailures: readonly string[];
}

export interface HarnessState {
  readonly feature: string;
  readonly active: boolean;
  readonly status: 'RUNNING' | 'COMPLETE' | 'ESCALATED';
  readonly totalSprints: number;
  readonly sprint: number;
  readonly iteration: number;
  readonly history: readonly HistoryEntry[];
}

export interface RouteDecision {
  readonly action: Action;
  readonly state: HarnessState;
  readonly message: string;
}

export function initialState(feature: string, totalSprints: number): HarnessState {
  return { feature, active: true, status: 'RUNNING', totalSprints, sprint: 1, iteration: 1, history: [] };
}

/**
 * PASS or CONDITIONAL PASS -> next sprint (or COMPLETE after the last).
 * FAIL below the iteration limit -> RETRY the same sprint with the feedback.
 * FAIL at the iteration limit -> ESCALATE to the developer.
 */
export function route(state: HarnessState, report: VerdictReport, maxIterations: number, feedbackText: string): RouteDecision {
  if (report.verdict === 'FAIL' && feedbackText.includes(FEEDBACK_PLACEHOLDER)) {
    throw new Error('evaluator-feedback.md still contains the placeholder: the Evaluator must write actionable feedback before routing');
  }
  const entry: HistoryEntry = {
    sprint: state.sprint,
    iteration: state.iteration,
    verdict: report.verdict,
    score: report.score,
    failedChecks: report.failedChecks,
    hardGateFailures: report.hardGateFailures,
  };
  const history = [...state.history, entry];

  if (report.verdict !== 'FAIL') {
    if (state.sprint >= state.totalSprints) {
      return {
        action: 'COMPLETE',
        state: { ...state, history, active: false, status: 'COMPLETE' },
        message: `Sprint ${state.sprint} ${report.verdict} (${report.score.toFixed(1)}). All ${state.totalSprints} sprints done.`,
      };
    }
    return {
      action: 'ADVANCE',
      state: { ...state, history, sprint: state.sprint + 1, iteration: 1 },
      message: `Sprint ${state.sprint} ${report.verdict} (${report.score.toFixed(1)}). Advance to sprint ${state.sprint + 1}.`,
    };
  }
  if (state.iteration < maxIterations) {
    return {
      action: 'RETRY',
      state: { ...state, history, iteration: state.iteration + 1 },
      message: `Sprint ${state.sprint} FAIL on iteration ${state.iteration}/${maxIterations}. Retry with the evaluator feedback.`,
    };
  }
  return {
    action: 'ESCALATE',
    state: { ...state, history, active: false, status: 'ESCALATED' },
    message: `Sprint ${state.sprint} FAIL after ${maxIterations} iterations. Escalating to the developer.`,
  };
}

/** escalation.md: names the sprint, the iteration count and the blocking issues. */
export function renderEscalation(state: HarnessState, report: VerdictReport, maxIterations: number): string {
  const attempts = state.history.filter((entry) => entry.sprint === state.sprint);
  return [
    `# Escalation - sprint ${state.sprint}`,
    '',
    `Feature: ${state.feature}`,
    `Sprint: ${state.sprint} of ${state.totalSprints}`,
    `Iterations used: ${attempts.length} of ${maxIterations}`,
    `Blocking hard gates: ${report.hardGateFailures.length === 0 ? 'none (score below threshold)' : report.hardGateFailures.join(', ')}`,
    `Failed checks: ${report.failedChecks.join(', ')}`,
    '',
    '## History of this sprint',
    '',
    '| Iteration | Verdict | Score | Failed checks |',
    '|---|---|---|---|',
    ...attempts.map((entry) => `| ${entry.iteration} | ${entry.verdict} | ${entry.score.toFixed(1)} | ${entry.failedChecks.join(', ') || 'none'} |`),
    '',
    '## Decision needed from the developer',
    '',
    'Read `.harness/output/evaluator-feedback.md`, then choose one:',
    '1. Fix the blocking issue by hand, run `npm run verify`, and continue the sprint manually.',
    '2. Amend the sprint contract (scope or acceptance criteria) and restart the sprint.',
    '3. Reject the feature and discard the working tree changes: `git restore --source=HEAD --staged --worktree -- src tests docs/openapi.yaml`, then `git clean -fd -- src tests`.',
    '   CAUTION: this permanently deletes uncommitted work and untracked files in `src/` and `tests/`. Run `git status` first and keep anything you want.',
    '',
    'The harness run is now inactive: edits to protected files are allowed again.',
    '',
  ].join('\n');
}
