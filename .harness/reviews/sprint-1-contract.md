SPRINT: 1
TITLE: Bulk status domain rules
FEATURE: Shift handover bulk activity status update
STATUS: READY

# Sprint 1 contract: Bulk status domain rules

## Goal
Add `ActivitiesService.bulkUpdateStatus` so up to 50 activities can be moved to `DONE` or `BLOCKED` in one call, each
item judged independently against store scoping, authorisation and the transition table, with per-item failure codes
and no route yet.

## Scope
- `src/activities/activities.schemas.ts`: `bulkUpdateStatusSchema` (`items`: array of `{ id: uuid, status: 'DONE' | 'BLOCKED' }`,
  `.min(1).max(50)`), exported `BulkStatusInput` type.
- `src/activities/activities.types.ts`: `BulkStatusItemResult` (`{ id; outcome: 'UPDATED'; from: TaskStatus; to: TaskStatus } | { id; outcome: 'FAILED'; code: string }`),
  `BulkStatusResult` (`{ results: BulkStatusItemResult[]; updated: number; failed: number }`).
- `src/shared/events.ts`: new `activity.bulk_status_updated` event: `{ taskId, title, storeId, assigneeId: string | null, createdBy, updatedBy, from: TaskStatus, to: TaskStatus }`.
- `src/activities/activities.service.ts`: `bulkUpdateStatus(user: AuthUser, input: BulkStatusInput): Promise<BulkStatusResult>`,
  reusing `getAccessible`, `isSupervisor`, `assertTransition` and the existing `activity.status_changed` emit; emits the
  new audit event once per successfully updated item. The existing transition table is unchanged: `TODO` -> `IN_PROGRESS`
  or `BLOCKED`; `DONE` is reachable only from `IN_PROGRESS`.
- `tests/activities/activities.service.test.ts` (or a new `activities.service.bulk-status.test.ts`): unit tests named `S1-AC<n>: ...`.

## Out of scope
- No route, no `src/app.ts` wiring, no `alerts` subscriber (sprint 2).
- No change to priority/assignee update rules or to the single-item `update` method's behaviour.
- No change to the status transition table itself (`assertTransition`); this sprint only applies the existing rules per item.
- No `docs/openapi.yaml` change (no route yet).

## Acceptance criteria
S1-AC1  GIVEN a STORE_MANAGER of store-001 and two store-001 activities A (IN_PROGRESS) and B (TODO), both created by the manager
        WHEN  `ActivitiesService.bulkUpdateStatus(manager, { items: [{ id: A.id, status: 'DONE' }, { id: B.id, status: 'BLOCKED' }] })` is called
        THEN  the result has `updated: 2, failed: 0` with both items `outcome: 'UPDATED'`
              AND A is stored with status `DONE` and B with status `BLOCKED`
              AND `activity.status_changed` is emitted twice (once per item, `from`/`to` matching)
              AND `activity.bulk_status_updated` is emitted twice with `updatedBy` equal to the manager's id

S1-AC2  (negative) GIVEN a STORE_MANAGER of store-001 and activity C that belongs to store-002
        WHEN  `ActivitiesService.bulkUpdateStatus(manager, { items: [{ id: C.id, status: 'DONE' }] })` is called
        THEN  the result has `failed: 1` with that item `{ outcome: 'FAILED', code: 'NOT_FOUND' }`
              AND C's stored status is unchanged
              AND no event is emitted

S1-AC3  (negative) GIVEN an ASSOCIATE of store-001 who is neither the creator nor the assignee of store-001 activity D (TODO)
        WHEN  `ActivitiesService.bulkUpdateStatus(associate, { items: [{ id: D.id, status: 'DONE' }] })` is called
        THEN  the result has `failed: 1` with that item `{ outcome: 'FAILED', code: 'FORBIDDEN' }`
              AND D's stored status is still `TODO`
              AND no event is emitted

S1-AC4  (negative) GIVEN a STORE_MANAGER of store-001 and store-001 activity E already `DONE`
        WHEN  `ActivitiesService.bulkUpdateStatus(manager, { items: [{ id: E.id, status: 'BLOCKED' }] })` is called
        THEN  the result has `failed: 1` with that item `{ outcome: 'FAILED', code: 'INVALID_STATUS_TRANSITION' }`
              AND E's stored status is still `DONE`
              AND no event is emitted

S1-AC5  (negative) GIVEN a STORE_MANAGER of store-001
        WHEN  `ActivitiesService.bulkUpdateStatus(manager, { items: Array(51).fill({ id: validUuid, status: 'DONE' }) })` is called
        THEN  it rejects with `ValidationError` before touching the repository
              AND no event is emitted

S1-AC6  GIVEN a STORE_MANAGER of store-001, store-001 activity F (IN_PROGRESS, manager is creator) and a non-existent activity id X
        WHEN  `ActivitiesService.bulkUpdateStatus(manager, { items: [{ id: F.id, status: 'DONE' }, { id: X, status: 'DONE' }] })` is called
        THEN  the result has `updated: 1, failed: 1`
              AND F's item is `{ outcome: 'UPDATED', from: 'IN_PROGRESS', to: 'DONE' }` and F is stored as `DONE`
              AND X's item is `{ outcome: 'FAILED', code: 'NOT_FOUND' }`
              AND exactly one `activity.status_changed` and one `activity.bulk_status_updated` are emitted

S1-AC7  (negative) GIVEN a STORE_MANAGER of store-001 and store-001 activity G (TODO)
        WHEN  the bulk input item for G carries `status: 'IN_PROGRESS'`
        THEN  `bulkUpdateStatusSchema` parsing rejects the whole request with a zod validation error before
              `bulkUpdateStatus` runs any repository call
              AND G's stored status is unchanged

S1-AC8  (negative) GIVEN a STORE_MANAGER of store-001 and store-001 activity H (TODO, manager is creator)
        WHEN  `ActivitiesService.bulkUpdateStatus(manager, { items: [{ id: H.id, status: 'DONE' }] })` is called
        THEN  the result has `failed: 1` with that item `{ outcome: 'FAILED', code: 'INVALID_STATUS_TRANSITION' }`
              (the transition table does not allow `TODO` -> `DONE` directly)
              AND H's stored status is still `TODO`
              AND no event is emitted

## Dependencies
None.

## Definition of done
- `npm run verify` green; coverage >= 90%.
- Every criterion has a test named `S1-AC<m>: ...` asserting stored state, emitted event (name + payload field) or error code.
- No `docs/openapi.yaml` change expected (no route in this sprint).
- Only files under `src/activities/`, `src/shared/events.ts` and `tests/` changed.
