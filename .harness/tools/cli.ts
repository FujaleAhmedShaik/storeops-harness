/**
 * Harness command line: the only file in .harness/tools that touches the file system or runs processes.
 * Excluded from coverage like src/index.ts; all decisions live in the pure, unit-tested modules, and
 * tests/harness/cli.test.ts exercises this file end to end against a throwaway git repository.
 *
 *   npx tsx .harness/tools/cli.ts <init|checks|verdict|route|runlog|trends|guard> [args]
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStamp, fingerprint, parseLlmResults, type Stamp, type StampedReport } from './binding';
import { computeVerdict, renderFeedback, type CheckResult, type EvaluationConfig } from './evaluation';
import { estimateSprintTokens, guardDecision, renderRunLog, summarizeTrends, TREND_PLACEHOLDER } from './reporting';
import { initialState, renderEscalation, route, type HarnessState } from './routing';
import {
  checkScope,
  classifyChanges,
  findErrorSubclasses,
  findRawErrorThrows,
  findReportsWriteViolations,
  routesChangedWithoutOpenApi,
  type ChangeSummary,
  type SourceFile,
} from './static-checks';

const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const OUT = join(ROOT, '.harness', 'output');
const REVIEWS = join(ROOT, '.harness', 'reviews');
const HISTORY = join(OUT, 'history');
const CONFIG_PATH = join(ROOT, '.harness', 'config', 'evaluation.json');

/** Files produced during one attempt. They are bound to a sprint and iteration and are consumed by `route`. */
const ATTEMPT_FILES = ['automated-results.json', 'llm-results.json', 'verdict.json'] as const;

interface AutomatedResultsFile extends Stamp {
  readonly generatedAt: string;
  readonly fingerprint: string;
  readonly changedFiles: string[];
  readonly changeSummary: ChangeSummary;
  readonly results: CheckResult[];
}

const read = (path: string): string => readFileSync(path, 'utf8');
const readJson = (path: string): unknown => JSON.parse(read(path));
const write = (path: string, content: string): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
};
const loadConfig = (): EvaluationConfig => readJson(CONFIG_PATH) as EvaluationConfig;
const loadState = (): HarnessState => readJson(join(OUT, 'state.json')) as HarnessState;
const currentState = (): HarnessState | undefined => (existsSync(join(OUT, 'state.json')) ? loadState() : undefined);
const stampOf = (state: HarnessState | undefined): Stamp => ({ sprint: state?.sprint ?? 0, iteration: state?.iteration ?? 0 });
const tail = (text: string, lines: number): string[] => text.trimEnd().split('\n').slice(-lines);

function requireFile(path: string, hint: string): string {
  if (!existsSync(path)) {
    throw new Error(`${path.slice(ROOT.length + 1)} is missing. ${hint}`);
  }
  return path;
}

