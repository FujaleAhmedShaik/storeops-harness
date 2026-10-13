# Deployment

> **Draft status:** section 4 (baseline) is complete. Section 5 (the harness-generated endpoint) still has **TODO (you)** placeholders, because it can only be captured after the harness run and a new deployment. Delete this note and every TODO before submitting.

## 1. Where it is deployed

I deployed StoreOps to **Azure Container Apps** (UK South), in a single `dev` environment. I also run it locally in a container with Podman (`npm run container:up`), which is how I checked the image before it went to Azure.

I picked Azure Container Apps because it runs a container without me managing servers, it scales down when idle (so it costs very little), and it fits the way the brief asks for real decisions on configuration and secrets. The whole environment is created from code (`infra/main.bicep`), so it can be deleted and recreated.

There is no production environment. I originally had one, but my Azure subscription only allows **one** Container Apps environment in total, and dev already uses it. I removed prod from the pipelines rather than leave a job that always fails. The infrastructure code can still create prod when a second environment is possible.

**Live URL (current):** https://ca-storeops-api-dev.jollyglacier-b9eb682b.uksouth.azurecontainerapps.io
The revision I captured is `ca-storeops-api-dev--0000003`, with its own address `https://ca-storeops-api-dev--0000003.jollyglacier-b9eb682b.uksouth.azurecontainerapps.io`. Each deployment makes a new revision, so that second address changes; the first one stays the same until the environment itself is deleted and recreated (for example after a teardown), when the random part changes.

