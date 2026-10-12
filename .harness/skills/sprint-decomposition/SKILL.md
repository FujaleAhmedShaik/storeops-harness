---
name: sprint-decomposition
description: How the Planner turns a feature prompt into spec.md and sprint contracts with testable GIVEN/WHEN/THEN acceptance criteria. Also defines the contract and spec formats other agents rely on.
---

# Sprint decomposition

**Purpose:** a Generator can only be judged against criteria that are precise enough to turn into an assertion. This file defines how to cut a feature into sprints and how to write criteria that are testable, not subjective.

## 1. Cutting sprints

- A sprint is a **vertical slice that leaves `npm run verify` green on its own** and is demonstrable. Never leave the build red between sprints.
- Order by dependency, lower layers first. Typical cut for an endpoint feature:
  - **Sprint 1: domain.** types, zod schemas, repository method, service rules, new event(s), unit tests. No route yet.
  - **Sprint 2: surface.** route, wiring in `src/app.ts`, subscriber (alerts/reports), `docs/openapi.yaml`, API tests.
- Limits that keep context small and review honest: **<= 3 sprints**, **<= 10 files changed** and **<= 8 acceptance criteria** per sprint. If a feature does not fit, say so in the spec rather than overstuffing a sprint.
- Every sprint states what is **out of scope**, so the Generator does not wander (scope is also checked by `GOV-01`).
- Boundaries follow the architecture: a sprint never needs to touch two modules' internals; cross-module work is a port or an event.

## 2. Acceptance criteria (GIVEN / WHEN / THEN)

Format, one criterion per behaviour, ids `S<sprint>-AC<n>`:

```
S1-AC3  GIVEN a STORE_MANAGER of store-001 and activity A in status DONE
        WHEN  ActivitiesService.update(manager, A.id, { status: 'TODO' }) is called
        THEN  it rejects with ConflictError code INVALID_STATUS_TRANSITION
              AND A is still DONE in the repository
              AND no event is emitted
```

A criterion is **testable** when the THEN names one or more of these observables, with exact values:
1. HTTP status **and** a body field or error `code`;
2. stored state (what the repository holds afterwards);
3. an emitted event (`name` and a payload field);
4. a typed error class or `code`.

Rules:
- GIVEN states roles, store, and existing data precisely. WHEN is **one** action (a method call or one HTTP request). THEN uses only the observables above.
- **Every business rule gets a negative criterion** (403, 404 across stores, 409, 400) as well as the happy path.
- Forbidden vague words in a criterion: *properly, correctly, appropriate, handles, gracefully, as expected, works, user-friendly, robust, quickly*.
- Quick test: can a developer write the `expect(...)` lines from the THEN without asking a question? If not, rewrite it.
- The Generator names each test `S<n>-AC<m>: ...` so the Evaluator can trace criterion -> test (`COR-04`).

## 3. Formats (machine-readable markers are mandatory)

### spec.md (`.harness/output/spec.md`)

```
STATUS: AWAITING APPROVAL
FEATURE: <short title>
SPRINTS: <n>
PROMPT_REF: .harness/output/feature-prompt.md
```
then: Summary; Assumptions (every guess you made, numbered); API and event surface (methods, paths, events); Sprint table (id, title, modules touched, AC count); Risks; Open questions. **Write assumptions instead of asking**: the developer reviews them at approval. Never write code.

### sprint-N-contract.md

```
SPRINT: <n>
TITLE: <title>
FEATURE: <same as spec>
STATUS: READY
```
then: Goal (one sentence); Scope (files or layers expected); Out of scope; Acceptance criteria; Dependencies (earlier sprint ids); Definition of done (`npm run verify` green, coverage >= 90%, `openapi.yaml` updated if routes change, tests named by AC id). Use the template in `.harness/templates/sprint-contract.md`.

## 4. Carry-over

If the previous sprint ended CONDITIONAL PASS, its failed soft checks are listed in `.harness/output/carry-over.md`; copy them into the next contract as extra criteria.
