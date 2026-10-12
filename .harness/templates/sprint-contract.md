SPRINT: <n>
TITLE: <title>
FEATURE: <same as spec>
STATUS: READY

# Sprint <n> contract: <title>

## Goal
<One sentence.>

## Scope
<Files or layers expected to change, e.g. `src/activities/activities.service.ts`, `activities.schemas.ts`, `tests/activities/...`.>

## Out of scope
<What this sprint must NOT do (later sprints, other modules).>

## Acceptance criteria
S<n>-AC1  GIVEN <roles, store, existing data>
          WHEN  <one action: method call or HTTP request with exact body>
          THEN  <observable: status + body field / stored state / event name + payload field / error code>

S<n>-AC2  (negative) GIVEN ...
          WHEN  ...
          THEN  ...

## Dependencies
<Earlier sprints, or "none".>

## Definition of done
- `npm run verify` green; coverage >= 90%.
- Every criterion has a test named `S<n>-AC<m>: ...` asserting state, event, error code or body field.
- `docs/openapi.yaml` updated if a route changed.
- Only files under `src/`, `tests/` and `docs/openapi.yaml` changed.