**Baseline deployed commit:** `d392e2c9ecfc0d4326c9db90da456dbb778b10db` on `main` (merge of pull request #11). The image in the registry carries this same SHA as its tag.

**Final deployed commit (after the harness run):** <!-- TODO (you): the SHA that is running when you submit, and the live URL if it changed -->

## 2. What gets created in Azure

Everything lives in one resource group, `rg-storeops-dev` (eight resources, see the screenshot in section 4):

| Resource | What it is for |
|---|---|
| Container Registry | Holds the image. The admin user is switched off; only identities with a role can use it |
| Container Apps environment and the app | Runs the API (0 to 3 replicas, so it scales to zero when idle) |
| Key Vault | Holds the JWT secret and the demo password (role-based access, no access policies) |
| Managed identity | Lets the app pull its image and read its secrets without any stored password |
| Log Analytics and Application Insights | Logs and telemetry |

The app gets its secrets from Key Vault through that managed identity. The secrets are random values created by a script the first time and never printed or put in the repository.

## 3. How I deployed it

I did the one-off setup by hand, then let the pipeline do the rest.

1. **Check my machine and subscription:** `bash infra/scripts/preflight.sh`.
2. **One-time bootstrap:** `bash infra/scripts/bootstrap.sh FujaleAhmedShaik/storeops-harness`. This creates the resource groups, an app registration for GitHub Actions, and the federated credentials. There is no Azure password or client secret stored anywhere: GitHub proves who it is with a short-lived token (OIDC).
3. **GitHub setup:** I added the identifiers that bootstrap printed as repository variables (not secrets) and created a `dev` environment.
4. **Merge to `main`:** the CI/CD workflow does the rest. After the checks pass it builds the image, tags it with the commit SHA, pushes it to the registry, deploys the app, runs a smoke test against the live URL and then an OWASP ZAP scan. The Infrastructure workflow applies the Bicep when `infra/` changes.

What the checks cover before anything is deployed:

- types, lint, architecture rules, duplication, tests with at least 90% coverage, and a dependency audit
- mutation testing, to check the tests really assert behaviour
- SonarCloud, CodeQL, and a secret scan with gitleaks
- the container: Dockerfile lint, a vulnerability scan (HIGH and CRITICAL fail the build), an SBOM, and a run of the image itself
- the infrastructure: the Bicep compiles, and Checkov scans it

To bring the environment back or remove it I use two manual workflows: **CI/CD, "Run workflow"** deploys dev, and **Teardown dev** deletes the resources (it keeps the resource group). After a teardown the dev Key Vault has to be purged before the next deploy, because its name is reserved while it is soft-deleted.

## 4. Evidence: the baseline deployment (before the harness run)

This is the scaffold, deployed through the pipeline on 13 October 2026. It proves the delivery path works before the harness changes anything. Every screenshot is in `docs/evidence/`.

**Pipeline, commit `d392e2c`**

- CI/CD run #21 succeeded in 9m 32s. All eight jobs were green: quality gate, secret scan, infrastructure as code, mutation testing, SonarCloud, container build and scan, publish to the registry, and deploy to dev with smoke test and ZAP scan. The secret scan reported "No leaks detected".
- Infrastructure run #15 succeeded: validate and scan, then apply to dev. The what-if preview is skipped on a push to `main`; it runs on pull requests (it passed on PR #11).
- CodeQL run #21 succeeded.

**The running app**

- The smoke test hit the live URL and "All checks passed": liveness and readiness, a request without a token refused with 401, logins for three demo users, then creating, listing, reading, starting, completing and deleting an activity. It also checked that another store cannot see the activity (404), that reopening a finished activity is refused (409), and that an associate cannot raise priority or delete someone else's activity (403).
- The OWASP ZAP scan of the deployed API, driven by `docs/openapi.yaml`, finished with 119 passed, 0 failed, 0 warnings.
- In the Azure portal, revision `ca-storeops-api-dev--0000003` is Active and Running with 100% of traffic and 1 of 1 replicas (minimum 0, maximum 3).
- The registry holds the image `storeops-api` with three tags, each one a commit SHA. The newest is `d392e2c9ecfc…`, so the running image is traceable to the commit.

**Quality results at this commit**

| Measure | Result |
|---|---|
| SonarCloud quality gate | Passed. 0 open issues, 0 security hotspots, ratings A for security, reliability and maintainability |
| Coverage / duplication (Sonar) | 99.2% / 0.0% |
| Mutation score | 90.05% (the build fails below 75%) |
| CodeQL | No alerts |

| What it shows | File |
|---|---|
| CI/CD run #21: all jobs green | `docs/evidence/ci-cd-workflow.png` |
| Deploy job: smoke test passing and the ZAP scan result | `docs/evidence/deployemnt-workflow-with-smoke-test-and-zap-api-scan.png` |
| Infrastructure run #15 | `docs/evidence/infrastructure-workflow.png` |
| CodeQL run | `docs/evidence/codeql-workflow.png` |
| Pull request #11: 14 checks, SonarCloud gate passed | `docs/evidence/pull-request-checks.png` |
| SonarCloud project overview | `docs/evidence/sonar-project-overview.png` |
| Mutation testing report | `docs/evidence/mutation-testing-report.png` |
| The eight resources the pipeline created | `docs/evidence/resource-deployed-by-pipeline.png` |
| Container app revisions, running | `docs/evidence/azure-app-active-revision.png` |
| Revision details (replicas, scale range, revision URL) | `docs/evidence/conatiner-app-details.png` |
| Registry with the commit-SHA image tags | `docs/evidence/container-registry-snapshot-with-images.png` |
| The repository | `docs/evidence/git-repo-structure.png` |

## 5. Evidence: the harness-generated endpoint running

The endpoint the harness added is: <!-- TODO (you): method and path, e.g. GET /api/..., and one line on what it does -->

Request and response from the live deployment (token and password left out):

```bash
# TODO (you): replace with the real commands you ran
curl -s -X POST "$BASE_URL/api/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"manager.s1@storeops.example","password":"<demo password from Key Vault>"}'

curl -s -i "$BASE_URL/<new endpoint>" -H "Authorization: Bearer <token>"
```

<!-- TODO (you): paste the real response here, with the status line and the JSON body visible -->

| What it shows | File |
|---|---|
| The new endpoint answering with the expected response | <!-- TODO: docs/evidence/new-endpoint.png --> |
| The same endpoint refused without a token (401) | <!-- TODO: docs/evidence/new-endpoint-401.png --> |
| The successful CI/CD run for the final commit | <!-- TODO: docs/evidence/final-pipeline-run.png --> |
| The running revision for the final commit | <!-- TODO: docs/evidence/final-revision.png --> |

Date I captured this: <!-- TODO (you) -->

## 6. Problems I hit and what fixed them

My first push to GitHub turned up a number of real problems. I did not have the pipeline logs for some of them, so I reproduced each failing step on my own machine. The code and fixes were produced with Claude Code (see `JOURNAL.md`).

| Problem | Cause | Fix |
|---|---|---|
| The container job never started | An action was pinned to a version tag that does not exist | Pinned every action to a commit SHA |
| The secret scan failed | Two public Azure role ids looked like API keys. The scan action also used an older gitleaks than the one I tested with | An allowlist in `.gitleaks.toml`, and the gitleaks version pinned in the workflow |
| The Bicep would not compile | The file contained 400 invisible non-breaking spaces from a copy and paste | Replaced them with normal spaces |
| Azure login failed (AADSTS700213) | GitHub's token carried the numeric owner and repo ids, which my federated credentials did not | Added credentials in that form, and changed `bootstrap.sh` to create both |
| Deployment failed with RoleDefinitionDoesNotExist | Two Key Vault role ids in the Bicep were wrong | Looked up the real ids in my subscription and corrected them |
| The first app revision would not start (SEED_DEMO_DATA: expected "true" or "false") | The Bicep converted the setting with `string()`, which gives "True" with a capital T, and the app only accepts lowercase | Wrote the value explicitly as `'true'` or `'false'` in `infra/main.bicep` |
| The deployed smoke test got 401 on every login | The deployed secret and the password the test read did not match. I believe the stored password ended with a newline (the script created it from a file written by `openssl`), which I fixed by creating secrets without one and repairing existing ones. The logins worked straight after that fix, but I did not measure the stored value before it | `infra/scripts/ensure-secrets.sh` |
| I could not read the Key Vault secret in the portal or the CLI | Subscription Owner does not include permission to read secrets in a vault that uses role-based access | Grant my own user the read-only "Key Vault Secrets User" role on that one vault (the pipeline and the app already had their own roles) |
| The prod preview failed | The subscription allows only one Container Apps environment | Removed prod from the pipelines (section 1) |
| SonarCloud reported 34 issues | Unpinned actions, tests with no recognised assertion, async work in a constructor, an unchecked URL in a script | Fixed in the code and workflows |

## 7. Known limits

- It runs in memory, so data is lost when the app restarts or scales to zero. That is by design for this exercise.
- Only dev exists, with demo users and demo data. It is a reference build, not a production system.
- The public network access on the registry and Key Vault is on, because the pipeline runs on GitHub-hosted runners. Access is still limited to Entra ID and role-based permissions over TLS. I recorded this as an accepted risk in `sonar-project.properties` and `.checkov.yaml`.
- Mutation testing scores `staff.service.ts` at only 33%. The surviving mutants are in the code that hashes a decoy password so that logins for unknown emails take the same time as logins for known ones. The tests do not assert that timing behaviour. The overall score is 90.05%, above the threshold, but this is a weak spot I would improve.
- The ZAP scan runs in passive mode and only checks the paths in `docs/openapi.yaml`. It is not a full penetration test.
