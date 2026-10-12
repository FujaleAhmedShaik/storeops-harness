# OWASP mapping

Controls implemented in code and pipeline. "Verified by" names the automated evidence. This is a self-assessment for a
capstone reference codebase, not a certification; items under *Not addressed* are real gaps.

## OWASP Top 10 (2021)

| Risk | Controls | Verified by |
|---|---|---|
| A01 Broken access control | JWT on every `/api/*` route; role checks; **store scoping** and owner rules in services; cross-store access returns 404; deny by default | `tests/app.test.ts` (401 matrix), `tests/activities/*`, `tests/programmes/*` |
| A02 Cryptographic failures | scrypt (N=2^15, r=8, p=3) with per-user salt and bounded parameters; HS256 JWT with >= 32-char secret from Key Vault; TLS only on Container Apps (`allowInsecure: false`); HSTS | `tests/shared/password.test.ts`, `tests/shared/token.test.ts` |
| A03 Injection | strict zod schemas on body, query and params; UUID-validated ids; no SQL/shell/eval; Sonar + CodeQL + `eslint-plugin-security` | lint, CodeQL, Sonar |
| A04 Insecure design | business rules in services (transitions, role ceilings, closed programmes); rate limits; bounded pagination and body size | service tests |
| A05 Security misconfiguration | helmet; no `x-powered-by`; distroless non-root read-only container; capabilities dropped; config validated at startup; prod refuses demo data; Checkov on IaC | `tests/app.test.ts`, `tests/shared/config.test.ts`, Trivy, Checkov |
| A06 Vulnerable components | `npm audit` gate, Trivy image scan, Dependabot, pinned lockfile, SBOM | CI |
| A07 Identification and authentication failures | login throttling (10/min/IP), constant-time compare, decoy hash for unknown users (no user enumeration), generic error, pinned JWT algorithm, short token lifetime | `tests/staff/staff.test.ts`, `tests/shared/token.test.ts` |
| A08 Software and data integrity failures | immutable image tag (commit SHA), OIDC federation instead of stored cloud credentials, SBOM, lockfile + `npm ci` | CI |
| A09 Logging and monitoring failures | structured JSON logs with request ids, redaction of credentials, Log Analytics + App Insights | `tests/shared/logger.test.ts` |
| A10 SSRF | the API makes no outbound requests from user input | by design |

## OWASP API Security Top 10 (2023)

| Risk | Controls |
|---|---|
| API1 Broken object level authorisation | every by-id read/update/delete resolves through `getAccessible()` (store scope) before any rule |
| API2 Broken authentication | see A07 |
| API3 Broken object property level authorisation | `strictObject` schemas reject unknown or privileged fields (mass assignment); responses never include password hashes |
| API4 Unrestricted resource consumption | rate limits, 16 kB body limit, `limit <= 100`, `offset <= 100000`, scrypt input length cap and parameter bounds, request timeouts |
| API5 Broken function level authorisation | role checks in services (supervisor-only reassign/priority, manager-only programme creation and delete) |
| API6 Unrestricted access to sensitive business flows | login throttling; status machine prevents reopening DONE work |
| API7 Server-side request forgery | no outbound calls |
| API8 Security misconfiguration | see A05; ZAP API scan against the deployed dev app |
| API9 Improper inventory management | OpenAPI in `docs/openapi.yaml`; separate dev and prod environments |
| API10 Unsafe consumption of APIs | no third-party API consumption |

## Not addressed (known gaps, state them honestly)

- No central identity provider (Entra ID / OIDC), refresh tokens or token revocation: tokens are short-lived HS256.
- In-memory storage and per-replica rate limiting: no persistence, no shared limits across replicas.
- Key Vault and ACR are reachable over public endpoints (RBAC-protected); no private networking or WAF.
- ZAP runs in passive/safe mode in CI; a full active scan should run against a disposable environment.
