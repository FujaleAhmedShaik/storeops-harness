# Reflection

> **Draft.** Everything below is what I know so far, before the real harness run. The **TODO (you)** lines need what actually happened in the run. The brief says one page at most, so cut anything that does not fit. Delete this note when you are done.

## What the harness did well

I made one rule at the start: the AI never decides pass or fail. Every check is a yes or no with evidence behind it, and if an answer is missing or unclear it counts as a fail. That rule is in the code and the tests check it, so it does not depend on the AI being in a good mood.

Before using the harness I asked a fresh Claude agent, one that knew nothing about the project, to review it against the brief. It found real gaps. Old test results could be reused for a new sprint. A raw error could slip past the error rules. The Evaluator could edit the code to get a pass. A check could be marked "not applicable" just to skip it. I fixed each one and added tests for it. I found these before the run, not during it.

<!-- TODO (you): one or two things the harness really did well in the run. For example, a gate that caught a real problem, or feedback that pointed to a file and line. Say which iteration. -->

## Where it fell short

The harness only looks at the code, and my biggest problems were not in the code. After my first push I hit wrong Azure role ids, a setting written as "True" when the app wants "true", a password saved with an invisible newline at the end, and invisible spaces in an infrastructure file. All of it passed locally, with 494 tests and 99% coverage. Only a real deployment showed it.

There are also weak spots I know about and chose to leave. The contract is not locked with a hash. One architecture check reads text instead of really parsing the code. One file scored only 33% in mutation testing, because the tests do not check its timing behaviour.

<!-- TODO (you): where the harness fell short in the run. Did it loop, argue with itself, miss something, or cost more iterations than you expected? Be specific and honest. -->

## One improvement I would make

Run the settings the infrastructure sends to the app through the app's own settings check, inside the same gate that runs before any deployment. That check would have caught the "True" problem on my laptop instead of in Azure. It fits what I decided in the design: use checks a machine can prove before relying on anyone's opinion.

<!-- TODO (you): name the exact Design Brief decision this connects to (section and what you wrote), because the marking asks for that link. -->
