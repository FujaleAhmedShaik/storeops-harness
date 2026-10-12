STATUS: AWAITING APPROVAL
FEATURE: <short title>
SPRINTS: <n>
PROMPT_REF: .harness/output/feature-prompt.md

# Spec: <short title>

## Summary
<What is being added and why, in 3-5 sentences, in StoreOps terms.>

## Assumptions
<Numbered. Every guess you made because the prompt was silent. The developer reviews these before approving.>
1. ...

## API and event surface
| Kind | Definition |
|---|---|
| Endpoint | `PATCH /api/activities/bulk-status` - request/response shape, roles, status codes |
| Event | `activity.status_changed` (existing) / `<new.event>` payload fields |
| Port | `<Consumer>` needs `<method>` from `<Provider>` |

## Sprints
| Sprint | Title | Modules touched | Criteria |
|---|---|---|---|
| 1 | ... | activities | 6 |

## Risks and open questions
- ...

## Traceability
Each requirement in the prompt maps to criteria: `<requirement> -> S1-AC1, S2-AC3`.
