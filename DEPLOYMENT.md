# Deployment

## 1. Where it is deployed

I deployed StoreOps to **Azure Container Apps** (UK South), in a single `dev` environment. I also run it locally in a container with Podman (`npm run container:up`), which is how I checked the image before it went to Azure.

I picked Azure Container Apps because it runs a container without me managing servers, it scales down when idle (so it costs very little), and it fits the way the brief asks for real decisions on configuration and secrets. The whole environment is created from code (`infra/main.bicep`), so it can be deleted and recreated.

There is no production environment. I originally had one, but my Azure subscription only allows **one** Container Apps environment in total, and dev already uses it. I removed prod from the pipelines rather than leave a job that always fails. The infrastructure code can still create prod when a second environment is possible.

**Live URL:** https://ca-storeops-api-dev.jollyglacier-b9eb682b.uksouth.azurecontainerapps.io
This address stays the same from one deployment to the next. It only changes if the environment itself is deleted and recreated (for example after a teardown). Each deployment also makes a new revision with its own address, and the revision running now is `ca-storeops-api-dev--0000005`.

**Final deployed commit:** `c94646bcdd6427384570cb003b9d8178a9e3ef4b` on `main`, the merge of [pull request #13](https://github.com/FujaleAhmedShaik/storeops-harness/pull/13) (the harness-built shift handover feature). The pipeline run for it, [CI/CD #25](https://github.com/FujaleAhmedShaik/storeops-harness/actions/runs/38442167591), succeeded in about 8 minutes 40 seconds, and CodeQL #25 succeeded too. The image in the registry carries the commit SHA as its tag.

**Baseline commit (before the harness run):** `d392e2c9ecfc0d4326c9db90da456dbb778b10db`, the merge of pull request #11. Its evidence is in section 4.

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

This is the scaffold, deployed through the pipeline on 13 October 2026. It proves the delivery path works before the harness changes anything.

**Pipeline, commit `d392e2c`.** CI/CD run #21 succeeded in 9 minutes 32 seconds with all eight jobs green, and the secret scan reported "No leaks detected". The Infrastructure run (#15) and CodeQL (#21) succeeded too.

<img src="docs/evidence/ci-cd-workflow.png" alt="CI/CD run 21, all jobs green" width="820">

<img src="docs/evidence/infrastructure-workflow.png" alt="Infrastructure run 15: validate and apply to dev" width="820">

<img src="docs/evidence/codeql-workflow.png" alt="CodeQL run succeeded" width="820">

**The smoke test and the security scan, against the live URL.** The smoke test ended "All checks passed". It covers liveness and readiness, a request without a token refused with 401, logins for three demo users, then creating, listing, reading, starting, completing and deleting an activity. It also checks that another store cannot see the activity (404), that reopening a finished activity is refused (409), and that an associate cannot raise priority or delete someone else's activity (403). The OWASP ZAP scan of the deployed API, driven by `docs/openapi.yaml`, finished with 119 passed, 0 failed and 0 warnings.

<img src="docs/evidence/deployemnt-workflow-with-smoke-test-and-zap-api-scan.png" alt="Deploy job with the smoke test and the ZAP scan" width="820">

**Quality results at this commit.**

| Measure | Result |
|---|---|
| SonarCloud quality gate | Passed. 0 open issues, 0 security hotspots, ratings A for security, reliability and maintainability |
| Coverage / duplication (Sonar) | 99.2% / 0.0% |
| Mutation score | 90.05% (the build fails below 75%) |
| CodeQL | No alerts |

<img src="docs/evidence/pull-request-checks.png" alt="Pull request 11 with 14 checks and the SonarCloud quality gate passed" width="820">

<img src="docs/evidence/sonar-project-overview.png" alt="SonarCloud project overview" width="520">

<img src="docs/evidence/mutation-testing-report.png" alt="Mutation testing report, score 90.05" width="820">

**What exists in Azure.** The pipeline created the eight resources, revision `ca-storeops-api-dev--0000003` was Active and Running with 100% of traffic, and the registry held the image with one tag per commit SHA.

<img src="docs/evidence/resource-deployed-by-pipeline.png" alt="The eight resources in rg-storeops-dev" width="820">

<img src="docs/evidence/azure-app-active-revision.png" alt="Container app revisions, running" width="820">

<img src="docs/evidence/conatiner-app-details.png" alt="Revision details: 1 of 1 replicas, scale range 0 to 3" width="820">

<img src="docs/evidence/container-registry-snapshot-with-images.png" alt="Registry with the commit SHA image tags" width="820">

<img src="docs/evidence/git-repo-structure.png" alt="The repository on GitHub" width="620">

## 5. Evidence: the harness-generated endpoint running

The endpoint the harness built is **`PATCH /api/activities/bulk-status`** (shift handover). Outgoing staff send up to 50 `{ id, status }` items, where `status` is `DONE` or `BLOCKED`. Each item is judged on its own against the creator-or-assignee-or-supervisor rule, store scoping and the existing status transitions. A bad item is reported with a reason code and never stops the others, and every updated activity writes a `SHIFT_HANDOVER` alert through the event bus.

I tested it on the live URL with Postman after the final merge was deployed. The requests ran between about 18:11 and 18:22 UTC on 13 October 2026 (the Azure portal screenshots show UK summer time, one hour ahead). I used one account, `manager.s1@storeops.example`, as the creator and the assignee. The Postman requests also contain the demo password; in the one screenshot where it was visible I covered the password value.

**1. Log in.** `POST /api/auth/login` returns 200 and a token (blacked out in the screenshot).

<img src="docs/evidence/login-after-new-deployment.png" alt="Login returns 200 with an access token (token and password hidden)" width="620">

**2. Create a programme and two activities.** `POST /api/programmes` and two `POST /api/activities`, each returning 201 with status `TODO`. I called the activities A (`e188c2de-...`) and B (`e909ac93-...`).

<img src="docs/evidence/creating-program-after-new-end-point-deployment.png" alt="Programme created, 201" width="620">

<img src="docs/evidence/activities-creation-after-new-end-point-A.png" alt="Activity A created, 201, status TODO" width="620">

<img src="docs/evidence/activities-creation-after-new-end-point-B.png" alt="Activity B created, 201, status TODO" width="620">

**3. Start activity A.** `PATCH /api/activities/{id}` with `IN_PROGRESS` returns 200. A `TODO` activity cannot go straight to `DONE`, so this step matters.

<img src="docs/evidence/activitiy-A-updated-to-in-progress-after-new-end-point.png" alt="Activity A moved to IN_PROGRESS, 200" width="620">

**4. The new endpoint, with a partial failure.** I sent A and B as `DONE`. The response is `200 OK` with `updated: 1` and `failed: 1`. A is `UPDATED` from `IN_PROGRESS` to `DONE`. B is `FAILED` with `INVALID_STATUS_TRANSITION`, because it is still `TODO`. One bad item did not stop the other.

<img src="docs/evidence/bulk-update-with-invalid-status-transition.png" alt="Bulk update: A updated, B rejected with INVALID_STATUS_TRANSITION" width="620">

**5. Reason codes for every failure.** I sent A, B and an id that does not exist. A is now `DONE`, and `DONE` is final, so A is also refused with `INVALID_STATUS_TRANSITION`. B is refused for the same reason as before, and the unknown id is `NOT_FOUND`. The result is `updated: 0`, `failed: 3`, and the request still returns 200.

<img src="docs/evidence/not-found-status-update.png" alt="Bulk update: all three items refused, one NOT_FOUND" width="620">

**6. No token.** The same request without a token returns `401 Unauthorized`.

<img src="docs/evidence/no-token-error.png" alt="Same request without a token, 401" width="620">

**7. The 50-item limit.** I sent a list of more than 50 items. The whole request is refused with `400`, `VALIDATION_ERROR` and "Too big: expected array to have <=50 items", and no activity is touched.

<img src="docs/evidence/to-many-updates-more-than-50.png" alt="More than 50 items refused with 400" width="620">

**8. The audit entry.** `GET /api/alerts` shows a `SHIFT_HANDOVER` alert for activity A: "Restock dairy was moved from IN_PROGRESS to DONE." It was recorded by the alerts module through the event bus. There is none for B, which was refused.

<img src="docs/evidence/shift-handover-alert-after-new-deployment.png" alt="SHIFT_HANDOVER alert created for activity A" width="620">

**9. The deployed version.** The deployment that carries the feature is revision `ca-storeops-api-dev--0000005`, created at 18:59 UK time, Running, with 100% of traffic. The registry now has an image tagged `c94646bcdd6427384570cb003b9d8178a9e3ef4b`, the same SHA as the merge commit, so the running code can be traced to the commit the harness produced.

<img src="docs/evidence/new-endpoint-deployment-revision-active.png" alt="Revision 0000005 running with 100% traffic" width="820">

<img src="docs/evidence/the-new-endpoint-build-in-container-repository.png" alt="Registry with the image tagged with the final commit SHA" width="820">

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
| A Postman screenshot showed the demo password | The password was visible in the login request body | Covered the value in the evidence image before committing it, and kept the original out of the repository |

## 7. Known limits

- It runs in memory, so data is lost when the app restarts or scales to zero. That is by design for this exercise. The ids in my screenshots will not exist after the next restart.
- Only dev exists, with demo users and demo data. It is a reference build, not a production system.
- The public network access on the registry and Key Vault is on, because the pipeline runs on GitHub-hosted runners. Access is still limited to Entra ID and role-based permissions over TLS. I recorded this as an accepted risk in `sonar-project.properties` and `.checkov.yaml`.
- Mutation testing scores `staff.service.ts` at only 33%. The surviving mutants are in the code that hashes a decoy password so that logins for unknown emails take the same time as logins for known ones. The tests do not assert that timing behaviour. The overall score is 90.05%, above the threshold, but this is a weak spot I would improve.
- The ZAP scan runs in passive mode and only checks the paths in `docs/openapi.yaml`. It is not a full penetration test.
- The deployed smoke test script (`scripts/smoke.js`) was written before the new endpoint and does not call it. I tested `bulk-status` by hand in Postman, as shown in section 5.
