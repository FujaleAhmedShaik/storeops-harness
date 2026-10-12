/** Monitor support: run-log rendering and parsing, quality trends, token estimates and the write guard. */
import type { EvaluationConfig, Verdict } from './evaluation';
import type { HarnessState } from './routing';
import { matchesAny, normalizePath } from './static-checks';

export const TREND_PLACEHOLDER = '<!-- MONITOR: replace this line with quality trend notes -->';

/** Rough token estimate: about four characters per token. A lower bound: it ignores tool traffic and reasoning. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export interface SprintSizes {
  readonly iterations: number;
  readonly generatorInputChars: number;
  readonly generatorOutputChars: number;
  readonly evaluatorInputChars: number;
  readonly evaluatorOutputChars: number;
}

export function estimateSprintTokens(sizes: SprintSizes): number {
  const perIteration = sizes.generatorInputChars + sizes.generatorOutputChars + sizes.evaluatorInputChars + sizes.evaluatorOutputChars;
  return estimateTokens(perIteration * sizes.iterations);
}

export interface RunLogInput {
  readonly state: HarnessState;
  readonly sprint: number;
  readonly finalVerdict: Verdict;
  readonly finalScore: number;
  readonly escalated: boolean;
  readonly estimatedTokens: number;
  readonly date: string;
}

export function renderRunLog(input: RunLogInput): string {
  const attempts = input.state.history.filter((entry) => entry.sprint === input.sprint);
  const byIteration = attempts.map((entry) => `${entry.iteration}=${entry.failedChecks.join('+') || 'none'}`).join('; ');
  const hardFailures = [...new Set(attempts.flatMap((entry) => entry.hardGateFailures))];
  return [
    `# Run log - sprint ${input.sprint}`,
    '',
    `SPRINT_ID: sprint-${input.sprint}`,
    `FEATURE: ${input.state.feature}`,
    `DATE: ${input.date}`,
    `VERDICT: ${input.finalVerdict}`,
    `SCORE: ${input.finalScore.toFixed(1)}`,
    `ITERATIONS_USED: ${attempts.length}`,
    `ESCALATED: ${input.escalated}`,
    `ESTIMATED_TOKENS: ${input.estimatedTokens}`,
    `FAILED_CHECKS_BY_ITERATION: ${byIteration || 'none'}`,
    `HARD_GATE_FAILURES: ${hardFailures.join(',') || 'none'}`,
    '',
    '## Iterations',
    '',
    '| Iteration | Verdict | Score | Failed checks | Hard-gate failures |',
    '|---|---|---|---|---|',
    ...attempts.map(
      (entry) =>
        `| ${entry.iteration} | ${entry.verdict} | ${entry.score.toFixed(1)} | ${entry.failedChecks.join(', ') || 'none'} | ${entry.hardGateFailures.join(', ') || 'none'} |`,
    ),
    '',
    'Token figure is an estimate (about four characters per token of agent context plus output); it excludes tool traffic and reasoning.',
    '',
    '## Quality trend notes',
    '',
    TREND_PLACEHOLDER,
    '',
  ].join('\n');
}

export function parseRunLog(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Z_]+): (.*)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      fields[match[1]] = match[2];
    }
  }
  return fields;
}

export interface TrendEntry {
  readonly checkId: string;
  readonly sprintsFailed: number;
  readonly sprints: readonly string[];
  readonly skill: string;
  readonly title: string;
}

/** Counts how often each check fails across sprint run logs: recurring failures point at a skill file that needs work. */
export function summarizeTrends(runLogs: readonly string[], config: EvaluationConfig): TrendEntry[] {
  const failures = new Map<string, string[]>();
  for (const log of runLogs) {
    const fields = parseRunLog(log);
    const sprint = fields.SPRINT_ID ?? 'unknown';
    const raw = fields.FAILED_CHECKS_BY_ITERATION ?? 'none';
    const ids = new Set(
      raw
        .split(';')
        .flatMap((part) => part.split('=')[1]?.split('+') ?? [])
        .map((id) => id.trim())
        .filter((id) => id !== '' && id !== 'none'),
    );
    for (const id of ids) {
      failures.set(id, [...(failures.get(id) ?? []), sprint]);
    }
  }
  return [...failures.entries()]
    .map(([checkId, sprints]) => {
      const definition = config.checks.find((check) => check.id === checkId);
      return { checkId, sprintsFailed: sprints.length, sprints, skill: definition?.skill ?? 'unknown', title: definition?.title ?? 'unknown check' };
    })
    .sort((a, b) => b.sprintsFailed - a.sprintsFailed || a.checkId.localeCompare(b.checkId));
}

export interface GuardInput {
  readonly active: boolean;
  readonly filePath: string;
  readonly projectRoot: string;
  readonly protectedPaths: readonly string[];
}

export interface GuardDecision {
  readonly allow: boolean;
  readonly reason: string;
}

/** PreToolUse guard: while a harness run is active, edits to gate configuration and harness files are refused. */
export function guardDecision(input: GuardInput): GuardDecision {
  if (!input.active) {
    return { allow: true, reason: 'no active harness run' };
  }
  const root = normalizePath(input.projectRoot).replace(/\/$/, '');
  const target = normalizePath(input.filePath);
  const relative = target.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? target.slice(root.length + 1) : target;
  if (matchesAny(relative, input.protectedPaths, true)) {
    return { allow: false, reason: `${relative} is a protected file: harness agents may not change quality gates, harness files, CI, infra or dependencies during a run` };
  }
  return { allow: true, reason: 'path is not protected' };
}
