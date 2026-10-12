# Sprint reviews: the governance audit trail

This folder is **committed** (unlike `.harness/output/`, which holds working files during a run). It is written by the
Monitor through `npm run harness:runlog -- <sprint>`, never by hand.

| File | Written by | Meaning |
|---|---|---|
| `spec.md` | archived copy | the approved spec for the run |
| `sprint-N-contract.md` | archived copy | the criteria the sprint was judged against |
| `sprint-N-generator-summary.md` | archived copy | what the Generator claimed (AC table, files, gaps) |
| `sprint-N-evaluator-feedback.md` | archived copy | the final verdict, per-check results with evidence, file and line feedback |
| `sprint-N-iter-K-evaluator-feedback.md`, `-verdict.json`, `-generator-summary.md` | archived copy | **every** attempt, not just the last: the FAIL-then-PASS story is the audit trail |
| `sprint-N-run-log.md` | Monitor | sprint id, verdict, score, iterations used, escalation flag, **estimated** token cost, failed checks per iteration, quality trend notes |
| `sprint-N-escalation.md` | archived copy | present only if the sprint escalated |

**Who can read it:** everyone with repository access; it is plain Markdown in git, so history, blame and code review apply.

**How it surfaces a recurring problem:** `npm run harness:trends` counts failed checks across all `sprint-*-run-log.md` files and
names the skill file responsible for each. A check that fails in two or more sprints is the signal to refine that skill file.

A second feature run: move the previous run's files into `.harness/reviews/archive/<feature>/` first so names do not collide.
