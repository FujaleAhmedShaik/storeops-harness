# Reflection

## What the harness did well

I made one rule at the start: the AI never decides pass or fail. Every check is a yes or no with evidence, and a missing or unclear answer counts as a fail. The tests check that rule, so it does not depend on the AI being in a good mood.

Before using the harness I asked a fresh Claude agent, one that knew nothing about the project, to review it. It found real gaps: old test results could be reused, a raw error could slip past, the Evaluator could edit the code to get a pass, and a check could be marked "not applicable" to skip it. I fixed each one and added tests, before the run.

The approval step also worked. The Planner's first spec had four criteria that moved an activity from TODO straight to DONE, which the existing rules forbid. Nothing is built until a person says APPROVED, so it was sent back before any code existed, and the Planner fixed it in about a minute and a half. Both sprints then passed on the first attempt with all 21 checks green. I confirmed it afterwards: 513 tests, 99.7% statement coverage and no duplication.

## Where it fell short

The harness only looks at the code, and my biggest problems were not in the code. After my first push I hit wrong Azure role ids, a setting written "True" when the app wants "true", a password saved with a hidden newline, and invisible spaces in an infrastructure file. All of it passed locally. Only a real deployment showed it.

The Planner did not check its own examples against the code, and nothing in the harness does, so a person had to notice. The sprint 2 contract also named a test file that does not exist, and the Monitor's note for sprint 1 says it built the endpoint when sprint 1 had no route. No check caught either. Two perfect first attempts also mean this run never shows a retry or an escalation; that path is proved by the tests, not by the run. The audit entry is best effort, because the event bus only logs a failing subscriber. Other weak spots I know about: the contract is not locked with a hash, and one file scored only 33% in mutation testing.

## One improvement I would make

Run the settings the infrastructure sends to the app through the app's own settings check, inside the gate that runs before deployment. It would have caught the "True" problem on my laptop instead of in Azure, and it fits my design rule: use checks a machine can prove before relying on anyone's opinion.

This is the same idea as decision 1 in Section D of my Design Brief (the machine decides, and the AI only supplies evidence) and it extends the tool-run hard gates described in Section C: a check that a machine can run, placed before deployment, instead of a check that relies on a person noticing.
