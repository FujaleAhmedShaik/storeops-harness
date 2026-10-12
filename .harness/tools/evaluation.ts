import { CHANGE_KINDS, type ChangeSummary } from './static-checks';

/**
 * Deterministic evaluation core. The Evaluator agent supplies per-check results; this module turns them into a
 * verdict. Same results in, same verdict out: there is no model judgement anywhere in this file.
 */

export type Verdict = 'PASS' | 'CONDITIONAL PASS' | 'FAIL';
export type CheckKind = 'auto' | 'llm';

export interface Dimension {
  readonly id: string;
  readonly name: string;
  readonly weight: number;
}

export interface CheckDefinition {
  readonly id: string;
  readonly dimension: string;
  readonly kind: CheckKind;
  readonly hard: boolean;
  readonly runner?: string;
  readonly title: string;
  readonly criterion: string;
  readonly prevents: string;
  readonly skill: string;
}

export interface EvaluationConfig {
  readonly version: number;
  readonly maxIterations: number;
  readonly thresholds: { readonly pass: number; readonly conditionalPass: number };
  readonly dimensions: readonly Dimension[];
  readonly checks: readonly CheckDefinition[];
  readonly allowedPaths: readonly string[];
  readonly protectedPaths: readonly string[];
  readonly context: Readonly<Record<string, { readonly skills: readonly string[] }>>;
}

/** What an auto runner or the Evaluator reports for one check. */
export interface CheckResult {
  readonly id: string;
  readonly result: 'PASS' | 'FAIL' | 'UNSURE';
  readonly evidence: readonly string[];
}

export interface ScoredCheck {
  readonly id: string;
  readonly kind: CheckKind;
  readonly hard: boolean;
  readonly result: 'PASS' | 'FAIL';
  /** Why a reported result was converted to FAIL (fail-closed rules), if it was. */
  readonly reason: string | null;
  readonly evidence: readonly string[];
}

export interface DimensionScore {
  readonly id: string;
  readonly name: string;
  readonly weight: number;
  readonly passed: number;
  readonly total: number;
  readonly score: number;
}

export interface VerdictReport {
  readonly verdict: Verdict;
  readonly score: number;
  readonly hardGateFailures: readonly string[];
  readonly failedChecks: readonly string[];
  readonly dimensions: readonly DimensionScore[];
  readonly checks: readonly ScoredCheck[];
  readonly unknownResults: readonly string[];
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Structural problems in the evaluation config itself. An empty list means the config is sound. */
export function validateConfig(config: EvaluationConfig): string[] {
  const problems: string[] = [];
  const weightSum = config.dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  if (weightSum !== 100) {
    problems.push(`dimension weights sum to ${weightSum}, expected 100`);
  }
  const ids = config.checks.map((check) => check.id);
  for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) {
    problems.push(`duplicate check id ${id}`);
  }
  for (const check of config.checks) {
    if (!config.dimensions.some((dimension) => dimension.id === check.dimension)) {
      problems.push(`${check.id} references unknown dimension ${check.dimension}`);
    }
    if (check.kind === 'auto' && !check.runner) {
      problems.push(`${check.id} is auto but has no runner`);
    }
    if (check.kind === 'llm' && check.runner) {
      problems.push(`${check.id} is llm but declares a runner`);
    }
  }
  for (const dimension of config.dimensions) {
    const hasAutomatedHardGate = config.checks.some(
      (check) => check.dimension === dimension.id && check.kind === 'auto' && check.hard,
    );
    if (!hasAutomatedHardGate) {
      problems.push(`dimension ${dimension.id} has no automated hard gate`);
    }
  }
  if (config.thresholds.conditionalPass >= config.thresholds.pass) {
    problems.push('conditionalPass threshold must be below the pass threshold');
  }
  return problems;
}

function score(definition: CheckDefinition, reported: readonly CheckResult[]): ScoredCheck {
  const base = { id: definition.id, kind: definition.kind, hard: definition.hard };
  if (reported.length === 0) {
    return { ...base, result: 'FAIL', reason: 'no result reported (fail-closed)', evidence: [] };
  }
  if (reported.length > 1) {
    return { ...base, result: 'FAIL', reason: 'conflicting duplicate results (fail-closed)', evidence: reported.flatMap((r) => r.evidence) };
  }
  const [only] = reported;
  if (!only) {
    return { ...base, result: 'FAIL', reason: 'no result reported (fail-closed)', evidence: [] };
  }
  const value: string = only.result;
  if (value !== 'PASS' && value !== 'FAIL' && value !== 'UNSURE') {
    return { ...base, result: 'FAIL', reason: `invalid result value ${JSON.stringify(value)}: only PASS, FAIL or UNSURE are accepted (fail-closed)`, evidence: [] };
  }
  if (value === 'UNSURE') {
    return { ...base, result: 'FAIL', reason: 'result was UNSURE (fail-closed)', evidence: only.evidence };
  }
  if (only.result === 'PASS' && definition.kind === 'llm' && only.evidence.every((line) => line.trim() === '')) {
    return { ...base, result: 'FAIL', reason: 'PASS without evidence (fail-closed)', evidence: [] };
  }
  return { ...base, result: value === 'PASS' ? 'PASS' : 'FAIL', reason: null, evidence: only.evidence };
}

