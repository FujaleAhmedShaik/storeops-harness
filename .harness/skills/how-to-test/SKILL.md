---
name: how-to-test
description: How to write StoreOps tests that assert business outcomes (not just status codes), the helpers to use, naming that traces to acceptance criteria, and the 90% coverage bar.
---

# How to test

**Purpose:** prevent failure mode 3: *tests that assert HTTP status codes but not business rules*. A test that only checks `expect(res.status).toBe(200)` proves nothing about the rule. Checked by `COR-02` (tests pass), `COR-03` (coverage), `COR-04` (assertion quality, **hard**).

## The bar

- **Coverage >= 90%** lines, branches, functions and statements: globally, for every `*.service.ts`, every `*.routes.ts`, and `src/shared/` (thresholds in `jest.config.js`, which you must not edit). Mutation testing (Stryker, 93% today) runs in CI: weak assertions get caught there.
- **Every acceptance criterion has at least one test whose name starts with its id**: `it('S1-AC3: rejects reopening a DONE activity and keeps it DONE', ...)`. This is how the Evaluator traces criterion -> test.
- **What counts as a business assertion** (at least one per test): stored state read back through the repository or API; an emitted event (name and payload field) from the recording bus; an error `code` or class; a response body field. A status code alone never counts, but may accompany one of these.
- Write the negative case for every rule: wrong role (403), other store (404), invalid transition (409), invalid input (400).

## Where and how

| Need | Use |
|---|---|
| Service rule in isolation | `tests/<module>/<module>.service.test.ts`: real service + `InMemory...Repository` + `programmeDirectory`/`staffDirectory` fakes, `createRecordingBus()`, `fixedClock()`, `sequentialIds()` from `tests/helpers/fakes.ts`. Use the `users` map (`manager`, `lead`, `associate`, `outsiderManager`, `regional`) and `ids` |
| HTTP behaviour end to end | `tests/<module>/<module>.routes.test.ts`: `createWorld()` from `tests/helpers/world.ts` gives the real app with seeded, logged-in personas; use `world.auth('manager1')`, `createProgramme`, `createTask` |
| Event integration | emit through the real bus, then assert the subscriber's effect (see `tests/alerts/alerts.test.ts`) |
| Many similar cases | `it.each([...])` tables, e.g. every allowed and forbidden status transition |
| Time and ids | inject the clock and id factory; never assert on `Date.now()` |

Mirror the source path under `tests/`. Keep the existing helpers; add a helper only when three tests need it (duplication is not gated in tests but readability is reviewed).

## Patterns

```ts
it('S1-AC3: rejects reopening a DONE activity and keeps it DONE', async () => {
  const { service, repo, bus } = setup();
  const task = await repo.save({ ...(await service.create(manager, input)), status: 'DONE' }); // seed a DONE activity
  await expect(service.update(manager, task.id, { status: 'TODO' })).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
  expect((await repo.findById(task.id))?.status).toBe('DONE');   // state
  expect(bus.emitted).toHaveLength(0);                             // no event
});
```

Do **not** write: `expect(response.status).toBe(200)` as the only assertion; snapshot tests of whole responses; tests that call the service and assert nothing; tests that mock the unit under test.

## Commands

`npm run test:coverage` (the gate), `npx jest tests/<path> --coverage=false` (fast loop), `npm run verify` (everything). Fix failing tests by fixing the code, never by loosening a threshold or deleting an assertion.