function run(command: string): { status: number; output: string; stdout: string } {
  const result = spawnSync(command, { cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status ?? 1, output: `${result.stdout}${result.stderr}`, stdout: result.stdout };
}

/** Runs git and fails loudly: a failed git command must never be read as "nothing changed". */
function git(args: string): string {
  const outcome = run(`git ${args}`);
  if (outcome.status !== 0) {
    const reason = outcome.output.trim().split('\n')[0] ?? '';
    throw new Error(`git ${args} failed (${reason}). The harness needs a git repository with at least one baseline commit.`);
  }
  return outcome.stdout;
}

function listFiles(directory: string, suffix: string): string[] {
  const full = join(ROOT, directory);
  if (!existsSync(full)) {
    return [];
  }
  return readdirSync(full, { recursive: true, encoding: 'utf8' })
    .map((entry) => `${directory}/${entry}`.replace(/\\/g, '/'))
    .filter((entry) => entry.endsWith(suffix));
}

const sources = (files: string[]): SourceFile[] => files.map((path) => ({ path, content: read(join(ROOT, path)) }));

/** Files changed in the working tree relative to HEAD, including untracked files. */
function changedFiles(): string[] {
  const tracked = git('diff --name-only HEAD').split('\n');
  const untracked = git('ls-files --others --exclude-standard').split('\n');
  return [...new Set([...tracked, ...untracked].map((line) => line.trim()).filter((line) => line !== ''))];
}

const fingerprintOf = (files: string[]): string =>
  fingerprint(files.map((path) => ({ path, content: existsSync(join(ROOT, path)) ? read(join(ROOT, path)) : null })));

function init(): void {
  const spec = read(requireFile(join(OUT, 'spec.md'), 'Run the Planner first.'));
  if (!/^STATUS: APPROVED$/m.test(spec)) {
    throw new Error('spec.md is not APPROVED yet');
  }
  const sprints = Number(/^SPRINTS: (\d+)$/m.exec(spec)?.[1] ?? 'NaN');
  const feature = /^FEATURE: (.+)$/m.exec(spec)?.[1] ?? '';
  if (!Number.isInteger(sprints) || sprints < 1 || feature === '') {
    throw new Error('spec.md must contain "FEATURE: <title>" and "SPRINTS: <n>" lines');
  }
  for (let sprint = 1; sprint <= sprints; sprint += 1) {
    if (!existsSync(join(OUT, `sprint-${sprint}-contract.md`))) {
      throw new Error(`missing .harness/output/sprint-${sprint}-contract.md`);
    }
  }
  // A new run starts from nothing: leftovers from earlier attempts or trials must never be read as this run's results.
  for (const stale of [...ATTEMPT_FILES, 'evaluator-feedback.md', 'generator-summary.md', 'escalation.md', 'carry-over.md', 'jest.json']) {
    rmSync(join(OUT, stale), { force: true });
  }
  rmSync(HISTORY, { recursive: true, force: true });
  write(join(OUT, 'state.json'), `${JSON.stringify(initialState(feature, sprints), null, 2)}\n`);
  process.stdout.write(`Harness initialised: "${feature}", ${sprints} sprint(s). Sprint 1, iteration 1.\n`);
}

function checks(): void {
  const config = loadConfig();
  const changed = changedFiles();
  const results: CheckResult[] = [];
  let jestRun: { status: number; output: string; failed: number; total: number } | undefined;

  const jest = (): NonNullable<typeof jestRun> => {
    if (!jestRun) {
      mkdirSync(OUT, { recursive: true });
      rmSync(join(OUT, 'jest.json'), { force: true }); // never read a stale report
      const outcome = run('npx jest --coverage --json --outputFile=.harness/output/jest.json');
      const summary = existsSync(join(OUT, 'jest.json'))
        ? (readJson(join(OUT, 'jest.json')) as { numFailedTests: number; numTotalTests: number; numFailedTestSuites: number })
        : { numFailedTests: 1, numTotalTests: 0, numFailedTestSuites: 1 };
      jestRun = { ...outcome, failed: summary.numFailedTests + summary.numFailedTestSuites, total: summary.numTotalTests };
    }
    return jestRun;
  };

  for (const check of config.checks.filter((c) => c.kind === 'auto')) {
    const runner = check.runner ?? '';
    const pass = (evidence: string[]): number => results.push({ id: check.id, result: 'PASS', evidence });
    const fail = (evidence: string[]): number => results.push({ id: check.id, result: 'FAIL', evidence });

    if (runner.startsWith('cmd:')) {
      const outcome = run(runner.slice(4));
      (outcome.status === 0 ? pass : fail)([`${runner.slice(4)} exited ${outcome.status}`, ...tail(outcome.output, 25)]);
    } else if (runner === 'jest:tests') {
      const outcome = jest();
      const evidence = [`${outcome.total} tests, ${outcome.failed} failed test(s)/suite(s)`];
      (outcome.failed === 0 && outcome.total > 0 ? pass : fail)(outcome.failed === 0 ? evidence : [...evidence, ...tail(outcome.output, 25)]);
    } else if (runner === 'jest:coverage') {
      const outcome = jest();
      const thresholdLines = outcome.output.split('\n').filter((line) => /threshold|Coverage summary|Statements|Branches|Functions|Lines/.test(line));
      (outcome.status === 0 ? pass : fail)([`jest exited ${outcome.status}`, ...thresholdLines.slice(0, 20)]);
    } else if (runner === 'static:raw-error-throws') {
      const files = sources(listFiles('src', '.ts'));
      const findings = [
        ...findRawErrorThrows(files).map((f) => `${f.file}:${f.line}: ${f.text}`),
        ...findErrorSubclasses(files).map((f) => `${f.file}:${f.line}: ${f.text}  (a class extending Error outside src/shared/errors.ts)`),
      ];
      (findings.length === 0 ? pass : fail)(findings.length === 0 ? [`no raw Error throws or Error subclasses in ${files.length} source file(s)`] : findings);
    } else if (runner === 'static:reports-readonly') {
      const ports = listFiles('src/reports', '.ports.ts');
      const findings = findReportsWriteViolations(sources(ports));
      (findings.length === 0 ? pass : fail)(findings.length === 0 ? [`checked ${ports.length} reports port file(s): all methods are reads`] : findings.map((f) => `${f.file}:${f.line}: ${f.text}`));
    } else if (runner === 'static:scope') {
      const scope = checkScope(changed, config.allowedPaths, config.protectedPaths);
      const problems = [
        ...scope.protectedTouched.map((f) => `protected file changed: ${f}`),
        ...scope.outOfScope.map((f) => `outside allowed scope: ${f}`),
        ...(scope.hasCodeChange ? [] : ['no file under src/ or tests/ changed: the sprint produced no code']),
      ];
      (problems.length === 0 ? pass : fail)(problems.length === 0 ? [`${changed.length} changed file(s), all within scope`] : problems);
    } else if (runner === 'static:openapi') {
      const missing = routesChangedWithoutOpenApi(changed);
      (missing.length === 0 ? pass : fail)(missing.length === 0 ? ['OpenAPI contract consistent with route changes'] : missing.map((f) => `${f} changed but docs/openapi.yaml did not`));
    } else {
      fail([`unknown runner ${runner}`]);
    }
  }

  // Fingerprint AFTER the commands ran: `verdict` re-computes it, so any later edit (for example by the Evaluator) is detected.
  const finalChanged = changedFiles();
  const stamp = stampOf(currentState());
  const file: AutomatedResultsFile = {
    ...stamp,
    generatedAt: new Date().toISOString(),
    fingerprint: fingerprintOf(finalChanged),
    changedFiles: finalChanged,
    changeSummary: classifyChanges(finalChanged),
    results,
  };
  write(join(OUT, 'automated-results.json'), `${JSON.stringify(file, null, 2)}\n`);
  for (const result of results) {
    process.stdout.write(`${result.id.padEnd(8)} ${result.result}\n`);
  }
  process.stdout.write(`Automated results written to .harness/output/automated-results.json (sprint ${stamp.sprint}, iteration ${stamp.iteration}, ${finalChanged.length} changed files)\n`);
}

function verdict(): void {
  const config = loadConfig();
  const state = currentState();
  const expected = stampOf(state);
  const automated = readJson(requireFile(join(OUT, 'automated-results.json'), 'Run `npm run harness:checks` first.')) as AutomatedResultsFile;
  if (state) {
    assertStamp('automated-results.json', automated, expected);
  }

  let llm: CheckResult[] = [];
  const llmPath = join(OUT, 'llm-results.json');
  if (existsSync(llmPath)) {
    const parsed = parseLlmResults(readJson(llmPath));
    if (state) {
      assertStamp('llm-results.json', parsed, expected);
    }
    llm = parsed.results;
  }

  // The Evaluator reviews; it must not change code. If the tree differs from when the checks ran, GOV-01 fails.
  const unchanged = fingerprintOf(changedFiles()) === automated.fingerprint;
  const toolResults = unchanged
    ? automated.results
    : automated.results.map((r): CheckResult =>
        r.id === 'GOV-01'
          ? { id: 'GOV-01', result: 'FAIL', evidence: ['the working tree changed after `npm run harness:checks` ran: files were edited between the automated checks and the verdict. Only the Generator may change code.'] }
          : r,
      );

  const report = computeVerdict(config, [...toolResults, ...llm]);
  const stamped: StampedReport = { ...report, ...expected, generatedAt: new Date().toISOString() };
  write(join(OUT, 'verdict.json'), `${JSON.stringify(stamped, null, 2)}\n`);
  write(join(OUT, 'evaluator-feedback.md'), renderFeedback(config, report, expected.sprint, expected.iteration, automated.changeSummary));
  process.stdout.write(`VERDICT: ${report.verdict}\nSCORE: ${report.score.toFixed(1)}\nHARD_GATE_FAILURES: ${report.hardGateFailures.join(',') || 'none'}\nFAILED_CHECKS: ${report.failedChecks.join(',') || 'none'}\n`);
}

function routeCommand(): void {
  const config = loadConfig();
  const state = loadState();
  const verdictPath = join(OUT, 'verdict.json');
  if (!existsSync(verdictPath)) {
    throw new Error('no verdict to route: .harness/output/verdict.json is missing. Either the Evaluator has not produced one for this attempt, or it was already routed.');
  }
  const report = readJson(verdictPath) as StampedReport;
  assertStamp('verdict.json', report, { sprint: state.sprint, iteration: state.iteration });
  const feedback = read(requireFile(join(OUT, 'evaluator-feedback.md'), 'Run `npm run harness:verdict` first.'));
  const decision = route(state, report, config.maxIterations, feedback);

  // Keep the evidence of EVERY attempt (the Generator summary is overwritten each iteration, the feedback too).
  const prefix = `sprint-${state.sprint}-iter-${state.iteration}`;
  write(join(HISTORY, `${prefix}-evaluator-feedback.md`), feedback);
  copyFileSync(verdictPath, join(HISTORY, `${prefix}-verdict.json`));
  if (existsSync(join(OUT, 'generator-summary.md'))) {
    copyFileSync(join(OUT, 'generator-summary.md'), join(HISTORY, `${prefix}-generator-summary.md`));
  }
  write(join(OUT, 'state.json'), `${JSON.stringify(decision.state, null, 2)}\n`);
  if (decision.action === 'ESCALATE') {
    write(join(OUT, 'escalation.md'), renderEscalation(decision.state, report, config.maxIterations));
  }
  // Consume the attempt's results so they can never be routed twice or mistaken for the next attempt's.
  for (const consumed of ATTEMPT_FILES) {
    rmSync(join(OUT, consumed), { force: true });
  }
  process.stdout.write(`${JSON.stringify({ action: decision.action, sprint: decision.state.sprint, iteration: decision.state.iteration, message: decision.message })}\n`);
}

const chars = (path: string): number => (existsSync(path) ? read(path).length : 0);

function runlog(sprintArg: string | undefined): void {
  const config = loadConfig();
  const state = loadState();
  const sprint = Number(sprintArg);
  const attempts = state.history.filter((entry) => entry.sprint === sprint);
  const last = attempts[attempts.length - 1];
  if (!Number.isInteger(sprint) || !last) {
    throw new Error(`no history for sprint ${String(sprintArg)}`);
  }
  const skillChars = (agent: string): number =>
    (config.context[agent]?.skills ?? []).reduce((sum, skill) => sum + chars(join(ROOT, '.harness', 'skills', skill, 'SKILL.md')), 0) +
    chars(join(ROOT, '.harness', 'agents', `${agent}.agent.md`));
  const contract = chars(join(OUT, `sprint-${sprint}-contract.md`));
  const summary = chars(join(OUT, 'generator-summary.md'));
  const feedback = chars(join(OUT, 'evaluator-feedback.md'));
  const diff = run('git diff HEAD').output.length;
  const tokens = estimateSprintTokens({
    iterations: attempts.length,
    generatorInputChars: skillChars('generator') + contract + feedback,
    generatorOutputChars: diff + summary,
    evaluatorInputChars: skillChars('evaluator') + contract + summary + diff,
    evaluatorOutputChars: feedback,
  });
  const escalated = state.status === 'ESCALATED' && state.sprint === sprint;
  write(
    join(REVIEWS, `sprint-${sprint}-run-log.md`),
    renderRunLog({ state, sprint, finalVerdict: last.verdict, finalScore: last.score, escalated, estimatedTokens: tokens, date: new Date().toISOString().slice(0, 10) }),
  );

  const archive: [string, string][] = [
    [`sprint-${sprint}-contract.md`, `sprint-${sprint}-contract.md`],
    ['generator-summary.md', `sprint-${sprint}-generator-summary.md`],
    ['evaluator-feedback.md', `sprint-${sprint}-evaluator-feedback.md`],
    ['escalation.md', `sprint-${sprint}-escalation.md`],
    ['spec.md', 'spec.md'],
  ];
  mkdirSync(REVIEWS, { recursive: true });
  for (const [from, to] of archive) {
    if (existsSync(join(OUT, from))) {
      copyFileSync(join(OUT, from), join(REVIEWS, to));
    }
  }
  // Every iteration's feedback, verdict and generator summary: the FAIL-then-PASS story is the audit trail.
  const perAttempt = existsSync(HISTORY) ? readdirSync(HISTORY).filter((name) => name.startsWith(`sprint-${sprint}-iter-`)) : [];
  for (const name of perAttempt) {
    copyFileSync(join(HISTORY, name), join(REVIEWS, name));
  }
  process.stdout.write(
    `Wrote .harness/reviews/sprint-${sprint}-run-log.md and archived the sprint artefacts (${perAttempt.length} per-iteration files). Now replace the trend-notes placeholder.\n`,
  );
}

function trends(): void {
  const config = loadConfig();
  const logs = existsSync(REVIEWS) ? readdirSync(REVIEWS).filter((name) => name.endsWith('-run-log.md')) : [];
  const entries = summarizeTrends(logs.map((name) => read(join(REVIEWS, name))), config);
  process.stdout.write(`Run logs analysed: ${logs.length}\n`);
  if (entries.length === 0) {
    process.stdout.write('No failed checks recorded.\n');
  }
  for (const entry of entries) {
    const recurring = entry.sprintsFailed >= 2 ? '  <-- recurring: review this skill file' : '';
    process.stdout.write(`${entry.checkId}  failed in ${entry.sprintsFailed} sprint(s) [${entry.sprints.join(', ')}]  skill: ${entry.skill}  (${entry.title})${recurring}\n`);
  }
  const unfinished = logs.filter((name) => read(join(REVIEWS, name)).includes(TREND_PLACEHOLDER));
  if (unfinished.length > 0) {
    process.stdout.write(`WARNING: trend notes not written in: ${unfinished.join(', ')}\n`);
    process.exitCode = 1;
  }
}

function guard(): void {
  const input = JSON.parse(readFileSync(0, 'utf8')) as { tool_input?: { file_path?: string; notebook_path?: string } };
  const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  const statePath = join(OUT, 'state.json');
  const active = existsSync(statePath) && loadState().active;
  if (filePath === undefined || !active) {
    return;
  }
  const decision = guardDecision({ active, filePath, projectRoot: ROOT, protectedPaths: loadConfig().protectedPaths });
  if (!decision.allow) {
    process.stderr.write(`BLOCKED by harness guard: ${decision.reason}\n`);
    process.exitCode = 2;
  }
}

const [command, argument] = process.argv.slice(2);
try {
  switch (command) {
    case 'init':
      init();
      break;
    case 'checks':
      checks();
      break;
    case 'verdict':
      verdict();
      break;
    case 'route':
      routeCommand();
      break;
    case 'runlog':
      runlog(argument);
      break;
    case 'trends':
      trends();
      break;
    case 'guard':
      guard();
      break;
    default:
      process.stderr.write('usage: cli.ts <init|checks|verdict|route|runlog|trends|guard> [args]\n');
      process.exitCode = 64;
  }
} catch (error) {
  process.stderr.write(`harness: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