/**
 * Pure verdict function.
 *  1. Missing, duplicate, UNSURE or evidence-free (LLM) results become FAIL.
 *  2. Any failed hard gate => FAIL, regardless of score.
 *  3. Otherwise score = sum(weight x passed/total per dimension): >= pass => PASS, >= conditionalPass => CONDITIONAL PASS, else FAIL.
 */
export function computeVerdict(config: EvaluationConfig, results: readonly CheckResult[]): VerdictReport {
  const checks = config.checks.map((definition) =>
    score(
      definition,
      results.filter((result) => result.id === definition.id),
    ),
  );
  const dimensions = config.dimensions.map((dimension) => {
    const inDimension = checks.filter((check) => config.checks.find((c) => c.id === check.id)?.dimension === dimension.id);
    const passed = inDimension.filter((check) => check.result === 'PASS').length;
    const total = inDimension.length;
    return { id: dimension.id, name: dimension.name, weight: dimension.weight, passed, total, score: total === 0 ? 0 : (dimension.weight * passed) / total };
  });
  const total = round1(dimensions.reduce((sum, dimension) => sum + dimension.score, 0));
  const hardGateFailures = checks.filter((check) => check.hard && check.result === 'FAIL').map((check) => check.id);

  let verdict: Verdict;
  if (hardGateFailures.length > 0) {
    verdict = 'FAIL';
  } else if (total >= config.thresholds.pass) {
    verdict = 'PASS';
  } else if (total >= config.thresholds.conditionalPass) {
    verdict = 'CONDITIONAL PASS';
  } else {
    verdict = 'FAIL';
  }

  const known = new Set(config.checks.map((check) => check.id));
  return {
    verdict,
    score: total,
    hardGateFailures,
    failedChecks: checks.filter((check) => check.result === 'FAIL').map((check) => check.id),
    dimensions: dimensions.map((dimension) => ({ ...dimension, score: round1(dimension.score) })),
    checks,
    unknownResults: [...new Set(results.map((result) => result.id).filter((id) => !known.has(id)))],
  };
}

/** What changed, by kind, as computed by the tools. Lets the Evaluator cite "no routes changed" as a fact when a criterion does not apply. */
function changeSection(changes: ChangeSummary): string[] {
  return [
    '## What changed (computed by the tools)',
    '',
    '| Kind | Files |',
    '|---|---|',
    ...CHANGE_KINDS.map((kind) => `| ${kind} | ${changes[kind].length === 0 ? 'none' : changes[kind].join(', ')} |`),
    '',
  ];
}

export const FEEDBACK_PLACEHOLDER = '<!-- EVALUATOR: replace this line with the actionable feedback (file:line per failed check) -->';

/** Deterministic part of evaluator-feedback.md. The Evaluator appends actionable feedback below the marker. */
export function renderFeedback(config: EvaluationConfig, report: VerdictReport, sprint: number, iteration: number, changes?: ChangeSummary): string {
  const definition = (id: string): CheckDefinition | undefined => config.checks.find((check) => check.id === id);
  const lines: string[] = [
    `VERDICT: ${report.verdict}`,
    `SCORE: ${report.score.toFixed(1)}`,
    `HARD_GATE_FAILURES: ${report.hardGateFailures.length === 0 ? 'none' : report.hardGateFailures.join(',')}`,
    `SPRINT: ${sprint}`,
    `ITERATION: ${iteration}`,
    '',
    `# Evaluator feedback - sprint ${sprint}, iteration ${iteration}`,
    '',
    `Verdict **${report.verdict}**, score **${report.score.toFixed(1)}** (PASS >= ${config.thresholds.pass}, CONDITIONAL PASS >= ${config.thresholds.conditionalPass}, any hard-gate failure = FAIL).`,
    '',
    ...(changes ? changeSection(changes) : []),
    '## Dimension scores',
    '',
    '| Dimension | Weight | Checks passed | Score |',
    '|---|---|---|---|',
    ...report.dimensions.map((d) => `| ${d.name} | ${d.weight}% | ${d.passed}/${d.total} | ${d.score.toFixed(1)} |`),
    '',
    '## Check results',
    '',
    '| Check | Kind | Gate | Result | Title |',
    '|---|---|---|---|---|',
    ...report.checks.map((c) => `| ${c.id} | ${c.kind} | ${c.hard ? 'HARD' : 'soft'} | ${c.result} | ${definition(c.id)?.title ?? ''} |`),
  ];
  const failed = report.checks.filter((check) => check.result === 'FAIL');
  if (failed.length > 0) {
    lines.push('', '## Failed checks', '');
    for (const check of failed) {
      lines.push(`### ${check.id} - ${definition(check.id)?.title ?? ''} (${check.hard ? 'HARD gate' : 'soft'})`, '');
      lines.push(`Criterion: ${definition(check.id)?.criterion ?? ''}`, '');
      if (check.reason) {
        lines.push(`Converted to FAIL: ${check.reason}`, '');
      }
      lines.push('Evidence:', ...(check.evidence.length === 0 ? ['- (none)'] : check.evidence.map((line) => `- ${line}`)), '');
    }
  }
  if (report.unknownResults.length > 0) {
    lines.push('', `Ignored results for unknown check ids: ${report.unknownResults.join(', ')}`);
  }
  lines.push('', '## Actionable feedback', '', FEEDBACK_PLACEHOLDER, '');
  return lines.join('\n');
}
