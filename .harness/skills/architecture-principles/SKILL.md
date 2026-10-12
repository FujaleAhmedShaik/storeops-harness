---
name: architecture-principles
description: The non-negotiable StoreOps architecture rules, the failure mode each prevents, how each is enforced mechanically, and what breaks without it. Shared by every agent.
---

# StoreOps architecture principles

**Purpose:** these rules exist because an earlier AI experiment broke them four ways. Each is enforced by a hard gate in `.harness/config/evaluation.json`. Violating one fails the sprint outright, however good everything else is.

## The rules

| # | Rule | Failure mode prevented | Enforced by | What breaks without it |
|---|---|---|---|---|
| R1 | **No module imports another module's repository, service or internals.** Only another module's `*.types.ts` may be imported. | 1. Direct imports from another module's repository, bypassing the service boundary | `ARCH-01` (dependency-cruiser: `no-cross-module-repository-import`, `no-cross-module-service-import`, `no-cross-module-internals`) | Modules couple through data shapes; a storage change in `activities` silently breaks `alerts`; authorisation in the service layer is bypassed |
| R2 | **Cross-module reads go through a port.** The *consumer* declares an interface in its own `<module>.ports.ts`; `src/app.ts` satisfies it with the provider's service. Read-only methods only. | 1 (service boundary) | `ARCH-01` + review `ARCH-06` | Without ports the consumer must import the provider and R1 cannot be zero-tolerance |
| R3 | **Cross-module side effects use the event bus only:** `await bus.emit('<event>', payload)` with the event typed in `src/shared/events.ts`; the other module subscribes. Never call a mutating method of, or write data into, a sibling module. | 4. State changes written directly to sibling module repositories / missing event-bus integration | `ARCH-04` (LLM, hard), `ARCH-01` | A new rule in `activities` would hard-code its effect on `alerts`; every future subscriber needs another edit to `activities` |
| R4 | **Errors are `AppError` subclasses** (`ValidationError`, `NotFoundError`, `ForbiddenError`, `UnauthorizedError`, `ConflictError(code, message)`). Never `throw new Error(...)`. | 2. Raw Error throws bypassing the typed hierarchy | `ARCH-02` (static scan of `src/`), lint rule `no-restricted-syntax` | A raw Error becomes a generic 500 and loses its HTTP status and machine-readable code |
| R5 | **Layers:** Routes -> Service -> Repository, no skipping. Routes parse and respond; services hold rules; repositories store data and make no external or HTTP calls. | Layer skipping | `ARCH-01` (`routes-must-not-import-repository`, `repository-must-not-import-upper-layers`), review `ARCH-05` | Business rules duplicated in routes; untestable repositories |
| R6 | **`reports` is read-only:** its ports expose only get/find/list/count/summarise/read methods. | Reports writing into activities, programmes or staff | `ARCH-03` (static scan of `src/reports/*.ports.ts`) | Reports could mutate the data it is meant to describe |
| R7 | **`shared/` never imports a module; `src/` never imports devDependencies; no cycles.** | Hidden coupling | `ARCH-01` | Cyclic imports and an unusable build |

## Patterns to copy

```ts
// R2 - port declared by the CONSUMER (src/alerts/alerts.ports.ts)
export interface StoreManagerDirectory {
  findStoreManagerIds(storeId: string): Promise<string[]>;
}
// wired ONLY in src/app.ts:  new AlertsService(new InMemoryNotificationRepository(), staff)

// R3 - raise an event; do not call alerts
await this.bus.emit('activity.status_changed', { taskId, title, storeId, assigneeId, from, to, priority });
// alerts subscribes in AlertsService.registerEventHandlers(bus)

// R4 - typed error with a rule code
throw new ConflictError('INVALID_STATUS_TRANSITION', `Cannot move an activity from ${from} to ${to}`);
```

## Anti-patterns (each is a hard-gate failure)

```ts
import { InMemoryTaskRepository } from '../activities/activities.repository'; // R1, from alerts or reports
import { AlertsService } from '../alerts/alerts.service';                       // R1/R3, from activities
throw new Error('not found');                                                  // R4
await this.alerts.create({ ... });                                             // R3: direct call instead of an event
```

## When a new need does not fit

A feature that seems to require breaking a rule is a design signal, not an exception. Use a port (read) or an event (effect). If neither works, stop and report it in the generator summary under Known gaps; do not weaken a rule, a gate or a config file (those are protected and the guard will block the edit).
