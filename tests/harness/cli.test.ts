/**
 * End-to-end tests of the harness command line against a throwaway git repository.
 * They exercise the I/O layer (cli.ts) that the pure-module tests cannot: stamping, stale-file refusal,
 * consumption of results, tamper detection, per-iteration archiving and loud failure when git is unusable.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint } from '../../.harness/tools/binding';
import rawConfig from '../../.harness/config/evaluation.json';
import type { CheckResult, EvaluationConfig } from '../../.harness/tools/evaluation';

const config = rawConfig as unknown as EvaluationConfig;
const repoRoot = join(__dirname, '..', '..');
const cliPath = join(repoRoot, '.harness', 'tools', 'cli.ts');

let dir: string;

function git(...args: string[]): void {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function cli(command: string, ...args: string[]): { status: number; stdout: string; stderr: string } {
  // Launched from the repository (so `tsx` resolves) and pointed at the throwaway repo through CLAUDE_PROJECT_DIR.
  const result = spawnSync(process.execPath, ['--import', 'tsx', cliPath, command, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

const out = (name: string): string => join(dir, '.harness', 'output', name);
const writeOut = (name: string, content: string): void => {
  mkdirSync(join(dir, '.harness', 'output'), { recursive: true });
  writeFileSync(out(name), content);
};
const readOut = (name: string): Record<string, unknown> => JSON.parse(readFileSync(out(name), 'utf8')) as Record<string, unknown>;

const autoResults = (): CheckResult[] => config.checks.filter((c) => c.kind === 'auto').map((c) => ({ id: c.id, result: 'PASS', evidence: ['ok'] }));
const llmResults = (sprint: number, iteration: number, overrides: Record<string, 'PASS' | 'FAIL'> = {}) => ({
  sprint,
  iteration,
  results: config.checks.filter((c) => c.kind === 'llm').map((c) => ({ id: c.id, result: overrides[c.id] ?? 'PASS', evidence: ['src/x.ts:1 shows it'] })),
});

/** What `harness:checks` would write, for the files currently changed in the temp repo. */
function writeAutomated(sprint: number, iteration: number, changed: { path: string; content: string | null }[], results = autoResults()): void {
  writeOut(
    'automated-results.json',
    JSON.stringify({
      sprint,
      iteration,
      generatedAt: 'now',
      fingerprint: fingerprint(changed),
      changedFiles: changed.map((c) => c.path),
      changeSummary: { routes: [], schemas: [], services: [], repositories: [], ports: [], events: [], wiring: [], contract: [], tests: [], other: [] },
      results,
    }),
  );
}

function startRun(sprints = 2): void {
  writeOut('spec.md', `STATUS: APPROVED\nFEATURE: Demo feature\nSPRINTS: ${sprints}\n`);
  for (let sprint = 1; sprint <= sprints; sprint += 1) {
    writeOut(`sprint-${sprint}-contract.md`, `SPRINT: ${sprint}\nSTATUS: READY\n`);
  }
  expect(cli('init').status).toBe(0);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'harness-cli-'));
  mkdirSync(join(dir, '.harness', 'config'), { recursive: true });
  copyFileSync(join(repoRoot, '.harness', 'config', 'evaluation.json'), join(dir, '.harness', 'config', 'evaluation.json'));
  writeFileSync(join(dir, '.gitignore'), '.harness/output/\n');
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('config', 'core.autocrlf', 'false');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'base.ts'), 'export const base = 1;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'baseline: generated StoreOps scaffold');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('harness init', () => {
  it('creates sprint 1 / iteration 1 state and removes every leftover from earlier runs and trials', () => {
    for (const stale of ['verdict.json', 'automated-results.json', 'llm-results.json', 'evaluator-feedback.md', 'generator-summary.md', 'escalation.md', 'carry-over.md']) {
      writeOut(stale, 'stale');
    }
    mkdirSync(join(dir, '.harness', 'output', 'history'), { recursive: true });
    writeFileSync(join(dir, '.harness', 'output', 'history', 'old.md'), 'old');

    startRun();

    expect(readOut('state.json')).toMatchObject({ sprint: 1, iteration: 1, active: true });
    for (const stale of ['verdict.json', 'automated-results.json', 'llm-results.json', 'evaluator-feedback.md', 'generator-summary.md', 'escalation.md', 'carry-over.md']) {
      expect(existsSync(out(stale))).toBe(false);
    }
    expect(existsSync(out('history'))).toBe(false);
    expect(existsSync(out('spec.md'))).toBe(true);
  });

  it('refuses a spec that is not approved, or has a missing contract', () => {
    writeOut('spec.md', 'STATUS: AWAITING APPROVAL\nFEATURE: x\nSPRINTS: 1\n');
    expect(cli('init')).toMatchObject({ status: 1, stderr: expect.stringContaining('not APPROVED') });
    writeOut('spec.md', 'STATUS: APPROVED\nFEATURE: x\nSPRINTS: 2\n');
    writeOut('sprint-1-contract.md', 'x');
    expect(cli('init').stderr).toContain('missing .harness/output/sprint-2-contract.md');
  });
});

