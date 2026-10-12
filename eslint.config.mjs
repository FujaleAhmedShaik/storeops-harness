import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';

const ERROR_TYPES = '/^(Error|TypeError|RangeError|SyntaxError|ReferenceError|EvalError|URIError)$/';

// Failure mode 2: every way of raising a raw built-in Error. The static check ARCH-02 scans for the same forms.
const rawThrowSelectors = [
  { selector: `ThrowStatement > NewExpression[callee.name=${ERROR_TYPES}]`, message: 'Throw an AppError subclass (src/shared/errors.ts), never a raw Error.' },
  { selector: `ThrowStatement > CallExpression[callee.name=${ERROR_TYPES}]`, message: 'Throw an AppError subclass (src/shared/errors.ts), never a raw Error (calling Error() without new is the same thing).' },
  {
    selector: `:matches(CallExpression[callee.name='reject'], CallExpression[callee.property.name='reject']) > :matches(NewExpression, CallExpression)[callee.name=${ERROR_TYPES}]`,
    message: 'Reject with an AppError subclass, never a raw Error.',
  },
];
const errorSubclassSelectors = ['ClassDeclaration', 'ClassExpression'].map((kind) => ({
  selector: `${kind}[superClass.name=${ERROR_TYPES}]`,
  message: 'Do not create a second error hierarchy: extend AppError (src/shared/errors.ts), not a built-in Error.',
}));

export default defineConfig(
  globalIgnores(['dist/', 'coverage/', 'reports/', '.stryker-tmp/', 'node_modules/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  security.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Typed index access on closed `as const` maps is a known false positive of this rule.
      // Real injection risks are covered by schema validation, Sonar and CodeQL.
      'security/detect-object-injection': 'off',
    },
  },
  {
    // Failure mode 2: raw Error throws bypass the AppError hierarchy.
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-syntax': ['error', ...rawThrowSelectors, ...errorSubclassSelectors],
    },
  },
  {
    // The one module allowed to extend Error: it defines AppError, the root of the typed hierarchy.
    files: ['src/shared/errors.ts'],
    rules: { 'no-restricted-syntax': ['error', ...rawThrowSelectors] },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      // supertest response bodies are untyped JSON; assertions narrow them.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      // Tests read fixtures and build patterns from known literals.
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-regexp': 'off',
    },
  },
  {
    // Developer tooling: paths come from the repo root and static config, never from request input.
    files: ['.harness/tools/cli.ts'],
    rules: { 'security/detect-non-literal-fs-filename': 'off', 'security/detect-child-process': 'off' },
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { '@typescript-eslint/no-require-imports': 'off' }, // plain CommonJS helper scripts
    languageOptions: {
      globals: {
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        performance: 'readonly',
      },
    },
  },
);
