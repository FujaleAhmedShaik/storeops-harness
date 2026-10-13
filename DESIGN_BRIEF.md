# Harness Design Brief

## A. Intent decomposition

I type one prompt, `@planner <feature>`. A Planner turns it into a spec and sprint contracts; I read the spec and reply `APPROVED`. The Generator, Evaluator and Monitor then run one sprint at a time until every sprint passes or the run stops and asks me. The agents never share a conversation and pass work only through files, so a long run cannot muddy a later sprint.

**Sprints and criteria.** A sprint is a vertical slice that leaves the build green by itself, lower layers first, with at most 3 sprints, 10 files and 8 criteria each, and an explicit out-of-scope list that a hard gate checks. A sprint never needs the inside of two modules; cross-module work is a read-only port or an event. Every criterion is GIVEN / WHEN / THEN, and its THEN may only name something a test can read: a status plus a body field or error code, stored state, an emitted event, or a typed error. Vague words ("properly", "gracefully") are banned, and each business rule gets a negative case.

**My feature.** I asked for a shift handover bulk update: `PATCH /api/activities/bulk-status` marks up to 50 activities DONE or BLOCKED, reports each bad item with a reason code without stopping the others, and writes an audit entry per update through the event bus. The Planner made two sprints. Sprint 1 is the domain (schema, types, new event, service method). Sprint 2 is the surface (route, the alerts subscriber that records the audit entry, OpenAPI). The boundary is there because sprint 1 leaves the build green without a route, and sprint 2 is the only place two modules meet, and only through an event. The Planner also warned that the route must be registered before `PATCH /:id`.

**What changed before I approved.** The first spec contradicted the code. Four criteria moved an activity straight from TODO to DONE, but the existing transition table only allows TODO to go to IN_PROGRESS or BLOCKED, and my prompt said existing rules still apply. Checking the spec against the code, with Claude Code's help, found it and I sent it back. The Planner fixed it in about a minute and a half: those criteria now start at IN_PROGRESS and a new criterion, S1-AC8, proves the rejection. Nothing else had changed. It is the example entry:

```
S1-AC8  (negative) GIVEN a STORE_MANAGER of store-001 and store-001 activity H (TODO, manager is creator)
        WHEN  `ActivitiesService.bulkUpdateStatus(manager, { items: [{ id: H.id, status: 'DONE' }] })` is called
        THEN  the result has `failed: 1` with that item `{ outcome: 'FAILED', code: 'INVALID_STATUS_TRANSITION' }`
              AND H's stored status is still `TODO`
              AND no event is emitted
```

## B. Governance framework

**Skill files.** Eight, each with one job and specific to StoreOps:

| Skill | Holds | Read by |
|---|---|---|
| `app-context` | modules, entities, business rules, file layout | Planner, Generator, Monitor |
| `architecture-principles` | the seven architecture rules, what each prevents, how it is enforced | Planner, Generator, Evaluator |
| `sprint-decomposition` | sprint cutting, criteria rules, spec and contract formats | Planner |
| `coding-conventions` | TypeScript and OWASP rules | Generator |
| `feature-playbook` | exact steps and files to add an endpoint, port or event | Generator |
| `how-to-test` | tests that assert business outcomes, the 90% bar | Generator |
| `how-to-review` | turning judgement into binary results | Evaluator |
| `grading-criteria` | dimensions, checks, hard gates, verdict rules | Evaluator |

`architecture-principles` is shared by three agents so they work from the same rules. The Evaluator does not read `app-context`, so it judges the code against the rules and contract, not against what the app is "meant" to do. A test fails if `grading-criteria` and `evaluation.json` drift apart.

**The reviews folder as an audit trail.** `.harness/reviews/` is committed and written by the Monitor, never by hand. Per sprint it keeps the contract, the Generator's summary, the Evaluator's feedback and a run log, and it keeps **every** attempt, so a FAIL then PASS is visible. Anyone with repository access can read it, and Git history applies. `npm run harness:trends` counts failed checks across run logs and names the skill file responsible; a check failing in two or more sprints means that skill needs work.

**One rule that encodes a StoreOps decision: the event bus (R3).** A change in one module that affects another goes through `bus.emit(<typed event>)`, and the other module subscribes; it never calls or writes into a sibling. Without it, a new rule in `activities` would hard-code its effect on `alerts`, and every later subscriber would need another edit to `activities`. Hard gate ARCH-04 checks it, backed by the dependency check ARCH-01.