describe('harness verdict', () => {
  const changed = [{ path: 'src/new.ts', content: 'export const n = 1;\n' }];

  beforeEach(() => {
    writeFileSync(join(dir, 'src', 'new.ts'), 'export const n = 1;\n');
  });

  it('computes PASS when every check passes, stamps verdict.json and writes feedback with the change summary', () => {
    startRun();
    writeAutomated(1, 1, changed);
    writeOut('llm-results.json', JSON.stringify(llmResults(1, 1)));

    const result = cli('verdict');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('VERDICT: PASS');
    expect(readOut('verdict.json')).toMatchObject({ sprint: 1, iteration: 1, verdict: 'PASS' });
    expect(readFileSync(out('evaluator-feedback.md'), 'utf8').split('\n')[0]).toBe('VERDICT: PASS');
  });

  it('refuses automated results from another iteration (stale or replayed)', () => {
    startRun();
    writeAutomated(1, 2, changed);
    writeOut('llm-results.json', JSON.stringify(llmResults(1, 1)));
    const result = cli('verdict');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/automated-results\.json is for sprint 1, iteration 2 but the run is on sprint 1, iteration 1/);
    expect(existsSync(out('verdict.json'))).toBe(false);
  });

  it('refuses Evaluator results written for another sprint', () => {
    startRun();
    writeAutomated(1, 1, changed);
    writeOut('llm-results.json', JSON.stringify(llmResults(2, 1)));
    expect(cli('verdict').stderr).toMatch(/llm-results\.json is for sprint 2, iteration 1/);
  });

  it('rejects malformed Evaluator JSON with a clear message instead of guessing', () => {
    startRun();
    writeAutomated(1, 1, changed);
    writeOut('llm-results.json', JSON.stringify([{ id: 'COR-04', result: 'PASS', evidence: ['x'] }]));
    expect(cli('verdict').stderr).toContain('llm-results.json must be an object');
    writeOut('llm-results.json', JSON.stringify({ sprint: 1, iteration: 1, results: [{ id: 'COR-04', result: 'MAYBE', evidence: ['x'] }] }));
    expect(cli('verdict').stderr).toContain('must be exactly PASS, FAIL or UNSURE');
  });

  it('fails closed when the Evaluator reports nothing: every LLM check is missing, so the hard ones fail the sprint', () => {
    startRun();
    writeAutomated(1, 1, changed);
    const result = cli('verdict');
    expect(result.stdout).toContain('VERDICT: FAIL');
    expect(result.stdout).toContain('HARD_GATE_FAILURES: ARCH-04,COR-04,SEC-04');
  });

  it('fails GOV-01 when the working tree changed after the automated checks ran (an Evaluator that edits code is caught)', () => {
    startRun();
    writeAutomated(1, 1, changed);
    writeOut('llm-results.json', JSON.stringify(llmResults(1, 1)));
    writeFileSync(join(dir, 'src', 'new.ts'), 'export const n = 2; // edited after the checks\n');

    const result = cli('verdict');

    expect(result.stdout).toContain('VERDICT: FAIL');
    expect(result.stdout).toContain('HARD_GATE_FAILURES: GOV-01');
    expect(readFileSync(out('evaluator-feedback.md'), 'utf8')).toContain('changed after `npm run harness:checks` ran');
  });

  it('also catches a new file added after the checks', () => {
    startRun();
    writeAutomated(1, 1, changed);
    writeOut('llm-results.json', JSON.stringify(llmResults(1, 1)));
    writeFileSync(join(dir, 'src', 'sneaky.ts'), 'export const s = 1;\n');
    expect(cli('verdict').stdout).toContain('HARD_GATE_FAILURES: GOV-01');
  });

  it('works outside a run (no state.json) for agent trials, binding nothing', () => {
    writeAutomated(0, 0, changed);
    writeOut('llm-results.json', JSON.stringify(llmResults(1, 1)));
    expect(cli('verdict').stdout).toContain('VERDICT: PASS');
  });

  it('says what to do when the automated results do not exist', () => {
    startRun();
    expect(cli('verdict').stderr).toContain('Run `npm run harness:checks` first');
  });

  it('fails loudly, never as "nothing changed", when git has no baseline commit', () => {
    rmSync(join(dir, '.git'), { recursive: true, force: true });
    git('init', '-q', '-b', 'main');
    writeAutomated(0, 0, changed);
    const result = cli('verdict');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/git diff --name-only HEAD failed/);
    expect(result.stderr).toContain('at least one baseline commit');
  });
});

