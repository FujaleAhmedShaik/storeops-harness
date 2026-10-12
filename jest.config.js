/** Coverage gates exceed the programme minimums (service 80 / routes 70 / shared 60 / overall 70). */
const gate = { lines: 90, statements: 90, functions: 90, branches: 90 };

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  testTimeout: 30_000,
  // Type errors are caught by `npm run typecheck`; transpile-only keeps the test loop fast.
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  // .harness/tools holds the deterministic verdict/routing logic: it is held to the same bar. cli.ts is I/O only.
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts', '.harness/tools/*.ts', '!.harness/tools/cli.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: gate,
    './src/*/*.service.ts': gate,
    './src/*/*.routes.ts': gate,
    './src/shared/': gate,
  },
};
