# Harness Design Brief

> **Draft.** The facts below are taken from the files in this repository, and the reasons are the ones we gave when we made each decision. Before you submit, read every "I chose ... because" and change it to what you really think; the brief is marked on your own reasoning. Section A needs the real run, and the **TODO (you)** lines are yours. The limit is 3 pages, so cut if it runs over. Delete this note when done.

## A. Intent decomposition

**What the harness does.** I type one prompt, `@planner <feature>`. A Planner agent turns it into a spec and sprint contracts. I read the spec and reply `APPROVED`. After that the Generator, the Evaluator and the Monitor run on their own, one sprint at a time, until every sprint passes or the run stops and asks me. The agents never share a conversation. They pass work to each other only through files, so a long run cannot muddy a later sprint.

**How a feature is cut into sprints.** The Planner follows one skill file, `sprint-decomposition`:

- A sprint is a vertical slice that leaves the build green by itself. Lower layers come first: sprint 1 is the domain (types, rules, events, unit tests), sprint 2 is the surface (route, wiring, OpenAPI, API tests).
- At most 3 sprints, 10 changed files and 8 acceptance criteria per sprint. If the feature does not fit, the Planner says so instead of stuffing a sprint.
- A sprint never needs to touch the inside of two modules. Work that crosses modules is a read-only port or an event.
- Every sprint lists what is out of scope, and a hard gate checks the changed files against it.

**How criteria are written.** Each one is GIVEN / WHEN / THEN with an id like `S1-AC3`. It is testable, not subjective, because the THEN may only name things a test can read: the HTTP status plus a body field or error code, what is stored afterwards, an event that was emitted, or a typed error. Words like "properly" or "gracefully" are banned. Every business rule also gets a negative case (403, 404 across stores, 409, 400). The quick test is whether a developer could write the `expect(...)` lines without asking a question.

**The feature I used and how it was cut.** I asked for a shift handover bulk update: `PATCH /api/activities/bulk-status` lets outgoing staff mark up to 50 activities DONE or BLOCKED in one request. A bad item is reported with a reason code and never stops the others, and every updated activity gets an audit entry through the event bus. The Planner cut it into two sprints. Sprint 1 is the domain: the input schema, the types, the new event and the service method. Sprint 2 is the surface: the route, the alerts subscriber that records the audit entry, and the OpenAPI file. The boundary sits there because sprint 1 leaves the build green without any route, and sprint 2 is the only place that touches two modules (activities and alerts), and only through an event. The Planner also named a risk of its own: the bulk route has to be registered before `PATCH /:id`, or Express reads `bulk-status` as an id.

**What had to change before I approved.** The first spec contradicted the code. My prompt said the existing status rules still apply, but four criteria (S1-AC6, S2-AC1, S2-AC2, S2-AC6) moved an activity straight from TODO to DONE, and the transition table only allows TODO to go to IN_PROGRESS or BLOCKED. A Generator following those criteria would either fail its own tests or loosen the rule. I did not spot this by eye; checking the spec against the code with Claude Code's help found it, and I sent it back to the Planner. The Planner fixed it in about a minute and a half. The four criteria now start the activity at IN_PROGRESS, and one new criterion (S1-AC8) shows that a TODO activity sent to DONE is rejected for that item with INVALID_STATUS_TRANSITION and nothing changes. The transition rules were not touched, and sprint 1 went from 7 criteria to 8. I compared the second version with the first and nothing else had changed.

**One sprint contract entry in full:** <!-- TODO (you): paste one real acceptance criterion from your sprint-1-contract.md, exactly as the Planner wrote it. For the format, the skill's own example is: S1-AC3  GIVEN a STORE_MANAGER of store-001 and activity A in status DONE  WHEN ActivitiesService.update(manager, A.id, { status: 'TODO' }) is called  THEN it rejects with ConflictError code INVALID_STATUS_TRANSITION AND A is still DONE AND no event is emitted. Use a real one from your run instead. -->

## B. Governance framework

**Skill files.** There are eight, each with one job and each tied to StoreOps rather than general advice:

| Skill | What it holds | Read by |
|---|---|---|
| `app-context` | the five modules, entities, business rules, API and file layout | Planner, Generator, Monitor |
| `architecture-principles` | the seven architecture rules, the failure each prevents, how it is enforced | Planner, Generator, Evaluator |
| `sprint-decomposition` | how to cut sprints and write criteria; the spec and contract formats | Planner |
| `coding-conventions` | TypeScript and OWASP rules | Generator |
| `feature-playbook` | the exact steps and files to add an endpoint, port or event | Generator |
| `how-to-test` | tests that assert business outcomes, the 90% bar | Generator |
| `how-to-review` | the Evaluator's procedure, turning judgement into binary results | Evaluator |
| `grading-criteria` | the four dimensions, every check, the hard gates, the verdict rules | Evaluator |

`architecture-principles` is the one shared by three agents on purpose, so the Planner, the Generator and the Evaluator all work from the same rules. The Evaluator deliberately does not read `app-context`, so it judges the code against the rules and the contract, not against what the app is "meant" to do. A test fails if `grading-criteria` and `evaluation.json` drift apart.