describe('harness route', () => {
  const changed = [{ path: 'src/new.ts', content: 'export const n = 1;\n' }];

  function produceVerdict(sprint: number, iteration: number, llm = llmResults(sprint, iteration)): void {
    writeAutomated(sprint, iteration, changed);
    writeOut('llm-results.json', JSON.stringify(llm));
    expect(cli('verdict').status).toBe(0);
  }

  beforeEach(() => {
    writeFileSync(join(dir, 'src', 'new.ts'), 'export const n = 1;\n');
    startRun();
  });

  it('advances on PASS, archives the attempt, and consumes the result files so they cannot be routed twice', () => {
    writeOut('generator-summary.md', 'GENERATOR_STATUS: COMPLETE\nSPRINT: 1\nITERATION: 1\n');
    produceVerdict(1, 1);

    const first = cli('route');

    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ action: 'ADVANCE', sprint: 2, iteration: 1 });
    for (const consumed of ['verdict.json', 'automated-results.json', 'llm-results.json']) {
      expect(existsSync(out(consumed))).toBe(false);
    }
    expect(readdirSync(out('history')).sort()).toEqual([
      'sprint-1-iter-1-evaluator-feedback.md',
      'sprint-1-iter-1-generator-summary.md',
      'sprint-1-iter-1-verdict.json',
    ]);

    const second = cli('route');
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('no verdict to route');
    expect(readOut('state.json').sprint).toBe(2);
  });

  it('refuses a verdict that belongs to an earlier attempt (the Evaluator crashed before producing a new one)', () => {
    produceVerdict(1, 1);
    // Simulate a crash: sprint 1's verdict is routed, then (somehow) an old verdict file reappears for a state that moved on.
    const stale = readFileSync(out('verdict.json'), 'utf8');
    expect(cli('route').status).toBe(0);
    writeOut('verdict.json', stale);
    writeOut('evaluator-feedback.md', 'VERDICT: PASS\n');
    const replay = cli('route');
    expect(replay.status).toBe(1);
    expect(replay.stderr).toMatch(/verdict\.json is for sprint 1, iteration 1 but the run is on sprint 2, iteration 1/);
    expect(readOut('state.json').sprint).toBe(2);
  });

  it('refuses to route a FAIL until the Evaluator has written actionable feedback, and keeps everything for a retry', () => {
    produceVerdict(1, 1, llmResults(1, 1, { 'COR-04': 'FAIL' }));
    const refused = cli('route');
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('placeholder');
    expect(existsSync(out('verdict.json'))).toBe(true);
    expect(readOut('state.json').iteration).toBe(1);

    const feedback = readFileSync(out('evaluator-feedback.md'), 'utf8').replace(/<!-- EVALUATOR:.*-->/, '- COR-04 tests/a.test.ts:3 asserts only the status. Fix: assert the stored status.');
    writeFileSync(out('evaluator-feedback.md'), feedback);
    expect(JSON.parse(cli('route').stdout)).toMatchObject({ action: 'RETRY', iteration: 2 });
  });

  it('keeps every iteration (FAIL, FAIL, then escalation) and writes escalation.md; runlog archives them all', () => {
    for (const iteration of [1, 2, 3]) {
      writeOut('generator-summary.md', `GENERATOR_STATUS: COMPLETE\nITERATION: ${iteration}\n`);
      produceVerdict(1, iteration, llmResults(1, iteration, { 'COR-04': 'FAIL' }));
      const feedback = readFileSync(out('evaluator-feedback.md'), 'utf8').replace(/<!-- EVALUATOR:.*-->/, `- COR-04 attempt ${iteration}`);
      writeFileSync(out('evaluator-feedback.md'), feedback);
      const decision = JSON.parse(cli('route').stdout) as { action: string };
      expect(decision.action).toBe(iteration < 3 ? 'RETRY' : 'ESCALATE');
    }
    expect(existsSync(out('escalation.md'))).toBe(true);
    expect(readFileSync(out('escalation.md'), 'utf8')).toContain('Iterations used: 3 of 3');
    expect(readOut('state.json')).toMatchObject({ active: false, status: 'ESCALATED' });

    expect(cli('runlog', '1').status).toBe(0);
    const reviews = readdirSync(join(dir, '.harness', 'reviews'));
    for (const iteration of [1, 2, 3]) {
      expect(reviews).toContain(`sprint-1-iter-${iteration}-evaluator-feedback.md`);
      expect(reviews).toContain(`sprint-1-iter-${iteration}-verdict.json`);
      expect(reviews).toContain(`sprint-1-iter-${iteration}-generator-summary.md`);
    }
    expect(reviews).toEqual(expect.arrayContaining(['sprint-1-run-log.md', 'sprint-1-escalation.md', 'spec.md']));
    expect(readFileSync(join(dir, '.harness', 'reviews', 'sprint-1-run-log.md'), 'utf8')).toContain('ESCALATED: true');
  });
});

describe('harness guard', () => {
  it('blocks a protected file during an active run and allows it otherwise', () => {
    const input = JSON.stringify({ tool_input: { file_path: 'jest.config.js' } });
    const guard = (): { status: number; stderr: string } => {
      const result = spawnSync(process.execPath, ['--import', 'tsx', cliPath, 'guard'], { cwd: repoRoot, encoding: 'utf8', input, env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
      return { status: result.status ?? 1, stderr: result.stderr };
    };
    expect(guard().status).toBe(0);
    startRun();
    const blocked = guard();
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain('BLOCKED by harness guard');
  });
});
