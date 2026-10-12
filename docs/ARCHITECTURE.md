# StoreOps architecture

## Modules and layers

```
src/
  activities/   Task management      routes -> service -> repository  (+ schemas, types, ports)
  programmes/   Store programmes     routes -> service -> repository
  staff/        Auth only            login route -> service -> repository (+ demo seed)
  alerts/       Notifications        routes -> service -> repository; reacts to events only
  reports/      Read-only summaries  service -> repository; reacts to events; no HTTP surface yet
  shared/       Errors, config, auth, event bus, validation, logging  (never imports a module)
  app.ts        Composition root: the ONLY place modules are connected
```

Each module has: `*.routes.ts` (HTTP + validation), `*.service.ts` (business rules), `*.repository.ts`
(interface + in-memory implementation), `*.schemas.ts` (zod), `*.types.ts`, and optionally `*.ports.ts`.

## Rules (enforced by tools wherever a tool can decide, otherwise by the Evaluator's evidence-based review; see `.dependency-cruiser.cjs`, `eslint.config.mjs`, `.harness/config/evaluation.json`)

| Rule | Enforced by |
|---|---|
| A module never imports another module's repository, service or internals; only its `*.types.ts` | dependency-cruiser: `no-cross-module-repository-import`, `no-cross-module-service-import`, `no-cross-module-internals` |
| Cross-module reads use a **port** declared by the consumer, satisfied in `src/app.ts` by the provider's service (read-only lookup) | structure + review; the port has no write methods |
| Cross-module side effects use `EventBus.emit(...)` with an event typed in `src/shared/events.ts` | dependency-cruiser (no service imports) + review |
| Routes -> Service -> Repository; routes never import repositories; repositories never import services/routes | dependency-cruiser |
| No raw Error in `src/`: no `throw`/`reject` of a built-in Error (with or without `new`, split across lines or not) and no class extending one outside `src/shared/errors.ts`; throw `AppError` subclasses (`code`, `message`, `statusCode`) | ESLint `no-restricted-syntax` and the harness check `ARCH-02` |
| `reports` is read-only: its port to activities has no write method | structure + review |
| `shared/` never imports a module; `src/` never imports devDependencies; no cycles | dependency-cruiser |

## Event flow

```
ActivitiesService.update(status -> BLOCKED, priority HIGH|CRITICAL)
   └─ bus.emit('activity.status_changed')
        └─ AlertsService (subscriber) ─ StaffService port: store managers of that store
              └─ one ESCALATION notification per manager
ActivitiesService.create/update(assignee, category RESTOCKING)
   └─ bus.emit('activity.assigned') ─▶ AlertsService ─▶ INVENTORY notification for the assignee
programme closed (future feature)
   └─ bus.emit('programme.closed') ─▶ ReportsService ─▶ STORE_SUMMARY report (PENDING -> READY | FAILED)
```

A failing subscriber is logged and never fails the emitting request.

## Security model (summary; detail in `OWASP-MAPPING.md`)

JWT (HS256 pinned, issuer, audience, 15 min), claims re-validated with zod; scrypt password hashing (OWASP parameters,
self-describing hash); object-level authorisation (store scoping, owner checks) with 404 instead of 403 across stores;
strict zod schemas everywhere (unknown fields rejected); bounded pagination; helmet; per-IP rate limiting with a tighter
limit on login; body size limit; sanitised errors with request IDs; secrets only from the environment (Key Vault in Azure).

## How the harness relates to CI/CD (for the programme's "precede, replace or feed" question)

`npm run verify` is the single definition of the fast quality gates. The harness **Evaluator** runs it (plus LLM-assessed
checks) before accepting a sprint, so it **precedes and feeds** CI: defects are caught before a commit reaches the
pipeline. CI re-runs the same command and adds what is too slow or environment-specific for the inner loop (SonarCloud,
mutation testing, Trivy, ZAP, deployment). CI never trusts the harness verdict. Harness files live in `.harness/`; CI
configuration lives in `.github/`.