**The reviews folder as an audit trail.** `.harness/reviews/` is committed to Git. The Monitor writes it, never by hand. For each sprint it keeps the contract, the Generator's summary, the Evaluator's feedback and a run log with the verdict, score, iterations and failed checks. It keeps **every** attempt, not only the last, so a FAIL followed by a PASS is visible. Anyone with repository access can read it, and Git history and blame apply. A recurring problem shows up through `npm run harness:trends`, which counts failed checks across all run logs and names the skill file responsible. A check that fails in two or more sprints means that skill file needs work.

**One rule that encodes a StoreOps decision: the event bus.** Rule R3 says a change in one module that affects another module goes through `bus.emit(<typed event>)`, and the other module subscribes. It never calls or writes into a sibling module. Without it, a new rule in `activities` would have to hard-code its effect on `alerts`, and every later subscriber would need another edit to `activities`. It is checked by the hard gate ARCH-04, backed by the dependency check ARCH-01. This is one of the four problems the standards team raised (state written straight into a sibling module).

## C. Non-determinism strategy

**Dimensions.** There are four, and the weights are 35, 35, 20 and 10:

- Architecture and module boundaries (35). Three of the four failures the client named are boundary failures.
- Correctness and test quality (35). The fourth failure is tests that only check status codes.
- Security and code quality (20). The client needs OWASP and a clean scan, but the code-level rules mostly come from tools.
- Contract and change hygiene (10). It keeps changes inside the allowed files and the OpenAPI file in step.

There are 21 checks. 11 are run by tools (type check, tests, coverage, lint, audit, duplication, dependency rules and so on) and 10 are judged by the Evaluator, which must give a PASS or FAIL with evidence.

**Hard gates.** Twelve checks are hard gates, and any one failing means FAIL whatever the score. Each of the four named failures has one: ARCH-01 (imports from another module's repository), ARCH-02 (raw `Error` throws), COR-04 (tests that check only the status code, not the business result), ARCH-04 (missing event bus). The rest cover type errors, failing tests, coverage under 90%, lint, high vulnerabilities, unvalidated input and scope or tampering (GOV-01). They cannot be soft checks, because a soft check can be averaged away: a sprint could score 90 and still contain a repository import. Every dimension has at least one tool-run hard gate, so a lenient Evaluator cannot pass something the tools reject.

**Same results, same verdict.** The Evaluator never writes the verdict. A script reads the check results and applies fixed rules. A missing, duplicated or `UNSURE` result, or an LLM `PASS` with no evidence, is turned into FAIL. Results are tied to one sprint and iteration and are used up once routed, so an old or replayed file cannot drive a verdict. Then: any failed hard gate is FAIL. Otherwise the score is the sum of each weight times the share of its checks that passed. 90 or more is PASS, 75 to 89 is CONDITIONAL PASS (move on, and the failed soft checks are carried into the next sprint), and below 75 is FAIL. For example, if everything passes except the soft check ARCH-05, architecture scores 35 x 5/6 = 29.2 and the total is 94.2, so PASS. If a hard gate such as COR-04 fails instead, it is FAIL even though the score would be 87.5.

**A real example from my run:** <!-- TODO (you): one real walk-through from the run: what the Generator produced, which checks failed, the score, the verdict. Use the actual numbers from sprint-1-evaluator-feedback.md. -->

**Escalation.** A sprint gets at most three attempts. A fourth is never made automatically. If the third attempt is still FAIL, the run stops. The Monitor records it and the developer (me, the person who started the run) gets `escalation.md`: the sprint, the attempts used, the blocking hard gates, a table of each attempt, and three options. A copy is kept in `.harness/reviews/`.

## D. Architectural decisions

**1. The machine decides, the AI only gives evidence.** I could have let an AI judge say whether the work was good. I chose fixed rules because a judge can be talked into a pass, and the same work could get different verdicts on different days. The cost is that the checks must be written precisely, and some real problems that are hard to state as yes or no are missed. <!-- TODO (you): in your own words, why this mattered to you and what you gave up. -->

**2. Test the harness itself before trusting it.** Before any real run I asked a fresh Claude agent that knew nothing about the project to review the harness against the brief. It found gaps: old results could be reused, a raw error could slip past, the Evaluator could edit the code to get a pass, and a check could be marked "not applicable" to skip it. I fixed each one and added tests (the repo has 494). The cost was time before I had anything to show. <!-- TODO (you): anything you would add about this decision. -->

**3. The harness feeds the pipeline, it does not replace it.** The Evaluator runs the same `npm run verify` that the pipeline runs, and the pipeline repeats it with SonarCloud, CodeQL, secret scanning, container scanning and the deployment. I did not want the harness to be the only gate. This turned out to matter: after my first push the pipeline found problems the harness could not see, such as wrong Azure role ids and a setting written as "True" instead of "true". The cost is that some checks run twice. <!-- TODO (you): confirm this is how you see it. -->
