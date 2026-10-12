/**
 * StoreOps architecture rules (hard gates for the harness Evaluator and CI).
 * Failure mode 1: cross-module repository imports.
 * Failure mode 4: bypassing the event bus / service boundary.
 * Layer separation: Routes -> Service -> Repository, no skipping.
 * Modules never import each other's internals; cross-module reads are wired through ports in src/app.ts.
 */
const MODULES = '(activities|programmes|staff|alerts|reports)';
const OWN_MODULE = '^src/$1/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', comment: 'No circular imports.', from: {}, to: { circular: true } },
    {
      name: 'no-cross-module-repository-import',
      severity: 'error',
      comment: "A module must never import another module's repository (failure mode 1).",
      from: { path: `^src/${MODULES}/` },
      to: { path: `^src/${MODULES}/[^/]+\\.repository\\.ts$`, pathNot: OWN_MODULE },
    },
    {
      name: 'no-cross-module-service-import',
      severity: 'error',
      comment: 'Cross-module reads go through ports wired in src/app.ts; side effects go through the EventBus (failure mode 4).',
      from: { path: `^src/${MODULES}/` },
      to: { path: `^src/${MODULES}/[^/]+\\.service\\.ts$`, pathNot: OWN_MODULE },
    },
    {
      name: 'no-cross-module-internals',
      severity: 'error',
      comment: "Only another module's *.types.ts may be imported (type-only coupling).",
      from: { path: `^src/${MODULES}/` },
      to: { path: `^src/${MODULES}/`, pathNot: [OWN_MODULE, '\\.types\\.ts$'] },
    },
    {
      name: 'routes-must-not-import-repository',
      severity: 'error',
      comment: 'Layer separation: Routes -> Service -> Repository, no skipping.',
      from: { path: '\\.routes\\.ts$' },
      to: { path: '\\.repository\\.ts$' },
    },
    {
      name: 'service-must-not-import-routes',
      severity: 'error',
      from: { path: '\\.service\\.ts$' },
      to: { path: '\\.routes\\.ts$' },
    },
    {
      name: 'repository-must-not-import-upper-layers',
      severity: 'error',
      comment: 'Repositories hold data access only: no services, routes or HTTP types.',
      from: { path: '\\.repository\\.ts$' },
      to: { path: '\\.(service|routes)\\.ts$' },
    },
    {
      name: 'shared-must-not-import-modules',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: `^src/${MODULES}/` },
    },
    {
      name: 'not-to-dev-dependency',
      severity: 'error',
      from: { path: '^src/' },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    includeOnly: '^src',
  },
};
