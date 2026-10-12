---
name: coding-conventions
description: StoreOps TypeScript conventions and the security rules (OWASP) every change must follow. Read before writing or reviewing code.
---

# Coding conventions and security rules

**Purpose:** make generated code indistinguishable from the existing code and safe by default. Checked by `COR-01` (tsc strict), `SEC-01` (ESLint incl. eslint-plugin-security, 0 warnings), `SEC-03` (duplication <= 3%), `GOV-04` (no leftovers), and by review for the security rules below.

## Style (match the surrounding code; do not invent a new style)

- Files: `<module>.<layer>.ts` (kebab/lowercase). One class per service/repository. Interfaces and in-memory implementation live together in `<module>.repository.ts`.
- Types: `readonly` fields on domain interfaces; string-literal unions from `src/shared/domain.ts` (`as const` arrays + derived types), not enums. No `any`, no non-null `!`, no `as` casts to silence the compiler (a cast is acceptable only where TypeScript cannot narrow and the surrounding code does the same).
- Dependency injection through the constructor, with an injectable **clock** (`() => Date`) and **id factory** (`() => string`, default `randomUUID`) so tests are deterministic. Never call `new Date()` or `randomUUID()` inline in a service.
- Services return plain objects, never mutate their inputs (use spread). Repositories return stored objects and are async (`Promise`) to keep the interface storage-agnostic.
- Errors: see `architecture-principles` R4. Pick the class by meaning: bad input `ValidationError` (400), missing or other-store resource `NotFoundError` (404), role problem `ForbiddenError` (403), business-rule conflict `ConflictError(code, message)` (409) with an UPPER_SNAKE code that names the rule.
- No `console.*` (lint-enforced). Logging only via the injected `Logger`. No TODO/FIXME, commented-out code or unused exports.
- Keep functions small and flat; extract a private method instead of copy-pasting (duplication is gated at 3%).
- Comments explain *why*, only where non-obvious. Match the density of the surrounding file.

## Security rules (OWASP Top 10 / API Top 10)

1. **Validate every input** (`SEC-04`, hard): body, query and params each parsed with `parseInput(schema, ...)` using `z.strictObject({...})` so unknown fields are rejected (mass assignment). Ids are `z.uuid()`. Strings have `.max()`. Enums use the `as const` arrays from `src/shared/domain.ts` (`TASK_STATUSES`, `STAFF_ROLES`, ...).
2. **Bound every list:** list endpoints spread `...paginationShape` into their query schema and return `paginate(...)`'s `{ data, total, limit, offset }` (limit <= 100).
3. **Authorisation lives in the service** (`SEC-05`): scope by store with `canAccessStore`, resolve by-id access through a `getAccessible`-style method that throws `NotFoundError` across stores, and use `isSupervisor` / `isStoreManager` from `src/shared/access.ts` for roles. Routes only call `currentUser(req)` and pass it to the service. Never trust ids or roles from the request body.
4. **Never leak** (`SEC-06`): no passwords, tokens, hashes or stack traces in logs or responses; error messages state the rule, not internals. Logs go through the redacting logger.
5. **No new dependencies, no outbound calls, no `eval`/`Function`, no dynamic `require`, no `fs`/`child_process`.** `package.json` is protected; a new dependency requires a human decision, so escalate it.
6. **Do not weaken a gate.** Never edit jest/eslint/tsconfig/dependency-cruiser/jscpd config, CI, infra or harness files (`GOV-01` is a hard gate and the write guard blocks the edit).

## HTTP conventions

- Create returns `201` with the created resource; update `200` with the updated resource; delete `204` with no body; list `200` with the page object.
- Status codes come from the thrown `AppError`, never set by hand in a service.
- New routers are mounted behind `requireAuth` in `src/app.ts`; only login is unauthenticated.
