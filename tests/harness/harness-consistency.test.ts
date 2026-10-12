import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import rawConfig from '../../.harness/config/evaluation.json';
import type { EvaluationConfig } from '../../.harness/tools/evaluation';

const config = rawConfig as unknown as EvaluationConfig;
const root = join(__dirname, '..', '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const agents = ['planner', 'generator', 'evaluator', 'monitor'] as const;
const skillNames = readdirSync(join(root, '.harness', 'skills'));
const packageScripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;

describe('skills', () => {
  it('there are at least six, each a SKILL.md in its own folder with matching front matter', () => {
    expect(skillNames.length).toBeGreaterThanOrEqual(6);
    for (const name of skillNames) {
      const text = read(`.harness/skills/${name}/SKILL.md`);
      expect(text).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n---\\n`));
      expect(text.length).toBeGreaterThan(1500);
      expect(text.length).toBeLessThan(14000); // cost-awareness: a skill is a page or two, not a book
    }
  });

  it('covers the required shared, generator-specific and evaluator-specific roles', () => {
    expect(skillNames).toEqual(expect.arrayContaining(['app-context', 'architecture-principles']));
    expect(['coding-conventions', 'how-to-test', 'feature-playbook'].filter((s) => skillNames.includes(s)).length).toBeGreaterThanOrEqual(2);
    expect(['how-to-review', 'grading-criteria'].filter((s) => skillNames.includes(s)).length).toBeGreaterThanOrEqual(2);
  });

  it('every skill referenced by the config exists', () => {
    for (const { skills } of Object.values(config.context)) {
      for (const skill of skills) {
        expect(skillNames).toContain(skill);
      }
    }
    for (const check of config.checks) {
      expect(skillNames).toContain(check.skill);
    }
  });

  it('every skill is used by at least one agent (no file without a job)', () => {
    const used = new Set(Object.values(config.context).flatMap((c) => c.skills));
    for (const name of skillNames) {
      expect(used).toContain(name);
    }
  });
});

describe('agent definitions', () => {
  it.each(agents)('%s.agent.md states responsibility, reads, output and exclusions, and names each of its skills', (agent) => {
    const text = read(`.harness/agents/${agent}.agent.md`);
    expect(text).toMatch(/^## Responsibility$/m);
    expect(text).toMatch(/^## Reads before acting/m);
    expect(text).toMatch(/^## Output \(handoff\)$/m);
    expect(text).toMatch(/^## Never$/m);
    for (const skill of config.context[agent]?.skills ?? []) {
      expect(text).toContain(`.harness/skills/${skill}/SKILL.md`);
    }
  });

  it('only the listed skills are referenced by each agent', () => {
    for (const agent of agents) {
      const referenced = [...read(`.harness/agents/${agent}.agent.md`).matchAll(/\.harness\/skills\/([a-z-]+)\/SKILL\.md/g)].map((m) => m[1]);
      expect([...new Set(referenced)].sort()).toEqual([...(config.context[agent]?.skills ?? [])].sort());
    }
  });

  it.each(agents)('the %s wrapper points at its definition', (agent) => {
    const text = read(`.claude/agents/${agent}.md`);
    expect(text).toMatch(new RegExp(`^---\\nname: ${agent}\\n`));
    expect(text).toContain(`.harness/agents/${agent}.agent.md`);
    expect(existsSync(join(root, '.harness', 'agents', `${agent}.agent.md`))).toBe(true);
  });

  it('wrappers grant least privilege: the planner cannot edit or run commands, the evaluator cannot edit', () => {
    const tools = (agent: string): string[] =>
      (/^tools: (.+)$/m.exec(read(`.claude/agents/${agent}.md`))?.[1] ?? '').split(',').map((tool) => tool.trim());
    expect(tools('planner')).not.toEqual(expect.arrayContaining(['Bash']));
    expect(tools('planner')).not.toContain('Edit');
    expect(tools('evaluator')).not.toContain('Edit');
    expect(tools('generator')).toEqual(expect.arrayContaining(['Edit', 'Write', 'Bash']));
  });
});

describe('grading-criteria and how-to-review mirror the config', () => {
  const grading = read('.harness/skills/grading-criteria/SKILL.md');

  it.each(config.checks.map((check) => [check.id, check.hard, check.kind] as const))('%s is documented with the right gate and kind', (id, hard, kind) => {
    const row = grading.split('\n').find((line) => line.startsWith(`| ${id} |`));
    expect(row).toBeDefined();
    expect(row?.includes('**HARD**')).toBe(hard);
    expect(row).toContain(`| ${kind} |`);
  });

  it('states the same thresholds, weights and iteration limit as the config', () => {
    expect(grading).toContain(`**${config.thresholds.pass}**`);
    expect(grading).toContain(`**${config.thresholds.conditionalPass}**`);
    expect(grading).toContain(`**${config.maxIterations} iterations**`);
    for (const dimension of config.dimensions) {
      expect(grading).toContain(`(${dimension.weight}%)`);
    }
  });

  it('how-to-review names every LLM-assessed check', () => {
    const review = read('.harness/skills/how-to-review/SKILL.md');
    for (const check of config.checks.filter((c) => c.kind === 'llm')) {
      expect(review).toContain(check.id);
    }
  });

  it('the evaluator agent lists every LLM-assessed check', () => {
    const evaluator = read('.harness/agents/evaluator.agent.md');
    for (const check of config.checks.filter((c) => c.kind === 'llm')) {
      expect(evaluator).toContain(check.id);
    }
  });
});

describe('orchestrator (CLAUDE.md)', () => {
  const claude = read('CLAUDE.md');

  it('defines entry format, approval protocol, routing, iteration limit, escalation output and context strategy', () => {
    for (const phrase of ['@planner', 'AWAITING APPROVAL', 'APPROVED', 'ADVANCE', 'RETRY', 'ESCALATE', 'COMPLETE', 'escalation.md', 'fresh context', 'precedes and feeds']) {
      expect(claude).toContain(phrase);
    }
    expect(claude).toContain(`Hard limit: three iterations`);
    expect(config.maxIterations).toBe(3);
  });

  it('references every agent definition and the review archive', () => {
    for (const agent of agents) {
      expect(claude).toContain(`.harness/agents/${agent}.agent.md`);
    }
    expect(claude).toContain('.harness/reviews');
  });

  it('every harness npm script it mentions exists', () => {
    const mentioned = [...claude.matchAll(/npm run (harness:[a-z]+)/g)].map((m) => m[1] ?? '');
    expect(mentioned.length).toBeGreaterThanOrEqual(2);
    for (const script of mentioned) {
      expect(packageScripts).toHaveProperty([script]);
    }
  });

  it('the write guard hook is configured and points at the CLI', () => {
    const settings = JSON.parse(read('.claude/settings.json')) as { hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] } };
    const [entry] = settings.hooks.PreToolUse;
    expect(entry?.matcher).toContain('Edit');
    expect(entry?.matcher).toContain('Write');
    expect(entry?.hooks[0]?.command).toContain('.harness/tools/cli.ts guard');
  });
});

describe('config and templates', () => {
  it('protects the harness, gates and manifests, and allows only src, tests and the OpenAPI file', () => {
    for (const path of ['jest.config.js', 'eslint.config.mjs', '.dependency-cruiser.cjs', 'package.json', 'CLAUDE.md', '.github/**', 'infra/**', '.harness/skills/**', 'tests/harness/**']) {
      expect(config.protectedPaths).toContain(path);
    }
    expect(config.allowedPaths).toEqual(['src/**', 'tests/**', 'docs/openapi.yaml']);
  });

  it('every protected file or folder that exists is real (no typos in the guard list)', () => {
    for (const glob of config.protectedPaths) {
      const base = glob.replace(/\/\*\*$/, '');
      expect(existsSync(join(root, base))).toBe(true);
    }
  });

  it.each(['spec.md', 'sprint-contract.md', 'generator-summary.md'])('template %s exists with its machine-readable markers', (name) => {
    const text = read(`.harness/templates/${name}`);
    const marker = { 'spec.md': 'STATUS: AWAITING APPROVAL', 'sprint-contract.md': 'STATUS: READY', 'generator-summary.md': 'GENERATOR_STATUS: COMPLETE' }[name];
    expect(text.split('\n')[0] === marker || text.includes(`\n${marker}\n`)).toBe(true);
  });

  it('the harness scripts exist in package.json', () => {
    for (const script of ['harness:init', 'harness:checks', 'harness:verdict', 'harness:route', 'harness:runlog', 'harness:trends']) {
      expect(packageScripts).toHaveProperty([script]);
    }
  });
});

describe('integrity rules stay documented where the agents will read them', () => {
  const review = read('.harness/skills/how-to-review/SKILL.md');
  const grading = read('.harness/skills/grading-criteria/SKILL.md');
  const claude = read('CLAUDE.md');

  it('how-to-review shows the stamped llm-results.json format and the "does not apply" rule', () => {
    expect(review).toContain('"sprint"');
    expect(review).toContain('"iteration"');
    expect(review).toContain('"results"');
    expect(review).toContain('When a criterion does not apply');
    expect(review).toContain('change nothing in the repository');
  });

  it('every LLM hard gate that a domain-only sprint may not touch defines its not-applicable PASS in the config', () => {
    for (const id of ['ARCH-04', 'ARCH-06', 'SEC-04', 'SEC-05', 'SEC-06']) {
      const criterion = config.checks.find((check) => check.id === id)?.criterion ?? '';
      expect(criterion).toContain('PASS with evidence');
      expect(criterion).toContain('What changed');
    }
  });

  it('grading-criteria and CLAUDE.md state that results are bound to an attempt and consumed', () => {
    expect(grading).toContain('bound');
    expect(grading).toContain('consumed');
    expect(grading).toContain('There is no `N/A`');
    expect(claude).toContain('bound to one attempt');
    expect(claude).toContain('re-invoke the evaluator for the same sprint and iteration');
  });

  it('GOV-01 documents the no-code-change and tree-stability rules in both places', () => {
    const gov = config.checks.find((check) => check.id === 'GOV-01')?.criterion ?? '';
    expect(gov).toContain('at least one file under src/ or tests/ changed');
    expect(gov).toContain('did not change between');
    expect(grading).toContain('did not change between the checks and the verdict');
  });

  it('the ESLint raw-error rule covers every form the static check ARCH-02 covers', () => {
    const eslint = read('eslint.config.mjs');
    expect(eslint).toContain('ThrowStatement > NewExpression');
    expect(eslint).toContain('ThrowStatement > CallExpression');
    expect(eslint).toContain("callee.property.name='reject'");
    expect(eslint).toContain('superClass.name');
    expect(eslint).toContain("files: ['src/shared/errors.ts']");
  });
});
