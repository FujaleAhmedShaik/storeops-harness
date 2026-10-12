# StoreOps harness: orchestrator

This repository holds **StoreOps** (a retail operations REST API, `src/`) and the **harness** that governs how AI agents extend it (`.harness/`). This file is the orchestrator: Claude Code reads it automatically. Facts about the code live in `.harness/skills/app-context/SKILL.md`; read it before any code work.

Outside a harness run (any prompt that does not start with `@planner`), behave as a normal careful developer: follow `.harness/skills/architecture-principles`, `coding-conventions` and `how-to-test`, and finish with `npm run verify`.

## 1. Entry prompt format

```
@planner <feature description in one or two paragraphs>
```

Example: `@planner Add shift handover bulk update: PATCH /api/activities/bulk-status lets outgoing staff mark many activities DONE or BLOCKED in one request, with partial-failure handling and an audit entry per updated activity.`

A message that begins with `@planner` starts a run (Claude Code may render the mention as `@agent-planner`; treat both the same). If the mention does not resolve in the client, take the rest of the message as the prompt and invoke the `planner` subagent explicitly.

The developer's only active steps are **(1) that prompt** and **(2) typing `APPROVED`** after reviewing `spec.md`. Everything between is autonomous until all sprints pass or the run escalates.

## 2. Agents (each runs in its own fresh context)

| Agent | Definition | Invoked by | Reads (skills) | Writes (handoff) |
|---|---|---|---|---|
| planner | `.harness/agents/planner.agent.md` | `@planner` / Agent tool `planner` | app-context, architecture-principles, sprint-decomposition | `.harness/output/spec.md` (`STATUS: AWAITING APPROVAL`), `sprint-N-contract.md` |
| generator | `.harness/agents/generator.agent.md` | Agent tool `generator` | app-context, architecture-principles, coding-conventions, how-to-test, feature-playbook | code in `src/`, tests, `generator-summary.md` |
| evaluator | `.harness/agents/evaluator.agent.md` | Agent tool `evaluator` | architecture-principles, how-to-review, grading-criteria | `llm-results.json`, `verdict.json`, `evaluator-feedback.md` |
| monitor | `.harness/agents/monitor.agent.md` | Agent tool `monitor` | app-context | `.harness/reviews/sprint-N-run-log.md` + archived artefacts |

`.claude/agents/*.md` are thin wrappers that point to the definitions above so the agents can be addressed by name. Handoff files all live in `.harness/output/` (gitignored working area); the permanent record is `.harness/reviews/`.

## 3. Sequence

1. **Plan.** Save the developer's prompt verbatim to `.harness/output/feature-prompt.md` **and** to `PROMPT.md` in the repo root (the permanent record of the request; do not paraphrase). Invoke `planner`. It writes `spec.md` (first line `STATUS: AWAITING APPROVAL`, plus `FEATURE:` and `SPRINTS:`) and every `sprint-N-contract.md`.
2. **Stop and ask.** Show the developer the planner's short summary and the path to `spec.md`. Say: *"Review `.harness/output/spec.md`. Reply APPROVED to start, or tell me what to change."* **Do nothing else until the developer replies.** Feedback is not approval: re-invoke `planner` with it and ask again.
3. **Approved.** Only when the developer's message is `APPROVED`:
   - require a clean baseline: `git status --short` must show nothing except `PROMPT.md` (otherwise ask the developer to commit or stash first);
   - if on `main`, create a branch `harness/<feature-slug>` (never commit to `main`), then commit `PROMPT.md` with the message `Record feature prompt for the harness run`;
   - change the first line of `spec.md` to `STATUS: APPROVED` and run `npm run harness:init`.
4. **Loop, per sprint N (starting at 1), per iteration I (starting at 1):**
   a. Invoke `generator` with: `Sprint N, iteration I. Follow .harness/agents/generator.agent.md.` (On I > 1 it reads `evaluator-feedback.md`.)
   b. Invoke `evaluator` with: `Sprint N, iteration I. Follow .harness/agents/evaluator.agent.md.`
   c. Run `npm run harness:route`. It reads the verdict and applies the routing rules below, and prints `{"action": ...}`.
   d. Act on the action (section 4).
5. **Finish.** After `COMPLETE`: run `npm run verify` once more, then report to the developer: sprints and verdicts, branch name, the review files, and that the next step is pushing the branch so CI runs. Do not push yourself.

## 4. Routing (implemented in `.harness/tools/routing.ts`, tested; do not improvise)

