import { classifyChanges, ERRORS_MODULE, findErrorSubclasses, findRawErrorThrows, maskComments } from '../../.harness/tools/static-checks';

const src = (content: string, path = 'src/activities/activities.service.ts') => [{ path, content }];

describe('findRawErrorThrows: forms an independent reviewer found could slip through', () => {
  it.each([
    ['with new', 'throw new Error("x");'],
    ['without new', 'throw Error("x");'],
    ['split over two lines', 'throw\n  new Error("x");'],
    ['split with the type on the next line', 'throw new\n  Error("x");'],
    ['TypeError without new', 'throw TypeError("x");'],
    ['RangeError', 'throw new RangeError("x");'],
    ['rejecting a promise with an Error', 'return Promise.reject(new Error("x"));'],
    ['rejecting without new', 'reject(Error("x"));'],
    ['reject in a promise executor', 'new Promise((resolve, reject) => { reject( new Error("x") ); });'],
  ])('flags a raw throw %s', (_label, code) => {
    expect(findRawErrorThrows(src(code))).toHaveLength(1);
  });

  it.each([
    ['an AppError subclass', 'throw new NotFoundError("Task");'],
    ['a re-throw', 'throw error;'],
    ['a longer name that merely starts with Error', 'throw new ErrorBoundaryThing();'],
    ['rejecting with a caught error', 'reject(error);'],
    ['a line comment', '// throw new Error("only an example")'],
    ['a block comment', '/* throw Error("example") */'],
    ['a multi-line block comment', '/*\n * throw new Error("example")\n */\nconst x = 1;'],
    ['a doc comment line', ' * throw new Error("jsdoc")'],
  ])('accepts %s', (_label, code) => {
    expect(findRawErrorThrows(src(code))).toEqual([]);
  });

  it('reports the real line number and the original source line, even after comments and blank lines', () => {
    const code = ['/* header', ' * comment', ' */', '', 'const a = 1;', '  throw Error("boom");'].join('\n');
    expect(findRawErrorThrows(src(code))).toEqual([{ file: 'src/activities/activities.service.ts', line: 6, text: 'throw Error("boom");' }]);
  });

  it('reports every offence, ordered by file and line', () => {
    const files = [
      { path: 'src\\b.ts', content: 'throw Error("1");\nconst ok = 1;\nthrow new TypeError("2");' },
      { path: 'src/a.ts', content: 'throw new Error("3");' },
    ];
    expect(findRawErrorThrows(files).map((f) => `${f.file}:${f.line}`)).toEqual(['src/a.ts:1', 'src/b.ts:1', 'src/b.ts:3']);
  });
});

describe('findErrorSubclasses', () => {
  it.each([
    ['plain', 'class MyError extends Error {}'],
    ['exported', 'export class MyError extends TypeError { constructor() { super("x"); } }'],
    ['with a generic', 'class Box<T> extends Error {}'],
  ])('flags a %s class that extends a built-in Error type', (_label, code) => {
    expect(findErrorSubclasses(src(code))).toHaveLength(1);
  });

  it('allows the AppError module itself, and classes that extend AppError or anything else', () => {
    expect(findErrorSubclasses(src('export class AppError extends Error {}', ERRORS_MODULE))).toEqual([]);
    expect(findErrorSubclasses(src('class ValidationError extends AppError {}'))).toEqual([]);
    expect(findErrorSubclasses(src('class Thing extends Base {}'))).toEqual([]);
    expect(findErrorSubclasses(src('// class Fake extends Error {}'))).toEqual([]);
  });

  it('treats the allowed path case-sensitively and normalises Windows separators', () => {
    expect(findErrorSubclasses(src('class X extends Error {}', 'src\\shared\\errors.ts'))).toEqual([]);
    expect(findErrorSubclasses(src('class X extends Error {}', 'src/shared/other.ts'))).toHaveLength(1);
  });
});

describe('maskComments', () => {
  it('blanks comments but keeps every newline, so line numbers never move', () => {
    const code = 'a // c1\n/* b\nc */ d\ne';
    const masked = maskComments(code);
    expect(masked.split('\n')).toHaveLength(code.split('\n').length);
    expect(masked).not.toContain('c1');
    expect(masked).toContain('a');
    expect(masked).toContain('d');
    expect(masked).toContain('e');
  });

  it('does not treat the // in a URL as a comment', () => {
    expect(maskComments('const u = "https://example.com"; throw Error("x");')).toContain('throw Error');
  });
});

describe('classifyChanges: tool-supplied facts for "does this criterion apply?"', () => {
  it('sorts changed files into kinds', () => {
    const summary = classifyChanges([
      'src/activities/activities.routes.ts',
      'src/activities/activities.schemas.ts',
      'src/activities/activities.service.ts',
      'src/activities/activities.repository.ts',
      'src/alerts/alerts.ports.ts',
      'src/shared/events.ts',
      'src/app.ts',
      'docs/openapi.yaml',
      'tests/activities/x.test.ts',
      'src\\staff\\staff.types.ts',
    ]);
    expect(summary).toEqual({
      routes: ['src/activities/activities.routes.ts'],
      schemas: ['src/activities/activities.schemas.ts'],
      services: ['src/activities/activities.service.ts'],
      repositories: ['src/activities/activities.repository.ts'],
      ports: ['src/alerts/alerts.ports.ts'],
      events: ['src/shared/events.ts'],
      wiring: ['src/app.ts'],
      contract: ['docs/openapi.yaml'],
      tests: ['tests/activities/x.test.ts'],
      other: ['src/staff/staff.types.ts'],
    });
  });

  it('a domain-only sprint shows no routes, schemas or wiring: the Evaluator can cite that as a fact', () => {
    const summary = classifyChanges(['src/activities/activities.service.ts', 'tests/activities/activities.service.test.ts']);
    expect(summary.routes).toEqual([]);
    expect(summary.wiring).toEqual([]);
    expect(summary.events).toEqual([]);
  });

  it('is empty for no changes', () => {
    expect(Object.values(classifyChanges([])).every((files) => files.length === 0)).toBe(true);
  });
});
