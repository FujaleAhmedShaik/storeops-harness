# Architecture journal

This repository was built with Claude Code, Anthropic's AI coding tool. Claude Code wrote the application code, the harness files, the pipelines and the documents,
and it ran the checks. I set the requirements, made the decisions below, and asked for the changes and reviews. I used Claude Code for the design and the
implementation, and I decided what to keep. This journal was drafted with Claude Code from our working sessions, so the events in it are accurate.

## 2026-10-09: starting out

I gave Claude Code the Build Track brief and create a project folder and give me a plan before building anything. I asked for these standards:
more than 90% test coverage, no Sonar, security or duplication problems, and the OWASP standards. I also asked for a local Podman and Docker setup and CI/CD on Azure.
I asked whether the pipeline could create the Azure resources, and whether that code should live in a separate repository.

Claude Code recommended these, and I told it to go with all of them:

- Node.js with TypeScript for StoreOps
- Azure Container Apps for hosting
- Bicep for the infrastructure, kept in the same repository in an `infra/` folder, with its own pipeline
- Podman for local containers

I added that SonarCloud should run only in the pipeline, not on my machine. Since I plan to put the code and the demo video on GitHub, we used GitHub Actions with OIDC login to Azure.

## 2026-10-09: the StoreOps application

Claude Code generated the application: 5 modules, 3 layers, the 9 base endpoints and a login endpoint, with in-memory storage.
I did not paste the brief's exact bootstrap prompt. The application was built in a conversation from a fuller specification, with real business rules instead of stubs.
I need to explain that difference if a reviewer asks.

## 2026-10-09: testing the tests

The first full check run failed in parallel because password hashing was too slow in tests. Claude Code changed the hash format so it records its own settings, and tests now use a cheap setting only when `NODE_ENV=test`.

Mutation testing scored 81.5% on the first run. It showed one function that was never used, a request logger that no test covered, and some password tests that failed for the wrong reason.
After those were fixed the score was 93.5%.

## 2026-10-09: container and supply chain

Trivy found serious OpenSSL problems in the Debian 12 base image, and pulling a fresh image did not fix them. Node 20 also reached end-of-life in April 2026.
So the project uses Node 24 on Debian 13 (distroless), where Trivy found nothing. This is different from the "Node 20" in the brief, and I will say so in the brief.
Hadolint also asked for a numeric user id in the Dockerfile, which was fixed.

## 2026-10-09: infrastructure code

Checkov could not read the Bicep file directly, so it scans the compiled ARM template instead. It reported 7 findings. They are accepted for this project, and each one has a reason written in `.checkov.yaml`. I have not gone through them one by one yet.
Two examples: the registry and key vault stay reachable from the public internet because the GitHub runners need them, and key vault purge protection is on in prod but off in dev so I can recreate dev quickly.

## 2026-10-09 to 2026-10-10: the harness

The design rule is that the AI never decides pass or fail. The Evaluator gives yes/no answers with evidence, and a small tested program works out the verdict.
Missing, unsure or evidence-free answers count as failures.

The setup has 4 scoring areas (35/35/20/10), 21 checks and 12 hard gates. The pass mark is 90, and I allow 75 to 89 as a conditional pass.
A sprint gets 3 tries before it stops and asks me. The harness files, the CI files and the settings that control the gates are protected, so the agents cannot edit them during a run.

A practice run on a scratch copy with deliberately broken code found two real bugs, and both were fixed: a missing folder for the Jest report, and the protection check being case-sensitive, which is a problem on Windows.

## 2026-10-10 to 2026-10-11: problems found on the way

- Shell scripts were saved by git without the executable flag, so the Linux pipeline would have failed. Every script is now run with `bash`.
- I asked about line endings on Windows and Mac. A check that looked like it found CRLF files was a false alarm, because the tool was misreading the pattern. Counting the actual bytes showed the files already use LF.
- I asked about ignoring "reports" folders. A plain `reports/` rule in `.gitignore` would also have hidden `src/reports` and `tests/reports`, which are real code, so the rule is now `/reports/`.
- VS Code showed `tsconfig.json` in red because of a deprecated setting. Claude Code changed it to `node16`.
- Linting the workflow files found style problems, and we found that the infrastructure workflow and the CI/CD workflow could deploy to the same environment at the same time. They now share one lock per environment.

## 2026-10-12: dependency upgrade, and a decision not to follow it all the way

