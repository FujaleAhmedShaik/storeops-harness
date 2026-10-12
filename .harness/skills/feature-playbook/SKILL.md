---
name: feature-playbook
description: Step-by-step recipe for adding an endpoint, a business rule, a port or an event to StoreOps, with the exact files, wiring in app.ts, OpenAPI update and the files a sprint may touch.
---

# Feature playbook

**Purpose:** the shortest correct path through the layers, so generated code lands in the right files with the right wiring. Checked by `ARCH-05/06`, `GOV-01` (scope), `GOV-02` (OpenAPI).

## Files a sprint may change

`src/**`, `tests/**` (but never `tests/harness/**`), and `docs/openapi.yaml`. Everything else is protected or out of scope (`GOV-01`, hard).

## A. Add a business rule to an existing service

1. Add the rule to the service method (`<module>.service.ts`); throw the right `AppError` with a rule code.
2. If it needs data from another module, add a **port** (section C), never an import.
3. If it changes state other modules care about, raise an **event** (section D).
4. Tests: one per acceptance criterion, plus the negative cases (see `how-to-test`).

## B. Add an endpoint

1. **Types / schemas:** extend `<module>.types.ts` and `<module>.schemas.ts` with a `z.strictObject` for body, query (`...paginationShape` if it lists) and params (`idParamSchema` for `:id`).
2. **Repository:** add the method to the `<Module>Repository` interface **and** the `InMemory...` class (async).
3. **Service:** the rule logic, taking `user: AuthUser` first. Authorise in the service (`getAccessible`, `isSupervisor`, `isStoreManager`).
4. **Routes:** in `<module>.routes.ts`, `asyncHandler(async (req, res) => { ... })`: `parseInput(schema, req.body|query|params)`, call one service method with `currentUser(req)`, respond with the right status (201 create, 200 update/read, 204 delete). No logic here.
5. **Static path order:** register fixed paths (e.g. `/bulk-status`) **before** `/:id` routes so they are not captured as an id.
6. **Wiring:** routers are already mounted in `src/app.ts`; only edit it for a new module or a new port.
7. **Contract:** add the path, schemas and responses to `docs/openapi.yaml` (`GOV-02`).
8. **Tests:** service tests and route tests.

## C. Add a port (cross-module read)

1. In the **consumer's** `<consumer>.ports.ts` declare a minimal interface of read methods (names start `get|find|list|count`).
2. The consumer service takes it in its constructor.
3. Make sure the provider's service already has a matching method (add the read-only method to the provider service if not; no repository access from outside).
4. Pass the provider service in `src/app.ts` where the consumer is constructed. TypeScript's structural typing checks the match.

## D. Add an event

1. Add the event name and payload to `AppEvents` in `src/shared/events.ts` (primitives and `shared/domain` types only).
2. The producing service does `await this.bus.emit('<name>', payload)` after the state change is saved.
3. The consuming module registers a handler in its `registerEventHandlers(bus)`; `src/app.ts` already calls it for alerts and reports (add the call there for a new subscriber).
4. Test both sides: the producer emits the exact payload (recording bus), the subscriber produces its effect (real bus).

## E. Partial-failure / bulk operations

Validate the whole request first (schema, size limit), then process items independently, returning a per-item result list `{ id, outcome: 'UPDATED' | 'REJECTED', code? }` plus counts; one bad item must not abort or roll back the others. Raise events per successful item. Bound the batch size (e.g. 50) in the schema.

## Checklist before you hand over

`npm run verify` green; every AC has a named test; `openapi.yaml` updated if routes changed; no edits outside the allowed files; summary written.