| Verdict (the `VERDICT:` line of `evaluator-feedback.md`, which `harness:verdict` copies from `verdict.json`; `harness:route` reads `verdict.json`) | Condition | Action | What you do |
|---|---|---|---|
| `PASS` | more sprints | `ADVANCE` | invoke `monitor` for sprint N, then commit (below), then start sprint N+1 |
| `PASS` | last sprint | `COMPLETE` | invoke `monitor`, commit, finish |
| `CONDITIONAL PASS` | as PASS | `ADVANCE` / `COMPLETE` | as PASS, plus write `.harness/output/carry-over.md` (the failed soft checks and their feedback) so the next sprint fixes them |
| `FAIL` | iteration < 3 | `RETRY` | re-invoke `generator` for the same sprint (iteration + 1) |
| `FAIL` | iteration = 3 | `ESCALATE` | invoke `monitor` (it records the escalation), stop, show the developer `.harness/output/escalation.md` |

**Result files are bound to one attempt.** `automated-results.json`, `llm-results.json` and `verdict.json` carry the sprint and iteration they belong to; `harness:verdict` and `harness:route` refuse a file for a different attempt, and `harness:route` deletes them after routing (keeping copies of every attempt in `.harness/output/history/`). If either command reports a stale or missing file, **re-invoke the evaluator for the same sprint and iteration**; never edit or recreate a result file yourself and never route twice.

Commit after the monitor has run, on the harness branch: `git add -A && git commit -m "Implement sprint N: <title> (harness <VERDICT> <score>)"` (imperative mood, e.g. `Implement sprint 1: bulk status service rules (harness PASS 97.5)`). Reviews are committed; `.harness/output/` is gitignored. Never commit on `ESCALATE`.

**Hard limit: three iterations per sprint.** A fourth attempt is never made automatically.

### Escalation output

`.harness/output/escalation.md` (written by `harness:route`) names the sprint, iterations used, blocking hard gates, a per-iteration history table and the three options for the developer. It is copied to `.harness/reviews/sprint-N-escalation.md` by the monitor. The developer receives it in the chat; the run is then inactive and protected files are editable again.

## 5. Context scoping and reset strategy

- **Every agent invocation starts with a fresh context** (subagents do not inherit the conversation). State travels only through files in `.harness/output/`, so a long run cannot degrade a later sprint's context.
- Each agent loads only its listed skills (table above); the evaluator deliberately does not load `app-context`. Skill depth is a token budget: skills are 1-2 pages each; add detail only when `harness:trends` shows a recurring failure it would fix.
- **You, the orchestrator, keep your own context small:** never read `src/`, `tests/`, or whole feedback files. Rely on each agent's short return (<= 12 lines) and on `harness:route` output. Between sprints you carry only: current sprint and iteration, the verdict line, the branch name.
- Resumability: `.harness/output/state.json` holds sprint, iteration and history. If the session is interrupted, read it and continue from there; do not restart the sprint.
- Token cost is estimated by the monitor (about four characters per token of agent context plus output); it is a lower bound and is labelled as an estimate.

## 6. Guard rails

- While a run is active (`state.json` has `"active": true`), a `PreToolUse` hook (`.claude/settings.json`) blocks edits to **protected files**: gate configs, `package.json`, `.github/`, `infra/`, `.harness/` (except `output/` and `reviews/`), `CLAUDE.md`, `tests/harness/`. The list is `protectedPaths` in `.harness/config/evaluation.json`.
- The hook only sees Edit/Write tools. A shell command that changes a protected file is caught afterwards by hard gate `GOV-01`.
- You never edit `src/` or `tests/` yourself during a run, never override a verdict, never write `llm-results.json`, and never mark the spec `APPROVED` on your own.
- Never fabricate artefacts: every file in `.harness/reviews/` must come from a real run of the tools.

## 7. Relation to CI/CD

`npm run verify` is the single definition of the fast quality gates. The Evaluator runs the same checks (plus LLM-assessed ones) **before** a change leaves the machine, so the harness **precedes and feeds** the pipeline. `.github/workflows/ci-cd.yml` re-runs `npm run verify` and adds what is too slow or environment-specific for the inner loop (SonarCloud, mutation testing, Trivy, ZAP, deployment). CI never trusts a harness verdict. Harness files live in `.harness/`; pipeline files live in `.github/`.

## 8. Reference

| Topic | File |
|---|---|
| Layout of `.harness/` | `.harness/README.md` |
| Checks, weights, hard gates | `.harness/config/evaluation.json`, `.harness/skills/grading-criteria/SKILL.md` |
| Tool commands | `npm run harness:init \| checks \| verdict \| route \| runlog -- N \| trends` |