## C. Non-determinism strategy

**Dimensions.** Architecture and module boundaries (35), because three of the client's four named failures are boundary failures. Correctness and test quality (35), because the fourth is tests that only check status codes. Security and code quality (20), mostly enforced by tools. Contract and change hygiene (10), which keeps changes in scope. There are 21 checks: 11 run by tools and 10 judged by the Evaluator, which must give PASS or FAIL with evidence.

**Hard gates.** Twelve checks are hard gates; any one failing is FAIL whatever the score. Each named failure has one: ARCH-01 (another module's repository), ARCH-02 (raw `Error` throws), COR-04 (tests that check only the status code), ARCH-04 (missing event bus). The rest cover type errors, failing tests, coverage under 90%, lint, high vulnerabilities, unvalidated input, and scope or tampering (GOV-01). They cannot be soft, because a soft check can be averaged away: a sprint could score 90 and still import another module's repository. Every dimension has a tool-run hard gate, so a lenient Evaluator cannot pass what the tools reject.

**Same results, same verdict.** The Evaluator never writes the verdict; a script applies fixed rules. A missing, duplicated or `UNSURE` result, or an LLM `PASS` without evidence, becomes FAIL. Results are tied to one sprint and attempt and used up once routed, so a stale file cannot drive a verdict. Any failed hard gate is FAIL; otherwise the score is each weight times the share of its checks passed, with 90+ PASS, 75 to 89 CONDITIONAL PASS (move on, carry failed soft checks forward) and below 75 FAIL. Example: only the soft check ARCH-05 fails, so architecture scores 35 x 5/6 = 29.2 and the total is 94.2, a PASS; if hard gate COR-04 fails instead, it is FAIL although the score would be 87.5.

**From my run.** In sprint 1 the Generator added the method, schema, event and 8 tests. The 11 tool checks ran and the Evaluator passed the 10 judged checks with file-and-line evidence, for example that the event is emitted through the bus. All 21 passed, so 35 + 35 + 20 + 10: PASS at 100.0 on the first attempt, and sprint 2 did the same. This run shows no retry or escalation; the FAIL paths are covered by the harness tests (`npm run harness:demo`).

**Escalation.** A sprint gets at most three attempts; a fourth is never made automatically. After a third FAIL the run stops, the Monitor records it, and I get `escalation.md` with the sprint, attempts, blocking gates, a table of attempts and three options, copied to `.harness/reviews/`.

## D. Architectural decisions

**1. The machine decides; the AI only supplies evidence.** The alternatives were an AI judge scoring against a rubric, or a human reviewing every sprint. I chose fixed rules because the client's four failures are the kind a lenient reviewer waves through, and the same work should get the same verdict on any day. The cost: 10 of 21 checks are still judged by the Evaluator, so determinism sits in the conversion, not the judgement, and the rules require evidence to be present, not true. I limited that with a tool-run hard gate in every dimension. I also gave up anything hard to state as yes or no, such as naming or design taste. Two 100.0 scores do not prove the gates reject bad work; only the tests do.

**2. Test the harness before trusting it.** The alternative was to run it and fix what broke. A failure in the demonstration run costs the whole run, so a fresh Claude agent that knew nothing of the project reviewed it first. It found real gaps: reusable old results, raw errors slipping past, an Evaluator able to edit code to pass, and checks marked "not applicable". I fixed each and added tests. The cost: time before I had anything to show, and more machinery to maintain. The reviewer was an AI, so it was a second opinion, not proof, and it missed things: a contract named a test file that does not exist and no check caught it. I accepted known limits: the contract is not hashed, one architecture check reads text rather than parsing, and the audit entry is best effort.

**3. The harness feeds the pipeline and does not replace it.** The alternatives were all checks inside the harness, or the pipeline alone. The harness runs the same `npm run verify`, keeping one definition of the gate, and the pipeline repeats it and adds SonarCloud, CodeQL, scanning and deployment. The agents never push, so nothing reaches `main` unless the pipeline passes. It mattered: after my first push the pipeline found a wrong Azure role id, a setting written "True" for "true" and a password with a hidden newline, all passing locally. The cost: some checks run twice and two places must stay in step. Settings the harness cannot see are still not checked before deployment.
