/**
 * Integrity helpers: every result file is bound to the sprint and iteration it belongs to, the Evaluator's JSON is validated
 * strictly, and the working tree is fingerprinted so an Evaluator that edits code between "checks" and "verdict" is detected.
 */
import { createHash } from 'node:crypto';
import type { CheckResult, VerdictReport } from './evaluation';

export interface Stamp {
  readonly sprint: number;
  readonly iteration: number;
}

export type StampedReport = VerdictReport & Stamp & { readonly generatedAt: string };

export interface LlmResultsFile extends Stamp {
  readonly results: CheckResult[];
}

const RESULT_VALUES = new Set(['PASS', 'FAIL', 'UNSURE']);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** Validates llm-results.json: `{ "sprint": n, "iteration": n, "results": [{ "id", "result", "evidence": [] }] }`. */
export function parseLlmResults(raw: unknown): LlmResultsFile {
  if (!isRecord(raw)) {
    throw new Error('llm-results.json must be an object: { "sprint": n, "iteration": n, "results": [...] }');
  }
  const { sprint, iteration, results } = raw;
  if (!isCount(sprint) || !isCount(iteration)) {
    throw new Error('llm-results.json needs integer "sprint" and "iteration" fields (the sprint and iteration you are evaluating)');
  }
  if (!Array.isArray(results)) {
    throw new Error('llm-results.json needs a "results" array');
  }
  const parsed = results.map((entry: unknown, index): CheckResult => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.trim() === '') {
      throw new Error(`llm-results.json results[${index}] needs a non-empty string "id"`);
    }
    if (typeof entry.result !== 'string' || !RESULT_VALUES.has(entry.result)) {
      throw new Error(`llm-results.json ${entry.id}: "result" must be exactly PASS, FAIL or UNSURE (got ${JSON.stringify(entry.result)})`);
    }
    if (!Array.isArray(entry.evidence) || !entry.evidence.every((line: unknown) => typeof line === 'string')) {
      throw new Error(`llm-results.json ${entry.id}: "evidence" must be an array of strings`);
    }
    return { id: entry.id, result: entry.result as CheckResult['result'], evidence: entry.evidence };
  });
  return { sprint, iteration, results: parsed };
}

/** Refuses a result file that belongs to a different sprint or iteration than the run is on (stale or replayed). */
export function assertStamp(label: string, actual: Stamp, expected: Stamp): void {
  if (actual.sprint !== expected.sprint || actual.iteration !== expected.iteration) {
    throw new Error(
      `${label} is for sprint ${actual.sprint}, iteration ${actual.iteration} but the run is on sprint ${expected.sprint}, iteration ${expected.iteration}. ` +
        'It is stale or from another attempt: re-run the previous step.',
    );
  }
}

export interface FingerprintEntry {
  readonly path: string;
  /** File content, or null when the file was deleted. */
  readonly content: string | null;
}

/** Order-independent SHA-256 over the changed files' paths and contents. Any edit, addition or deletion changes it. */
export function fingerprint(entries: readonly FingerprintEntry[]): string {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(`${entry.path}\u0000${entry.content ?? '<deleted>'}\u0000`);
  }
  return hash.digest('hex');
}
