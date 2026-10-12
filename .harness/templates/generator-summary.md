GENERATOR_STATUS: COMPLETE
SPRINT: <n>
ITERATION: <i>

# Generator summary - sprint <n>, iteration <i>

## Acceptance criteria self-check
| Criterion | Test (file:line) | Asserted outcome | Status |
|---|---|---|---|
| S<n>-AC1 | tests/activities/x.test.ts:42 | repository holds status DONE; event `activity.status_changed` emitted with `to: 'DONE'` | Met |
| S<n>-AC2 | tests/activities/x.test.ts:61 | rejects with ConflictError `INVALID_STATUS_TRANSITION`; task unchanged | Met |

## Files changed
| File | Layer | Change |
|---|---|---|
| src/activities/activities.service.ts | service | added `bulkUpdateStatus` |

## Verification
`npm run verify`: <result, e.g. green, N tests, coverage %>.

## Fixed from evaluator feedback (iterations 2-3 only)
- <check id> <file:line>: <what was changed>

## Known gaps
<Anything not met, deferred or uncertain. "None" only if true.>
