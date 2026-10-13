STATUS: APPROVED
FEATURE: Shift handover bulk activity status update
SPRINTS: 2
PROMPT_REF: .harness/output/feature-prompt.md

# Spec: Shift handover bulk activity status update

## Summary
Outgoing shift staff need to close out or flag many operational activities in one call instead of one PATCH per activity.
`PATCH /api/activities/bulk-status` accepts up to 50 `{ id, status }` items, where `status` is restricted to `DONE` or
`BLOCKED`. Each item is evaluated independently against the existing authorisation, store-scoping and status-transition
rules; a bad item is reported with a reason code and never aborts the others. Every item that does update emits the
existing `activity.status_changed` event plus a new `activity.bulk_status_updated` audit event; the `alerts` module
subscribes to the new event and records an in-app `SHIFT_HANDOVER` notification as the audit entry, exactly like its
existing reactions to `activity.assigned` / `activity.status_changed`.

## Assumptions
1. "Supervisor" reuses the existing `isSupervisor` helper (DEPARTMENT_LEAD and above) already used by `ActivitiesService.update`.
2. The whole request is rejected (400, nothing processed, no events emitted) only for request-shape problems: more than 50
   items, zero items, a status outside `DONE`/`BLOCKED`, or a malformed id. Everything that needs the repository (missing
   activity, cross-store, forbidden, bad transition) is a **per-item** failure, never a whole-request failure.
3. Per-item reason codes: `NOT_FOUND` (missing or another store's activity, matching the single-item `getAccessible`
   behaviour), `FORBIDDEN` (not creator/assignee/supervisor), `INVALID_STATUS_TRANSITION` (existing transition table:
   `TODO` -> `IN_PROGRESS` or `BLOCKED`; `DONE` is reachable only from `IN_PROGRESS`; this endpoint never changes the
   transition table, it only applies it per item).
4. Duplicate ids in one request are each processed independently against the (possibly already-updated) stored state;
   no special-cased de-duplication.
5. The audit notification recipient is the activity's assignee if one is set, otherwise its creator (mirrors the existing
   "who cares about this activity" logic used elsewhere in `alerts`), type `SHIFT_HANDOVER` (already defined in `AlertType`),
   `relatedId` = the activity id.
6. Response is `200 OK` whenever the request shape is valid, even if every item fails individually (bulk endpoints report
   partial failure in the body, not via HTTP status), consistent with the prompt's "one bad item never aborts the others".
7. Priority and assignee are unchanged by this endpoint; it only ever sets `status`, so the existing "priority/assignee
   needs a supervisor" rule is out of scope here.

## API and event surface
| Kind | Definition |
|---|---|
| Endpoint | `PATCH /api/activities/bulk-status` - body `{ items: [{ id: uuid, status: 'DONE' \| 'BLOCKED' }] }`, 1..50 items. 200 body `{ results: [{ id, outcome: 'UPDATED', from, to } \| { id, outcome: 'FAILED', code }], updated: number, failed: number }`. 400 `ValidationError` if items.length is 0, > 50, or any item's `status`/`id` fails schema. 401 if unauthenticated. |
| Event | `activity.status_changed` (existing, emitted per updated item, unchanged payload) |
| Event | `activity.bulk_status_updated` (new) `{ taskId, title, storeId, assigneeId, createdBy, updatedBy, from, to }` |
| Subscriber | `alerts` subscribes to `activity.bulk_status_updated`, creates a `SHIFT_HANDOVER` notification per updated activity (the audit entry) |

## Sprints
| Sprint | Title | Modules touched | Criteria |
|---|---|---|---|
| 1 | Bulk status domain rules | activities | 8 |
| 2 | Bulk status route and audit subscriber | activities, alerts | 6 |

## Risks and open questions
- Route ordering: `PATCH /api/activities/bulk-status` must be registered before `PATCH /:id` in `activities.routes.ts`,
  otherwise Express would treat `bulk-status` as an `:id` value. Sprint 2 scope calls this out explicitly.
- `isSupervisor`/`canAccessStore` are existing `shared/access` helpers; no new cross-module port is needed since the
  feature stays inside `activities`, and `alerts` only reacts to the new event (R3, no direct call).
- The existing transition table does not allow `TODO` -> `DONE` directly (only `TODO` -> `IN_PROGRESS`/`BLOCKED`, and
  `DONE` only from `IN_PROGRESS`). All example/test setups that move an item to `DONE` start it at `IN_PROGRESS`;
  `S1-AC8` is the single criterion proving a `TODO` -> `DONE` item is rejected per-item as `INVALID_STATUS_TRANSITION`.

## Traceability
- "mark many... DONE or BLOCKED in one request" -> S1-AC1, S1-AC6, S2-AC1
- "partial failure... valid items updated, invalid ones reported per item with a reason code, one bad item never aborts
  the others" -> S1-AC2, S1-AC3, S1-AC4, S1-AC6, S2-AC2, S2-AC4
- "creator, assignee or a supervisor" -> S1-AC3
- "activities of other stores are rejected" -> S1-AC2, S2-AC4
- "existing status transition rules still apply" -> S1-AC4, S1-AC8
- "audit entry per updated activity by emitting an event that alerts records" -> S1-AC1, S2-AC6
- "limit a request to 50 items" -> S1-AC5, S2-AC3
