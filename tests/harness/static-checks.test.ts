import {
  checkScope,
  findRawErrorThrows,
  findReportsWriteViolations,
  globToRegExp,
  matchesAny,
  normalizePath,
  routesChangedWithoutOpenApi,
} from '../../.harness/tools/static-checks';

describe('paths and globs', () => {
  it('normalises Windows separators and leading ./', () => {
    expect(normalizePath('.\\src\\app.ts')).toBe('src/app.ts');
    expect(normalizePath('./src/app.ts')).toBe('src/app.ts');
  });

  it.each([
    ['src/**', 'src/a/b/c.ts', true],
    ['src/**', 'src/c.ts', true],
    ['src/**', 'tests/c.ts', false],
    ['src/*/*.routes.ts', 'src/activities/activities.routes.ts', true],
    ['src/*/*.routes.ts', 'src/activities/deep/activities.routes.ts', false],
    ['.harness/agents/**', '.harness/agents/planner.agent.md', true],
    ['.github/**', '.github/workflows/ci-cd.yml', true],
    ['docs/openapi.yaml', 'docs/openapi.yaml', true],
    ['docs/openapi.yaml', 'docs/openapiXyaml', false],
    ['CLAUDE.md', 'CLAUDE.md', true],
    ['**/x.ts', 'a/b/x.ts', true],
    ['**/x.ts', 'x.ts', true],
    ['a?b', 'a?b', true],
    ['a?b', 'axb', false],
    ['a+(b)', 'a+(b)', true],
  ])('glob %s vs %s -> %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });

  it('matches case-insensitively only when asked (case-insensitive file systems)', () => {
    expect(matchesAny('Jest.Config.js', ['jest.config.js'])).toBe(false);
    expect(matchesAny('Jest.Config.js', ['jest.config.js'], true)).toBe(true);
    expect(globToRegExp('SRC/**', true).test('src/a.ts')).toBe(true);
  });

  it('matchesAny normalises before matching', () => {
    expect(matchesAny('.\\tests\\x.test.ts', ['tests/**'])).toBe(true);
    expect(matchesAny('infra/main.bicep', ['tests/**', 'src/**'])).toBe(false);
  });
});

describe('findRawErrorThrows (failure mode 2)', () => {
  const file = (content: string) => [{ path: 'src\\x\\x.service.ts', content }];

  it('finds raw Error-family throws with file and line', () => {
    const findings = findRawErrorThrows(
      file(['const a = 1;', 'throw new Error("boom");', '  throw new TypeError("t")', 'throw  new   RangeError(1)', 'throw new SyntaxError("s")'].join('\n')),
    );
    expect(findings.map((f) => `${f.file}:${f.line}`)).toEqual(['src/x/x.service.ts:2', 'src/x/x.service.ts:3', 'src/x/x.service.ts:4', 'src/x/x.service.ts:5']);
    expect(findings[0]?.text).toBe('throw new Error("boom");');
  });

  it('accepts typed AppError subclasses, rethrows, and comments', () => {
    const clean = ['throw new NotFoundError("Task");', 'throw new ValidationError();', 'throw error;', '// throw new Error("example in a comment")', ' * throw new Error("jsdoc")', 'class ConfigurationError extends Error {}'].join('\n');
    expect(findRawErrorThrows(file(clean))).toEqual([]);
  });

  it('does not confuse names that merely start with Error', () => {
    expect(findRawErrorThrows(file('throw new ErrorBoundaryThing();'))).toEqual([]);
  });
});

describe('findReportsWriteViolations (reports is read-only)', () => {
  const port = (body: string) => [{ path: 'src/reports/reports.ports.ts', content: `export interface TaskStatsReader {\n${body}\n}` }];

  it('accepts read-only methods', () => {
    expect(
      findReportsWriteViolations(
        port(['  getStoreStats(storeId: string): Promise<X>;', '  findTask(id: string): Promise<Y | null>;', '  listTasks(): Promise<Y[]>;', '  countByStatus(): Promise<number>;', '  summarizeRegion(id: string): Promise<Z>;', '  summarise(): Promise<Z>;', '  readonly readAll(): Promise<Z>;'].join('\n')),
      ),
    ).toEqual([]);
  });

  it('flags every mutating method with its line', () => {
    const findings = findReportsWriteViolations(
      port(['  getStoreStats(storeId: string): Promise<X>;', '  updateTask(id: string): Promise<void>;', '  deleteTask(id: string): Promise<void>;', '  save<T>(item: T): Promise<T>;'].join('\n')),
    );
    expect(findings.map((f) => [f.line, f.text])).toEqual([
      [3, 'updateTask(id: string): Promise<void>;'],
      [4, 'deleteTask(id: string): Promise<void>;'],
      [5, 'save<T>(item: T): Promise<T>;'],
    ]);
  });

  it('ignores lines that are not interface members', () => {
    expect(findReportsWriteViolations([{ path: 'p.ts', content: 'import type { A } from "./a";\nexport const x = foo(1);\n' }])).toEqual([]);
  });
});

describe('checkScope (gate integrity)', () => {
  const allowed = ['src/**', 'tests/**', 'docs/openapi.yaml'];
  const protectedGlobs = ['jest.config.js', '.harness/**', 'tests/harness/**', 'package.json'];

  it('accepts changes inside the allowed scope', () => {
    expect(checkScope(['src/activities/a.ts', 'tests/activities/a.test.ts', 'docs/openapi.yaml'], allowed, protectedGlobs)).toEqual({ protectedTouched: [], outOfScope: [], hasCodeChange: true });
  });

  it('flags protected files, even when they would otherwise be allowed', () => {
    const result = checkScope(['tests/harness/x.test.ts', 'jest.config.js', 'package.json', '.harness/config/evaluation.json'], allowed, protectedGlobs);
    expect(result.protectedTouched).toEqual(['tests/harness/x.test.ts', 'jest.config.js', 'package.json', '.harness/config/evaluation.json']);
    expect(result.outOfScope).toEqual([]);
  });

  it('flags unprotected files outside the allowed scope', () => {
    expect(checkScope(['README.md', 'docs/other.md', 'src/a.ts'], allowed, protectedGlobs)).toEqual({ protectedTouched: [], outOfScope: ['README.md', 'docs/other.md'], hasCodeChange: true });
  });

  it('reports that a sprint with no changes at all produced no code', () => {
    expect(checkScope([], allowed, protectedGlobs)).toEqual({ protectedTouched: [], outOfScope: [], hasCodeChange: false });
  });

  it('only src/ and tests/ count as code: OpenAPI, protected and out-of-scope files alone do not', () => {
    expect(checkScope(['docs/openapi.yaml'], allowed, protectedGlobs).hasCodeChange).toBe(false);
    expect(checkScope(['README.md', 'jest.config.js'], allowed, protectedGlobs).hasCodeChange).toBe(false);
    expect(checkScope(['tests/harness/x.test.ts'], allowed, protectedGlobs).hasCodeChange).toBe(false);
    expect(checkScope(['tests/a/a.test.ts'], allowed, protectedGlobs).hasCodeChange).toBe(true);
    expect(checkScope(['src/a.ts'], allowed, protectedGlobs).hasCodeChange).toBe(true);
  });
});

describe('routesChangedWithoutOpenApi', () => {
  it('flags route changes without the contract', () => {
    expect(routesChangedWithoutOpenApi(['src/activities/activities.routes.ts', 'src/activities/activities.service.ts'])).toEqual(['src/activities/activities.routes.ts']);
  });

  it('is satisfied when the contract changed too, or no route changed', () => {
    expect(routesChangedWithoutOpenApi(['src/activities/activities.routes.ts', 'docs/openapi.yaml'])).toEqual([]);
    expect(routesChangedWithoutOpenApi(['src/activities/activities.service.ts'])).toEqual([]);
    expect(routesChangedWithoutOpenApi([])).toEqual([]);
  });
});
