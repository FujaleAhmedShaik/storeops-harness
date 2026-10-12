/** Deterministic static checks that need no model. Pure functions over file names and contents. */

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Minimal glob: `**` crosses directories, `*` stays inside one, everything else is literal. */
export function globToRegExp(glob: string, ignoreCase = false): RegExp {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob.charAt(index);
    if (char === '*' && glob.charAt(index + 1) === '*') {
      const followedBySlash = glob.charAt(index + 2) === '/';
      pattern += followedBySlash ? '(?:.*/)?' : '.*';
      index += followedBySlash ? 2 : 1;
    } else if (char === '*') {
      pattern += '[^/]*';
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
    }
  }
  // The globs come from the repository's own evaluation config, never from user input, and every metacharacter is escaped above.
  // eslint-disable-next-line security/detect-non-literal-regexp
  return new RegExp(`^${pattern}$`, ignoreCase ? 'i' : '');
}

/** `ignoreCase` is for guarding Windows/macOS file systems, where `CLAUDE.md` and `claude.md` are the same file. */
export function matchesAny(path: string, globs: readonly string[], ignoreCase = false): boolean {
  const normalized = normalizePath(path);
  return globs.some((glob) => globToRegExp(glob, ignoreCase).test(normalized));
}

const blank = (text: string): string => text.replace(/[^\n]/g, ' ');

/**
 * Replaces comments with spaces (keeping every newline) so scans neither flag example code in comments nor shift line numbers.
 * A `//` directly after a colon is treated as part of a URL, not a comment.
 */
export function maskComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:\\])(\/\/[^\n]*)/gm, (_match, prefix: string, comment: string) => prefix + blank(comment))
    .split('\n')
    .map((line) => (line.trim().startsWith('*') ? blank(line) : line))
    .join('\n');
}

function lineOf(masked: string, index: number): number {
  return masked.slice(0, index).split('\n').length;
}

function scan(files: readonly SourceFile[], pattern: RegExp, skip: (path: string) => boolean = () => false): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const path = normalizePath(file.path);
    if (skip(path)) {
      continue;
    }
    const masked = maskComments(file.content);
    const original = file.content.split('\n');
    for (const match of masked.matchAll(pattern)) {
      const line = lineOf(masked, match.index);
      findings.push({ file: path, line, text: (original[line - 1] ?? '').trim() });
    }
  }
  return findings;
}

const ERROR_TYPES = '(?:Error|TypeError|RangeError|SyntaxError|ReferenceError|EvalError|URIError)\\b';
// Four simple, mutually exclusive patterns instead of one with nested optionals (cheaper to reason about, no backtracking risk).
// Built only from the constants in this file; nothing external reaches the pattern.
const RAW_THROW_PATTERNS: readonly RegExp[] = ['\\bthrow\\s+new\\s+', '\\bthrow\\s+', '\\breject\\(\\s*new\\s+', '\\breject\\(\\s*'].map(
  // eslint-disable-next-line security/detect-non-literal-regexp
  (prefix) => new RegExp(prefix + ERROR_TYPES, 'g'),
);

/**
 * Failure mode 2: raw Error throws. Catches `throw new Error(...)`, `throw Error(...)`, a throw split across lines,
 * and `reject(new Error(...))`, for every built-in Error type. Comments are ignored.
 */
export function findRawErrorThrows(files: readonly SourceFile[]): Finding[] {
  return RAW_THROW_PATTERNS.flatMap((pattern) => scan(files, pattern)).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export const ERRORS_MODULE = 'src/shared/errors.ts';

/** A class that extends a built-in Error type creates a second, untyped error hierarchy. Only the AppError module may do so. */
export function findErrorSubclasses(files: readonly SourceFile[], allowedPath: string = ERRORS_MODULE): Finding[] {
  return scan(files, /\bclass\s+\w+[^{\n]*?\bextends\s+(?:Error|TypeError|RangeError|SyntaxError|ReferenceError|EvalError|URIError)\b/g, (path) => path === allowedPath);
}

const READ_ONLY_METHOD = /^(get|find|list|count|summari[sz]e|read)/;
// Matches an interface member that is a method: `name(` or `name<T>(`, after indentation and an optional `readonly`.
const PORT_METHOD = /^(\w+)[(<]/;

/** The reports module is read-only: every method on its ports must be a read. */
export function findReportsWriteViolations(portFiles: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of portFiles) {
    file.content.split('\n').forEach((text, index) => {
      const member = text.startsWith('  ') ? text.trim().replace(/^readonly\s+/, '') : '';
      const method = PORT_METHOD.exec(member)?.[1];
      if (method !== undefined && !READ_ONLY_METHOD.test(method)) {
        findings.push({ file: normalizePath(file.path), line: index + 1, text: text.trim() });
      }
    });
  }
  return findings;
}

export interface ScopeResult {
  readonly protectedTouched: string[];
  readonly outOfScope: string[];
  /** True when at least one file under src/ or tests/ changed: a sprint that changed no code did nothing. */
  readonly hasCodeChange: boolean;
}

/** Gate integrity: a sprint may change only allowed paths, never touch protected ones, and must change some code. */
export function checkScope(changed: readonly string[], allowed: readonly string[], protectedGlobs: readonly string[]): ScopeResult {
  const files = changed.map(normalizePath);
  const protectedTouched = files.filter((file) => matchesAny(file, protectedGlobs));
  const outOfScope = files.filter((file) => !matchesAny(file, protectedGlobs) && !matchesAny(file, allowed));
  const hasCodeChange = files.some((file) => !matchesAny(file, protectedGlobs) && matchesAny(file, ['src/**', 'tests/**']));
  return { protectedTouched, outOfScope, hasCodeChange };
}

const ROUTES_FILE = /^src\/[^/]+\/[^/]+\.routes\.ts$/;

/** True when a routes file changed without the OpenAPI contract changing with it. */
export function routesChangedWithoutOpenApi(changed: readonly string[]): string[] {
  const files = changed.map(normalizePath);
  const routes = files.filter((file) => ROUTES_FILE.test(file));
  return routes.length > 0 && !files.includes('docs/openapi.yaml') ? routes : [];
}

export const CHANGE_KINDS = ['routes', 'schemas', 'services', 'repositories', 'ports', 'events', 'wiring', 'contract', 'tests', 'other'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export type ChangeSummary = Readonly<Record<ChangeKind, readonly string[]>>;

const CLASSIFIERS: readonly [ChangeKind, RegExp][] = [
  ['routes', ROUTES_FILE],
  ['schemas', /\.schemas\.ts$/],
  ['services', /\.service\.ts$/],
  ['repositories', /\.repository\.ts$/],
  ['ports', /\.ports\.ts$/],
  ['events', /^src\/shared\/events?(?:-bus)?\.ts$/],
  ['wiring', /^src\/app\.ts$/],
  ['contract', /^docs\/openapi\.yaml$/],
  ['tests', /^tests\//],
];

/**
 * Groups changed files by what they are. The Evaluator cites this to answer "does this criterion even apply?":
 * for example, "no routes changed" is a tool-supplied fact, not a judgement.
 */
export function classifyChanges(changed: readonly string[]): ChangeSummary {
  const groups: Record<ChangeKind, string[]> = { routes: [], schemas: [], services: [], repositories: [], ports: [], events: [], wiring: [], contract: [], tests: [], other: [] };
  for (const file of changed.map(normalizePath)) {
    const kind = CLASSIFIERS.find(([, pattern]) => pattern.test(file))?.[0] ?? 'other';
    groups[kind].push(file);
  }
  return groups;
}