I asked Claude Code to bring every package to its latest version. Express moved to major version 5 and ESLint to major version 10, with the rest picking up smaller bumps. Typecheck, lint, the architecture check, the duplication check and the full test suite all stayed green afterwards.

I decided not to take TypeScript to its new major version 7, even though it is npm's `latest` tag. `ts-jest` and `typescript-eslint` only support TypeScript up to just before 6.1/7, so moving now would have broken the test and lint toolchain for no real gain, and I'd rather wait for those tools to catch up. TypeScript stays on 5.9.3. For the same reason I kept `@types/node` on the 24.x line that matches the Node version the Dockerfile builds with, not the newer 26.x that the upgrade tool picked up from my own machine.

The upgrade also surfaced a test that was already flaky before any of this: `tests/server.test.ts`'s "force-closes connections" test could race ahead of the server and measure 0ms instead of waiting out the shutdown grace period, and the client socket in that test had no error handler, so a reset connection could crash the whole Jest worker. I wrote that fix myself, not Claude Code, following the same pattern as the rest of the file, since the timing assertion was easy to get subtly wrong and I wanted to reason through it by hand.

When I run th Azure pre-flight script it printed garbled lines and false failures because of carriage return. Now it has been fixed with one small shared wrapper (`infra/scripts/_common.sh`)

## 2026-10-13: writing the deployment note, the reflection and the design brief

For `DEPLOYMENT.md`, `REFLECTION.md` and `DESIGN_BRIEF.md`, I told Claude Code what to put in them: what I had built, the decisions I had decided, and what I learned along the way (the deployment problems, the review of the harness, and the evidence I had collected). Claude Code then worded it in plain language and put it into the structure the brief asks for. So the content comes from my project and my decisions, and the wording of these first drafts is Claude Code's.

The drafts only cover what has happened so far. The new endpoint, the real run results and the example sprint contract do not exist yet, so those parts are marked `TODO` and I will fill them in after the harness run. Before I submit, I will read each document and change anything that does not match what I think, especially the reasons in the design brief.

## 2026-10-13: the first real harness run, and what I sent back

I chose the shift handover bulk update from the brief's list of suggested features, because it exercises the error contract, the event bus and the role checks. I started Claude Code in the repository and sent this prompt to the Planner:

> @planner Add shift handover bulk update. PATCH /api/activities/bulk-status lets outgoing shift staff mark many operational activities DONE or BLOCKED in one request. Handle partial failure: valid items are updated, invalid ones are reported per item with a reason code, and one bad item never aborts the others. Only an activity's creator, assignee or a supervisor may update an item, activities of other stores are rejected, and the existing status transition rules still apply. Write an audit entry per updated activity by emitting an event that the alerts module records. Limit a request to 50 items.

The Planner came back with a spec of two sprints (13 acceptance criteria in total) and a list of assumptions. I did not approve it straight away. I had Claude Code check the spec against the real code, and it found a contradiction: four criteria (S1-AC6, S2-AC1, S2-AC2 and S2-AC6) move an activity from TODO straight to DONE, but the transition table in `activities.service.ts` only lets TODO go to IN_PROGRESS or BLOCKED. My prompt said the existing transition rules still apply, so the spec disagreed with my own requirement. If I had approved it, the Generator would have had to fail its own tests or loosen the rule.

I sent that back to the Planner instead of approving, and saved the first version of the spec and the contracts outside the repository, because the Planner overwrites them. Two smaller points I noted but did not block on: sending the same id twice in one request is processed twice, and a HIGH or CRITICAL activity set to BLOCKED will raise the existing escalation alert as well as the new SHIFT_HANDOVER one.

The Planner revised the spec in about a minute and a half. I diffed the new spec and both contracts against the copies I had saved. The four criteria (S1-AC6, S2-AC1, S2-AC2 and S2-AC6) now start the activity at IN_PROGRESS. The Planner added one criterion, S1-AC8, which shows that a TODO activity sent to DONE is rejected for that item with INVALID_STATUS_TRANSITION, with no state change and no event. It also wrote the transition table into the spec and the sprint 1 contract and marked it out of scope to change. Nothing else differed. Sprint 1 now has 8 criteria and sprint 2 still has 6.

Before typing APPROVED I had to commit my notes, because the orchestrator refuses to start unless the working tree is clean apart from `PROMPT.md`. Pushing was not needed: the harness makes its branch from my local main, so the notes travel with it.
