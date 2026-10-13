SPRINT: 2
TITLE: Bulk status route and audit subscriber
FEATURE: Shift handover bulk activity status update
STATUS: READY

# Sprint 2 contract: Bulk status route and audit subscriber

## Goal
Expose `ActivitiesService.bulkUpdateStatus` as `PATCH /api/activities/bulk-status` and make `alerts` record a
`SHIFT_HANDOVER` audit notification for every activity the endpoint updates.

## Scope
- `src/activities/activities.routes.ts`: `router.patch('/bulk-status', ...)` registered **before** `router.patch('/:id', ...)`,
  parsing the body with `bulkUpdateStatusSchema` and returning `200` with the service's `BulkStatusResult`.
- `src/alerts/alerts.service.ts`: subscribe to `activity.bulk_status_updated` in `registerEventHandlers`; create a
  `SHIFT_HANDOVER` notification with `userId = event.assigneeId ?? event.createdBy` and `relatedId = event.taskId`.
- `src/app.ts`: no new wiring expected beyond what sprint 1 already typed (same `EventBus`, same `AlertsService`
  construction); confirm and adjust only if compilation requires it.
- `docs/openapi.yaml`: document `PATCH /api/activities/bulk-status`.
- `tests/activities/activities.routes.test.ts` (or a new bulk-status test file) and `tests/alerts/alerts.service.test.ts`:
  tests named `S2-AC<n>: ...`.

## Out of scope
- No new transition or authorisation rule beyond what sprint 1 implemented.
- No change to `GET /api/alerts` response shape.

## Acceptance criteria
S2-AC1  GIVEN a logged-in STORE_MANAGER of store-001 and store-001 activity A (IN_PROGRESS, manager is creator)
        WHEN  `PATCH /api/activities/bulk-status` is called with `{ items: [{ id: A.id, status: 'DONE' }] }`
        THEN  the response is `200` with body `{ results: [{ id: A.id, outcome: 'UPDATED', from: 'IN_PROGRESS', to: 'DONE' }], updated: 1, failed: 0 }`

S2-AC2  GIVEN a logged-in STORE_MANAGER of store-001, store-001 activity B (IN_PROGRESS, manager is creator) and a non-existent id X
        WHEN  `PATCH /api/activities/bulk-status` is called with `{ items: [{ id: B.id, status: 'DONE' }, { id: X, status: 'DONE' }] }`
        THEN  the response is `200` with body `updated: 1, failed: 1`
              AND the result for X is `{ id: X, outcome: 'FAILED', code: 'NOT_FOUND' }`

S2-AC3  (negative) GIVEN a logged-in STORE_MANAGER of store-001
        WHEN  `PATCH /api/activities/bulk-status` is called with 51 items
        THEN  the response is `400` with `error.code` identifying a validation failure
              AND no activity in the request is updated

S2-AC4  (negative) GIVEN a logged-in STORE_MANAGER of store-001 and activity C belonging to store-002
        WHEN  `PATCH /api/activities/bulk-status` is called with `{ items: [{ id: C.id, status: 'DONE' }] }`
        THEN  the response is `200` with the item `{ id: C.id, outcome: 'FAILED', code: 'NOT_FOUND' }`

S2-AC5  (negative) GIVEN no `Authorization` header
        WHEN  `PATCH /api/activities/bulk-status` is called with any valid body
        THEN  the response is `401`

S2-AC6  GIVEN a logged-in STORE_MANAGER of store-001 and store-001 activity D (IN_PROGRESS) assigned to associate U
        WHEN  `PATCH /api/activities/bulk-status` updates D to `DONE` successfully
        THEN  a `Notification` is stored for user U with `type: 'SHIFT_HANDOVER'` and `relatedId: D.id`

## Dependencies
Sprint 1 (`bulkUpdateStatusSchema`, `ActivitiesService.bulkUpdateStatus`, `activity.bulk_status_updated` event).

## Definition of done
- `npm run verify` green; coverage >= 90%.
- Every criterion has a test named `S2-AC<m>: ...` asserting HTTP status + body field, or stored notification state.
- `docs/openapi.yaml` updated for the new route.
- Only files under `src/activities/`, `src/alerts/`, `src/app.ts` (if needed), `docs/openapi.yaml` and `tests/` changed.
