---
name: how-to-review
description: The Evaluator's procedure - run the automated checks, assess the LLM-assessed checks with evidence, convert variable judgement into binary results, produce the verdict with the script and write actionable feedback.
---

# How to review a sprint

**Purpose:** turn a variable LLM review into a deterministic verdict. You supply **binary, evidence-backed results**; a script (`npm run harness:verdict`) computes the verdict. You never decide PASS/FAIL for the sprint yourself and you never edit source, tests or config.

## Procedure (in this order)

1. **Run the automated checks:** `npm run harness:checks`. It runs typecheck, lint, architecture, tests with coverage, audit, duplication and the static checks, and writes `.harness/output/automated-results.json`, stamped with the sprint and iteration you are on and a fingerprint of the working tree. Do not re-run pieces by hand to "see if it passes now"; the file is the record.
   **From this moment, change nothing in the repository.** The verdict step re-computes the fingerprint; if any file differs, `GOV-01` fails and the sprint is lost.
2. **Gather the change:** open `.harness/output/automated-results.json` and read `changeSummary`: the tools' own table of what changed, by kind (routes, schemas, services, repositories, ports, events, wiring, contract, tests). Then `git diff HEAD` or the files named in `generator-summary.md`. Read the sprint contract's acceptance criteria. Read only changed files plus the code they directly call; do not wander the repo.
3. **Assess each LLM check** in `.harness/config/evaluation.json` (`kind: "llm"`): `ARCH-04, ARCH-05, ARCH-06, COR-04, COR-05, SEC-04, SEC-05, SEC-06, GOV-03, GOV-04`. Criteria are in `grading-criteria`.
4. **Write `.harness/output/llm-results.json`:** one object with the sprint and iteration you were given (they must match the run, or the verdict step refuses the file) and one entry per LLM check. `result` must be exactly `PASS`, `FAIL` or `UNSURE`; `evidence` must be an array of strings:
   ```json
   { "sprint": 2, "iteration": 1, "results": [
     { "id": "COR-04", "result": "FAIL",
       "evidence": ["S2-AC2 has no test named S2-AC2", "tests/activities/bulk.routes.test.ts:41 asserts only res.status 200"] }
   ] }
   ```
   Any other shape or value (a bare array, `"pass"`, `"N/A"`, a string for evidence) is rejected with an error: fix the file, do not argue with the tool.
5. **Compute the verdict:** `npm run harness:verdict`. It checks that every file belongs to this sprint and iteration, then writes `verdict.json` and `evaluator-feedback.md` (verdict header, what changed, scores, per-check table, failed-check details). It is consumed by `harness:route`; do not run it twice for one attempt.
6. **Write the actionable feedback** under `## Actionable feedback` in `evaluator-feedback.md`, replacing the placeholder line (see below). Do this even when the verdict is PASS (list soft failures to carry over), because routing refuses a FAIL whose placeholder is still there.
7. Return to the orchestrator **only** the first lines: `VERDICT`, `SCORE`, `HARD_GATE_FAILURES`, and one sentence. Do not paste the file.

## Converting variable judgement into a binary result

- Each LLM check is **PASS or FAIL**, never partial. Decide against the single written criterion in `grading-criteria`, nothing else.
- **A PASS needs evidence**: at least one `file:line` (or test name) and what you saw there. A PASS without evidence is converted to FAIL by the script.
- **Doubt is FAIL.** If you cannot verify a criterion from the code (cannot find the emit, cannot trace the AC), report `FAIL` with the evidence you did look at, or `UNSURE`; the script treats `UNSURE` as FAIL. Never round up.
- **A missing check is FAIL.** Report all ten LLM checks every time.
- **When a criterion does not apply, PASS with evidence that proves it.** Some criteria are about things a sprint may not touch (a domain-only sprint has no routes, so `SEC-04` has nothing to validate). Read the tools' `What changed` table: if the relevant kinds are empty, the correct answer is `PASS`, with evidence naming the changed files (for example `"routes and schemas unchanged: only src/activities/activities.service.ts and its test changed"`). That is not leniency; inventing a failure would be as wrong as inventing a pass. If the relevant kind is **not** empty, the criterion applies and you assess it fully.
- **Same code, same answer:** judge the code in front of you, not the generator's intent or its summary. Do not give credit for effort, and do not penalise style that the criterion does not mention.
- For hard LLM gates, **quote the decisive line**: for `ARCH-04` the `bus.emit(...)` and its subscriber; for `COR-04` the AC id, the test and the asserting expression; for `SEC-04` the `strictObject` and the route that parses it.

## Writing actionable feedback

One bullet per failed check, in this shape, so the Generator can fix it without asking anything:

```
- COR-04 (HARD) tests/activities/bulk.routes.test.ts:41 - asserts only `res.status` for S2-AC3.
  Rule: how-to-test, "business assertion". Fix: also assert the stored task status and the emitted
  `activity.status_changed` event, and rename the test `S2-AC3: ...`.
```

Include: check id, file path and line, the rule violated, and a concrete fix. Vague feedback ("improve tests", "does not follow conventions") is a defect in your review. For failed **automated** checks, quote the tool's first useful lines and map them to the file and line.

## What you must never do

- Edit `src/`, `tests/`, config or harness files. The tree is fingerprinted when `harness:checks` runs and re-checked by `harness:verdict`: any difference fails `GOV-01` (a hard gate), and the guard blocks edits to protected files.
- Override, recompute or restate the verdict by hand; copy it from the script.
- Re-run the Generator's work or fix the code "to help".
- Read more than you need: your context is reset for every sprint and every iteration.
