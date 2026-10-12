---
name: app-context
description: What StoreOps is, its five modules, entities, business rules, API surface, file layout and commands. Read before touching any code or writing any spec.
---

# StoreOps application context

**Purpose of this file:** give an agent the facts about THIS codebase so it never guesses. If something here contradicts the code, the code wins: report the mismatch in your summary.

StoreOps is a retail store operations REST API (capstone reference codebase). TypeScript strict, Express 4, zod 4, Jest + supertest. **In-memory storage**: no database. Run every command from the repository root.

## Modules (`src/<module>/`)

| Module | Responsibility | Key types | HTTP surface |
|---|---|---|---|
| `activities` | Operational activities: restocking, planogram, audit, compliance, general tasks | `Task`, `TaskStatus` (TODO, IN_PROGRESS, DONE, BLOCKED), `TaskPriority` (LOW..CRITICAL), `TaskCategory` (RESTOCKING, PLANOGRAM, AUDIT, COMPLIANCE, GENERAL) | `GET/POST /api/activities`, `GET/PATCH/DELETE /api/activities/:id` |
| `programmes` | Store programmes and their members | `Project`, `ProjectMember`, `ProjectRole` | `GET/POST /api/programmes`, `POST /api/programmes/:id/members` |
| `staff` | Authentication only (no CRUD) | `User`, `UserProfile`, `StaffRole` (REGIONAL_MANAGER, STORE_MANAGER, DEPARTMENT_LEAD, ASSOCIATE) | `POST /api/auth/login` |
| `alerts` | In-app notifications created in reaction to events | `Notification`, `AlertType` (INVENTORY, SLA_BREACH, SHIFT_HANDOVER, ESCALATION) | `GET /api/alerts` |
| `reports` | Read-only summaries; **never writes to other modules** | `Report`, `ReportType`, `ReportStatus` | none yet (demo features add them) |

`src/shared/` holds errors, config, auth (JWT, scrypt), event bus, validation, logging. It never imports a module. `src/app.ts` is the composition root: the only place modules are connected.

## File layout of a module

`<module>.routes.ts` (HTTP + validation) -> `<module>.service.ts` (rules) -> `<module>.repository.ts` (interface + `InMemory...` class); plus `<module>.schemas.ts` (zod), `<module>.types.ts`, optional `<module>.ports.ts`. Tests mirror it: `tests/<module>/`. Shared test helpers: `tests/helpers/world.ts` (real app with seeded, logged-in users) and `tests/helpers/fakes.ts` (fake ports, recording event bus, fixed clock).

## Business rules already in force (do not break them)

- **Store scoping:** every by-id read/update/delete goes through `getAccessible(user, id)`; another store's resource is `NotFoundError` (404, never 403). `REGIONAL_MANAGER` sees all stores (`canAccessStore`).
- **Status machine:** TODO -> IN_PROGRESS | BLOCKED; IN_PROGRESS -> TODO | DONE | BLOCKED; BLOCKED -> TODO | IN_PROGRESS; **DONE is terminal**. Violations: `ConflictError('INVALID_STATUS_TRANSITION')`.
- **Who may update an activity:** creator, assignee, or a supervisor (DEPARTMENT_LEAD and above). Changing **priority or assignee** needs a supervisor. **Delete:** creator or STORE_MANAGER and above.
- **Programmes:** only STORE_MANAGER and above create; add member needs STORE_MANAGER+ or the owner; a member's programme role may not outrank their staff role (`ROLE_EXCEEDS_STAFF_ROLE`); duplicates are `ALREADY_MEMBER`; closed programmes accept no members or activities (`PROGRAMME_CLOSED`).
- **Lists:** `limit` 1..100 (default 50), `offset` 0..100000; response `{ data, total, limit, offset }`.
- **Errors:** JSON `{ error: { code, message, details?, requestId } }`. Status mapping lives in `src/shared/errors.ts`.

## Events (typed in `src/shared/events.ts`)

`activity.assigned`, `activity.status_changed`, `programme.closed`. Subscribers: alerts (`ESCALATION` to store managers when a HIGH/CRITICAL activity becomes BLOCKED; `INVENTORY` to the assignee of a RESTOCKING activity) and reports (`STORE_SUMMARY` on `programme.closed`). **`programme.closed` has a subscriber but nothing emits it yet**: it is reserved for a future close-programme feature, so do not rely on it at runtime. The bus is in-process and awaited; a failing subscriber never fails the request.

## Commands (run from the repo root)

| Command | Meaning |
|---|---|
| `npm run verify` | typecheck, lint, architecture, duplication, tests with >= 90% coverage, audit. The inner-loop gate |
| `npm run typecheck` / `lint` / `arch` / `dup` | the individual gates |
| `npm run test:coverage` | Jest with thresholds (90% global, per `*.service.ts`, per `*.routes.ts`, `src/shared`) |
| `node scripts/smoke.js` | end-to-end smoke against a running server (needs `BASE_URL`, `DEMO_PASSWORD`) |

Demo users (all share `DEMO_PASSWORD` from `.env`): `regional.manager@`, `manager.s1@`, `lead.s1@`, `associate.s1@`, `manager.s2@storeops.example` (store-001 unless `.s2`).

## Not available

No database, no outbound HTTP, no email. Do not add dependencies: `package.json` is protected.
