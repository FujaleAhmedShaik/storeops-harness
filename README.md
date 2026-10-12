# StoreOps Harness

Capstone Case Study 1 (Build Track, AI-Native Tech Architect programme): a **Claude Code development harness**
(Planner / Generator / Evaluator / Monitor) governing a retail operations REST API, **StoreOps**.
Built with Claude Code's help (see `JOURNAL.md`).

> Capstone reference codebase - not for production use.

| Part | Where |
|---|---|
| StoreOps API: 5 modules, 9 base endpoints plus login, in-memory storage | `src/`, `tests/` |
| API contract (also drives the security scan) | `docs/openapi.yaml` |
| Local containers (Podman or Docker) | `Dockerfile`, `compose.yaml` |
| CI/CD (GitHub Actions to Azure) | `.github/workflows/` |
| Infrastructure as code (Bicep) | `infra/` |
| Harness: orchestrator, 4 agents, 8 skills, evaluation rules, deterministic tools | `CLAUDE.md`, `.harness/`, `.claude/` |

## Quick start

Needs Node.js 24 LTS (22 also works; Node 20 reached end-of-life in April 2026), Git, and Podman or Docker for containers.

```bash
npm ci
npm run init:env          # creates .env with random secrets (git-ignored); never overwrites an existing .env
npm run verify            # types, lint, architecture, duplication, tests >= 90%, audit
npm run dev               # http://127.0.0.1:3000
```

`.env` is never committed. The demo password for every seeded user is `DEMO_PASSWORD` from your `.env`; nothing sensitive is stored in source.

### Configuration

| Variable | Default | Notes |
|---|---|---|
| `APP_ENV` | `local` | `local`, `dev` or `prod`. Demo users are refused when `prod` |
| `JWT_SECRET` | none, required | At least 32 characters. Stored in Key Vault in Azure |
| `SEED_DEMO_DATA` | `false` | `true` seeds five demo users (needs `DEMO_PASSWORD`) |
| `DEMO_PASSWORD` | none | At least 16 characters |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | The container image sets `HOST=0.0.0.0` |
| `RATE_LIMIT_MAX` | `300` per minute per IP | Raise only for load tests |
| `LOGIN_RATE_LIMIT_MAX` | `10` per minute per IP | Credential-stuffing guard |
| `JWT_TTL_SECONDS` | `900` | Access token lifetime |
| `TRUST_PROXY_HOPS` | `0` | `1` behind Azure Container Apps ingress |
| `LOG_LEVEL` | `info` | `silent` in tests |

## Running it

**With Node:**

```bash
npm run build && npm run start:local        # production-style, reads .env (Node 22+)
npm run dev                                 # auto-reload
curl http://127.0.0.1:3000/health/live      # {"status":"ok"}
```

**In a container (Podman, recommended, or Docker):**

```bash
npm run container:up        # podman compose up -d --build   (Docker: docker compose up -d --build)
podman compose ps           # wait for "healthy" (about 10 seconds)
npm run container:logs
npm run container:down
```

The container runs hardened: non-root user, read-only root filesystem, all Linux capabilities dropped, `no-new-privileges`, 256 MB and 0.5 CPU cap, listening only on `127.0.0.1`.
If `podman compose` says the machine is not running: `podman machine start`.

**Smoke test (all endpoints, readable PASS/FAIL output):**

```bash
set -a; . ./.env; set +a                                   # Git Bash, WSL, macOS, Linux
BASE_URL=http://127.0.0.1:3000 node scripts/smoke.js
```

```powershell
Get-Content .env | ForEach-Object { if ($_ -match '^(\w+)=(.*)$') { Set-Item "env:$($Matches[1])" $Matches[2] } }
$env:BASE_URL = 'http://127.0.0.1:3000'; node scripts/smoke.js
```

**By hand with curl:**

```bash
BASE=http://127.0.0.1:3000
PASS=$(grep ^DEMO_PASSWORD= .env | cut -d= -f2)
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"manager.s1@storeops.example\",\"password\":\"$PASS\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).accessToken')
curl -s -X POST $BASE/api/programmes -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"Spring refit"}'
curl -s $BASE/api/activities -H "Authorization: Bearer $TOKEN"
```

In PowerShell use `curl.exe` (plain `curl` is a different command) or `Invoke-RestMethod`.

**Demo users** (all share `DEMO_PASSWORD`; data is in memory and resets when the process restarts):

| Email | Role | Store |
|---|---|---|
| `regional.manager@storeops.example` | REGIONAL_MANAGER | all stores |
| `manager.s1@storeops.example` | STORE_MANAGER | store-001 |
| `lead.s1@storeops.example` | DEPARTMENT_LEAD | store-001 |
| `associate.s1@storeops.example` | ASSOCIATE | store-001 |
| `manager.s2@storeops.example` | STORE_MANAGER | store-002 |

**Performance check:** the rate limiter rejects more than 300 requests a minute per IP, so test a server started with a high limit
(`RATE_LIMIT_MAX=100000 npm run start:local`, then `node scripts/perf-smoke.js`). Do not run it against Azure.

## Testing

Four failure modes drive the test strategy. Coverage alone cannot catch tests that assert only status codes, so tests assert **business rules** and mutation testing checks that they do.

| # | Failure mode | How it is prevented | Where |
|---|---|---|---|
| 1 | Cross-module repository imports | dependency-cruiser rules (hard gate) | `.dependency-cruiser.cjs`, `npm run arch` |
| 2 | Raw `Error` throws | ESLint rule and the harness check ARCH-02; typed `AppError` tests | `eslint.config.mjs`, `tests/shared/errors.test.ts` |
| 3 | Status-code-only tests | assertions on state, events, ownership and rule codes; mutation testing | all `tests/**`, `stryker.conf.json` |
| 4 | Missing event-bus integration | tests assert the exact events emitted and the alerts they produce | `tests/activities/*`, `tests/alerts/*`, `tests/reports/*` |

