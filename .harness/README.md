# .harness

Everything that governs AI-assisted development of StoreOps. Kept apart from `.github/` (CI/CD) on purpose.

| Folder | Contents |
|---|---|
| `agents/` | planner, generator, evaluator, monitor definitions (`*.agent.md`) |
| `skills/<name>/SKILL.md` | project knowledge each agent reads before acting |
| `config/evaluation.json` | dimensions, weights, checks, hard gates, thresholds, protected paths (single source of truth) |
| `templates/` | formats for spec, sprint contract, generator summary |
| `tools/` | deterministic verdict, routing, scope check, write guard, run log (`cli.ts` is the only I/O) |
| `output/` | working files during a run (gitignored) |
| `reviews/` | archived sprint evidence, committed as the audit trail |

Start with `CLAUDE.md` (the orchestrator, in the repository root) and `README.md` ("Using the harness"). The scoring rules are explained in `skills/grading-criteria/SKILL.md`.
