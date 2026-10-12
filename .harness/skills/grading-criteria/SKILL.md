---
name: grading-criteria
description: The evaluation framework - four weighted dimensions, every check with explicit pass/fail criteria, which checks are hard gates and why, and the deterministic verdict rules. Mirrors .harness/config/evaluation.json.
---

# Grading criteria

**Source of truth:** `.harness/config/evaluation.json`. This file explains it; a test (`tests/harness/harness-consistency.test.ts`) fails if a check id is missing here, so the two cannot drift.

## Verdict rules (deterministic)

1. A check that is **missing, duplicated, `UNSURE`, has any result other than `PASS`/`FAIL`/`UNSURE`, or is an LLM `PASS` without evidence** is converted to **FAIL** (fail-closed). A malformed `llm-results.json` is refused outright.
   Result files are **bound** to the sprint and iteration they belong to and are **consumed** when routed, so a stale or replayed file can never drive a verdict.
2. **Any failed hard gate => `FAIL`**, whatever the score.
3. Otherwise: score = sum over dimensions of `weight x (checks passed / checks in dimension)`.
   - score >= **90** => `PASS`
   - score >= **75** => `CONDITIONAL PASS` (advance; failed soft checks become carry-over for the next sprint)
   - below 75 => `FAIL`
4. `FAIL` => the Generator retries with the feedback, at most **3 iterations** per sprint, then the run **escalates** to the developer.

Worked example: all checks pass except `ARCH-05` (soft). Architecture has 6 checks: 35 x 5/6 = 29.2; the other dimensions are full (35 + 20 + 10); total **94.2 => PASS**. If instead `COR-04` (hard) fails, the verdict is **FAIL** although the score would still be 87.5.

## Dimensions and checks

### Architecture and module boundaries (35%)

| Check | Gate | Kind | Pass criterion |
|---|---|---|---|
| ARCH-01 | **HARD** | auto | `npm run arch` exits 0: no cross-module repository/service/internal import, no layer skipping, no cycle |
| ARCH-02 | **HARD** | auto | no `throw` or `reject` of a built-in Error type in `src/` (with or without `new`, one line or split), and no class extending a built-in Error outside `src/shared/errors.ts` |
| ARCH-03 | **HARD** | auto | every method on `src/reports/*.ports.ts` starts with get/find/list/count/summarise/read |
| ARCH-04 | **HARD** | llm | every cross-module effect is `bus.emit(<typed event>)` with a subscriber; no direct call or write into a sibling module |
| ARCH-05 | soft | llm | routes only parse -> one service call -> respond; rules in services; repositories do data access only |
| ARCH-06 | soft | llm | new reads are ports wired in `src/app.ts`; new events typed in `src/shared/events.ts` |

### Correctness and test quality (35%)

| Check | Gate | Kind | Pass criterion |
|---|---|---|---|
| COR-01 | **HARD** | auto | `npm run typecheck` 0 errors |
| COR-02 | **HARD** | auto | Jest: 0 failed tests and suites |
| COR-03 | **HARD** | auto | Jest exits 0 with >= 90% thresholds (global, services, routes, shared) |
| COR-04 | **HARD** | llm | every acceptance criterion has a test named with its id that asserts state, event, error code or body field, not only an HTTP status |
| COR-05 | soft | llm | tracing each criterion through the code finds it implemented, including the negative paths |

### Security and code quality (20%)

| Check | Gate | Kind | Pass criterion |
|---|---|---|---|
| SEC-01 | **HARD** | auto | `npm run lint` 0 errors, 0 warnings |
| SEC-02 | **HARD** | auto | `npm audit --omit=dev --audit-level=high` exits 0 |
| SEC-03 | soft | auto | jscpd <= 3% duplication |
| SEC-04 | **HARD** | llm | all new inputs validated by `z.strictObject`; ids `z.uuid()`; lists use `paginationShape` |
| SEC-05 | soft | llm | store-scoped access returns NotFound across stores; role rules in the service and tested |
| SEC-06 | soft | llm | no credentials, tokens, hashes or internals in logs, responses or errors |

### Contract and change hygiene (10%)

| Check | Gate | Kind | Pass criterion |
|---|---|---|---|
| GOV-01 | **HARD** | auto | changed files only under `src/`, `tests/`, `docs/openapi.yaml`; none protected; at least one file under `src/` or `tests/` changed; the working tree did not change between the checks and the verdict (an Evaluator must not edit code) |
| GOV-02 | soft | auto | if a `*.routes.ts` changed, `docs/openapi.yaml` changed |
| GOV-03 | soft | llm | generator summary lists every AC with its test, every changed file with its layer, and honest known gaps |
| GOV-04 | soft | llm | no TODO/FIXME, commented-out code, unused exports or stubs in changed files |

Every dimension has at least one **automated** hard gate (ARCH-01, COR-01, SEC-01, GOV-01), so a lenient assessor cannot pass a sprint the tools reject.

## Why each hard gate cannot be a soft check

| Gate | Failure it prevents | Why not soft |
|---|---|---|
| ARCH-01 | Cross-module repository imports | One import corrupts the boundary for every later feature; a score cannot trade it against test quality |
| ARCH-02 | Raw Error throws | A raw Error becomes an anonymous 500; the typed contract is all-or-nothing |
| ARCH-03 | Reports writing to other modules | The read-only guarantee is meaningless if "mostly" |
| ARCH-04 | Missing event-bus integration | Cannot be detected by tools, so a lenient pass would silently reintroduce failure mode 4; evidence is mandatory |
| COR-01..03 | Broken build, failing or untested code | Not negotiable; deterministic tool outputs |
| COR-04 | Status-code-only tests | The exact failure the standards team saw; weak tests make every other check unreliable |
| SEC-01, SEC-02 | Insecure code, vulnerable dependencies | A single high finding is a release blocker |
| SEC-04 | Unvalidated input | Injection and mass assignment are exploitable from one missed route |
| GOV-01 | Weakening the gates or adding dependencies to make a sprint pass | If the gates can be edited by the agent they prove nothing |

## Handling the evaluator's own ambiguity (fallbacks)

Missing result, `UNSURE`, an unknown result value, evidence-free PASS, duplicate or conflicting results all become FAIL.

**When a criterion does not apply** (for example `SEC-04` on a sprint that changed no routes or schemas), the answer is `PASS` with evidence that names the changed files, taken from the tools' "What changed" table. There is no `N/A`: an explicit, evidenced PASS is deterministic, and inventing a failure would be as wrong as inventing a pass. Unknown check ids are ignored and reported. Because the fallback is always the stricter outcome, ambiguity can cost a retry but can never let a defect through.