| Layer | Style |
|---|---|
| Unit (service) | real service, in-memory repository, fake ports, recording event bus, fixed clock |
| Unit (shared) | password hashing bounds, JWT pinning (`none`, wrong algorithm/issuer/audience, expiry), config validation |
| API (routes) | the real Express app via `supertest` with seeded users |
| Integration (events) | real bus: an activity change produces the right alert for the right person |
| Process | real server on a random port, graceful and forced shutdown |
| Security behaviours | 401/403/404 matrix, token forgery, mass assignment, oversized or malformed bodies, rate limits, headers |
| Harness | verdict, fail-closed rules, routing, scope, write guard, run log, and the command line end to end against a throwaway git repository (`tests/harness/`, protected during a harness run) |

```bash
npm run verify          # everything fast, in order: what the harness Evaluator and CI both run
npm run typecheck       # tsc --noEmit (strict)
npm run lint            # ESLint + typescript-eslint strict + eslint-plugin-security, 0 warnings allowed
npm run arch            # dependency-cruiser module and layer rules
npm run dup             # jscpd duplication (<= 3%)
npm run test:coverage   # Jest with 90% thresholds (global, per service, per routes, shared)
npm run audit:deps      # npm audit, high and above, production dependencies
npm run test:mutation   # Stryker (about 6 minutes; runs in CI)
```

Coverage thresholds live in `jest.config.js` and fail the run if lines, branches, functions or statements drop below 90% globally, for every `*.service.ts`, every `*.routes.ts` and `src/shared/`
(the programme minimums are 80/70/60/70). The report is `coverage/lcov.info`, which SonarCloud reads.

To see the architecture gate fail, create a forbidden import, run `npm run arch`, then delete the file:

```bash
printf "import { InMemoryTaskRepository } from '../activities/activities.repository';\nexport const x = InMemoryTaskRepository;\n" > src/alerts/zz-violation.ts
npm run arch ; rm src/alerts/zz-violation.ts
```

## Using the harness

Open this folder in Claude Code (it reads `CLAUDE.md` and `.claude/agents/` automatically) and type:

```
@planner <feature description>
```

Review `.harness/output/spec.md` and the sprint contracts, then reply `APPROVED`. For each sprint the Generator builds, the Evaluator checks, and a script decides the
verdict and the next step (advance, retry or escalate after three failed iterations). Evidence of every sprint is archived in `.harness/reviews/`.
The orchestrator is `CLAUDE.md`, the layout of `.harness/` is in `.harness/README.md`, and the scoring rules are in `.harness/config/evaluation.json`
(explained in `.harness/skills/grading-criteria/SKILL.md`). Tool commands: `npm run harness:init | checks | verdict | route | runlog -- N | trends`,
and `npm run harness:demo -- <CHECK-ID>` to see what verdict a failing check would give.

## Azure and pipelines

Infrastructure is created from code by GitHub Actions after a one-time manual bootstrap. Setup, the pull-request gate, running the infra pipeline,
what you need from Azure first, cost and teardown: **`docs/INFRA-SETUP.md`**. Read-only pre-flight check: `bash infra/scripts/preflight.sh`.

## Documentation

| Read | For |
|---|---|
| [docs/INFRA-SETUP.md](docs/INFRA-SETUP.md) | Azure, GitHub and SonarCloud setup; how the pipelines work and how to run them; cost and teardown |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module boundaries, the event bus, and the architecture rules the Evaluator enforces |
| [docs/OWASP-MAPPING.md](docs/OWASP-MAPPING.md) | How the OWASP Top 10 and API Security Top 10 are addressed |
| [docs/openapi.yaml](docs/openapi.yaml) | API contract |
| [JOURNAL.md](JOURNAL.md) | Build log |

## Quality bar

| Gate | Threshold | Command / where |
|---|---|---|
| Type check | 0 errors (strict, `noUncheckedIndexedAccess`) | `npm run typecheck` |
| Lint and security rules | 0 errors, 0 warnings | `npm run lint` |
| Architecture (module boundaries, layers) | 0 violations | `npm run arch` |
| Duplication | <= 3% (currently 0%) | `npm run dup`, SonarCloud |
| Test coverage | >= 90% lines, branches, functions, statements, plus per layer | `npm run test:coverage` |
| Mutation score | >= 75% to pass, 90% target (last measured 93.5%) | `npm run test:mutation` (CI) |
| Dependency vulnerabilities | none high or critical | `npm run audit:deps`, Trivy |
| Static analysis | SonarCloud quality gate, CodeQL | CI |
| Secrets | none | gitleaks (CI) |
| Dynamic scan | ZAP API scan of the deployed dev app | CI |
| Performance | p95 <= 250 ms, 0 errors | `scripts/perf-smoke.js` |

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Invalid environment configuration - JWT_SECRET ...` | `.env` missing or not loaded. Run `npm run init:env`; the npm scripts already pass `--env-file=.env` |
| `compose: variable JWT_SECRET is required` | Same: compose reads `.env` from the repository root |
| `429 Too Many Requests` | The rate limiter is working; wait a minute or raise `RATE_LIMIT_MAX` locally |
| Login returns 401 | Wrong `DEMO_PASSWORD`, or the server was started without `SEED_DEMO_DATA=true` |
| Port 3000 busy | `HOST_PORT=3100` for compose, `PORT=3100` for Node |
| Container is `unhealthy` | `npm run container:logs`; usually invalid configuration |
