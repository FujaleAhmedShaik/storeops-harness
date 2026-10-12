# Azure, GitHub and pipeline setup

Everything is provisioned from code in `infra/` by pipelines. You do one **bootstrap** by hand, because a pipeline cannot
create the identity it logs in with. After that, `git push` is the only deployment action.

**Part A** is the one-time setup (accounts, bootstrap, environments, SonarCloud, first provisioning, teardown). **Part B** explains what the pipelines do, how to set up the
pull-request gate, how to run the infrastructure pipeline, and exactly what you need from Azure before you do.

## Part A: One-time setup

```
Developer ──push──▶ GitHub Actions ──OIDC (no secrets)──▶ Azure
                      │ ci-cd.yml   quality ▸ sonar ▸ scans ▸ build ▸ push to ACR ▸ deploy dev ▸ ZAP ▸ (approval) ▸ prod
                      └ infra.yml   what-if on PR ▸ apply dev ▸ (approval) ▸ apply prod
Azure (per env, resource group rg-storeops-<env>):
  Container Apps (app) ◀─pull─ ACR ◀─push─ pipeline
        │ managed identity ▶ Key Vault (jwt-secret, demo-password)
        └ logs ▶ Log Analytics + Application Insights
```

#### Recommendations behind this design

| Decision | Choice | Why |
|---|---|---|
| IaC | Bicep | Azure-native, no state file or backend to bootstrap, built-in `what-if` for PR previews |
| Hosting | Azure Container Apps | Accepted by the programme, scales to zero (low cost), simple ingress/TLS, managed identity |
| Where infra lives | `infra/` in the same repo, own pipeline | Reviewers grade one repo; image and infra change together. Split into a separate repo only if a platform team owns it or several services share it |
| Auth to Azure | OIDC federated credentials | No long-lived secret in GitHub |
| App secrets | Key Vault, read by the app's managed identity | Not in pipeline variables or images |
| Environments | `dev` (auto) and `prod` (manual approval) | Mirrors a real promotion path; prod is optional for the capstone |

### Step 0: tools and accounts

- Azure subscription where you may create resource groups and app registrations (check that `az account show` is the one you intend to spend on).
- GitHub repository for this code (GitHub CLI `gh` optional but handy). **Do not commit the programme PDF** (it is copyrighted).
- Azure CLI 2.56 works; consider `az upgrade`. Bicep is installed by `az bicep install`.

### Step 1: create the GitHub repository (empty), and push LATER

Create an **empty** repository on GitHub (no README, no .gitignore). Do **not** push yet: do steps 2 to 4 first so the first pipeline run is green
(see "Recommended order for the first run" in Part B). When you are ready:

```bash
git remote add origin https://github.com/<owner>/storeops-harness.git
git push -u origin main
```

Private vs public: SonarCloud's free tier and CodeQL need a **public** repo (or paid plans for private). StoreOps is
generated, non-proprietary code, so public is fine; just never commit secrets, tokens or the PDF.

### Step 2: bootstrap Azure (one time, about 3 minutes)

```bash
az login
bash infra/scripts/bootstrap.sh <owner>/storeops-harness uksouth      # Git Bash, WSL or Cloud Shell
```

It registers resource providers, creates `rg-storeops-dev` and `rg-storeops-prod`, an Entra app
`sp-storeops-github-deploy` with federated credentials (this repo's `dev`/`prod` environments, `main`, pull requests),
and grants **Contributor + User Access Administrator on those two resource groups only**. It then prints (and optionally sets) these
GitHub repository **variables** (identifiers, not secrets): `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`AZURE_SUBSCRIPTION_ID`, `DEPLOYER_OBJECT_ID`, `AZURE_LOCATION`.

If you cannot create app registrations in your tenant, create the app and federated credentials in the portal
(Entra ID, App registrations, Certificates & secrets, Federated credentials) using the same subjects, or ask your tenant admin.

### Step 3: GitHub environments

Settings, Environments: create `dev` (no reviewers) and `prod` (add yourself as a **required reviewer**).
The prod job pauses until you approve it.

### Step 4: SonarCloud (pipeline only; nothing runs locally)

1. Sign in at sonarcloud.io with GitHub, import the repository, choose "with GitHub Actions".
2. Add repository **secret** `SONAR_TOKEN` and repository **variables** `SONAR_ORGANIZATION`, `SONAR_PROJECT_KEY`.
3. In SonarCloud, turn off Automatic Analysis (the workflow analyses with coverage).
4. Create a quality gate **"StoreOps"** and set it as default for the project:

| Metric | Condition |
|---|---|
| Coverage (overall) | is less than 90% -> fail |
| Coverage on new code | is less than 90% -> fail |
| Duplicated lines on new code | is greater than 3% -> fail |
| Security rating, Reliability rating, Maintainability rating | worse than A -> fail |
| Security hotspots reviewed | is less than 100% -> fail |

`sonar-project.properties` already sets sources, test paths, the lcov report and exclusions. The job uses
`sonar.qualitygate.wait=true`, so a failed gate fails the pipeline.

### Step 5: first provisioning

Push to `main` (or run the **Infrastructure** workflow manually). `infra.yml` runs `bash infra/scripts/deploy.sh`:

1. **Platform**: Log Analytics, App Insights, Container Registry, Key Vault, managed identity, Container Apps environment, role assignments.
2. **Secrets**: generates `jwt-secret` (and `demo-password` in dev) in Key Vault, once, never printed.
3. **App**: only when an image exists. The first `ci-cd.yml` run builds the image, pushes it to ACR (tag = commit SHA), then deploys.

On a pull request that touches `infra/**`, the workflow posts a **what-if** preview instead of changing anything.

### Step 6: verify the deployment

```bash
# after the dev deploy job: the URL is in the job log ("Application URL: ...")
export BASE_URL=https://<fqdn-from-log>
export DEMO_PASSWORD=$(az keyvault secret show --vault-name <kv-name> --name demo-password --query value -o tsv)
node scripts/smoke.js
```

Capture your deployment evidence now (screenshots go in `docs/evidence/`).

### Cost and teardown

Roughly a few pounds or dollars a month if left running: ACR Basic is the main fixed cost; Container Apps in the
consumption plan scales to zero in dev (prod keeps one replica); Log Analytics and Key Vault are pennies at this volume.
Check the Azure pricing calculator for current numbers. **Delete when you have your evidence**:

```bash
bash infra/scripts/teardown.sh dev
bash infra/scripts/teardown.sh prod
```

The Key Vault is soft-deleted; prod also has purge protection, so its name stays reserved for the retention period.

### Local validation you can do without Azure

```bash
az bicep build --file infra/main.bicep --stdout > /dev/null          # compiles with no warnings
bash -n infra/scripts/*.sh                                           # shell syntax
az deployment group what-if -g rg-storeops-dev -f infra/main.bicep \
  -p environmentName=dev location=uksouth deployerPrincipalId=<object-id> deployApp=false   # after bootstrap
```

### Known limits

- The workflows have **not run yet**: expect to fix small things on the first execution (action versions, ZAP options, Checkov policies).
- Dev has demo users and a public URL, protected by a random secret and rate limits only. It exists to demonstrate and scan the app.
- Prod has **no users** (no identity provider is wired in and storage is in memory). It demonstrates the promotion pipeline, not a usable service. A real system would use Entra ID and a database.
- One replica's in-memory rate limiter and data are not shared across replicas; scale-out would need Redis and a database.
- Action versions are pinned to major tags; for stricter supply-chain hygiene pin to commit SHAs (Dependabot keeps them current).
- ACR Basic does not support private endpoints or content trust; Checkov findings for those are accepted for this capstone.

---

## Part B: Pipelines and how to run them

### 1. What runs, and when

Three workflow files in `.github/workflows/`:

| Workflow | Runs on | Jobs |
|---|---|---|
| **CI/CD** (`ci-cd.yml`) | every pull request, every push to `main`, manual | `quality`, `mutation`, `sonar`, `secrets-scan`, `container`, `iac`; **on `main` only:** `publish`, `deploy-dev`, `deploy-prod` |
| **Infrastructure** (`infra.yml`) | pull requests and pushes that change `infra/**`, and manual | `validate`; on PRs `what-if (dev)` and `what-if (prod)`; on `main`/manual `apply-dev`, then `apply-prod` |
| **CodeQL** (`codeql.yml`) | pull requests, pushes to `main`, weekly | `analyze` (security static analysis) |

| Event | What you get |
|---|---|
| **Open a pull request** | All checks run; **nothing is deployed and nothing in Azure changes.** A change to `infra/**` also gets a read-only **what-if** preview |
| **Merge to `main`** | The same checks, then the image is built and pushed (`publish`), deployed to **dev** (`deploy-dev`: smoke test and ZAP scan), then **prod waits for your approval** (`deploy-prod`) |
| **Manual run** | Actions tab, pick the workflow, **Run workflow**, branch `main` |

Fork PRs: GitHub withholds secrets, so `sonar` and the what-if jobs are skipped (by design). Your own branches are fine.

### 2. Pull-request gate: setup, step by step

Do this once, after the first successful run (so GitHub knows the check names).

1. **Repo, Settings, Actions, General:** allow GitHub Actions ("Allow all actions and reusable workflows"). Workflow permissions can stay at the read-only default, because each workflow declares what it needs.
2. **Repo, Settings, Branches, Add branch protection rule** for `main` (called "Add classic branch protection rule" or a Ruleset, depending on your GitHub UI):
   - tick **Require a pull request before merging**
   - tick **Require status checks to pass before merging** and **Require branches to be up to date**
   - add these required checks (type the names exactly; they only appear in the search box after they have run once):

     | Required check | Why |
     |---|---|
     | `Quality gate (types, lint, architecture, duplication, tests >= 90%, audit)` | the core gates |
     | `SonarCloud quality gate` | Sonar |
     | `Secret scan (gitleaks)` | no secrets |
     | `Container build, lint, vulnerability scan, SBOM, runtime tests` | image is safe and starts |
     | `Infrastructure as code (Bicep build + Checkov)` | IaC is valid and scanned |
     | `analyze` (CodeQL) | static security analysis |

   - **Do not** mark the `Infrastructure` workflow's jobs or `Mutation testing` as required. The infra workflow only runs when `infra/**` changes, so a required check that never starts would block every other PR. Mutation takes about 6 minutes; keep it advisory, or require it once you trust it.
   - optional: tick **Do not allow bypassing the above settings**.
3. **Test it** (this is also a useful demo): create a branch, make a harmless change (for example add a line to `README.md`), push, open a PR.

   ```bash
   git switch -c docs/test-pr-gate
   echo "" >> README.md
   git add README.md
   git commit -m "Test the pull request checks"
   git push -u origin docs/test-pr-gate
   ```

   **You should see:** on the PR page a list of checks running, then green ticks; the **Merge** button stays disabled until the required ones pass.
   Click **Details** next to any check to read its log. Close the PR and delete the branch afterwards.

### 3. The infrastructure pipeline

#### Is it manual? One small manual step, then everything is automatic

| # | Step | Manual or automatic | What it creates |
|---|---|---|---|
| A | Sign in to the **right Azure directory** and pick the subscription (see the note at the start of section 4); run `bash infra/scripts/preflight.sh` | **Manual, once** (5 min) | nothing (read-only check) |
| B | Create the **empty GitHub repository**, the `dev` and `prod` environments, and the repository variables | **Manual, once** (5 min) | settings in GitHub only |
| C | `bash infra/scripts/bootstrap.sh <owner>/<repo> uksouth` | **Manual, once** (3 min, but a script does the typing) | the two **resource groups** (`rg-storeops-dev`, `rg-storeops-prod`); the **deploy identity** (an Entra app registration and service principal, with no password); the **federated credentials** that let this repo's GitHub Actions log in as it; **Contributor** and **User Access Administrator** rights for that identity on those two resource groups only; the Azure resource providers registered |
| D | The **Infrastructure** workflow (`infra.yml`), or the `publish` job of the CI/CD workflow | **Automatic**, on every push to `main` and on demand | everything *inside* the resource groups, from `infra/main.bicep` (below) |
| E | The CI/CD workflow after a merge | **Automatic** | builds and scans the image, pushes it to the registry, deploys the container app, smoke-tests it |

**Does running it from GitHub Actions create what is needed? Yes, for everything inside the resource groups.** Steps D and E create, with no clicking in the Azure portal:

| Resource | Purpose |
|---|---|
| Log Analytics workspace and Application Insights | logs and monitoring |
| Azure Container Registry | stores your container images |
| Key Vault | holds `jwt-secret` (and `demo-password` in dev), generated randomly and never printed |
| Managed identity and its role assignments | the app pulls images (AcrPull) and reads secrets (Key Vault Secrets User) without any password |
| The deploy identity's two extra roles | AcrPush and Key Vault Secrets Officer on that environment only |
| Container Apps environment and the **Container App** | the running service with a public HTTPS address (the app is created once an image exists) |

**What it does *not* create (steps A to C): the resource groups, the deploy identity, and the GitHub settings.** Why: a pipeline can only log in as an identity that
**already exists**, so the first identity must be created by a person (a chicken-and-egg problem). It is also deliberate: handing the pipeline subscription-wide
power would be riskier, so it only gets rights inside its own two resource groups. (It *is* possible to automate step C too, but only by giving the pipeline
Owner rights on the whole subscription, which is a worse security trade-off for no real gain, since you do it once.)

#### Recommended order for the first run (avoids a red first run)

1. Sign in to the right directory and pass the pre-flight (step A).
2. Create the **empty** GitHub repository (do **not** push yet).
3. Run `bootstrap.sh` (step C). It can run before the repository has any code; it only needs the `<owner>/<repo>` name.
4. Add the repository variables, create the `dev` and `prod` environments, and set up SonarCloud (step B).
5. **Now** `git push -u origin main`. Both workflows start. The first push touches `infra/**`, so the Infrastructure workflow and the CI/CD workflow both want to deploy to **dev**; they are
   queued by a shared lock (`concurrency: azure-dev`) so only one Azure deployment runs at a time. Do not cancel one thinking it is stuck: the second simply waits.
6. When the CI/CD run reaches `deploy-prod`, approve it in GitHub (**Review deployments**) if you want prod.

If you push **before** steps 3 and 4, the Azure login steps fail with a clear message; fix the setup and use **Re-run failed jobs**.

#### What the infrastructure script does

`infra.yml` calls `bash infra/scripts/deploy.sh <env>`, which is safe to run repeatedly:
1. deploys the **platform** (monitoring, container registry, key vault, identity, container apps environment, role assignments);
2. creates the app secrets in Key Vault **only if missing** (never printed, never rotated);
3. updates the **Container App** only when an image already exists (otherwise it stops after the platform and tells you).

#### Before you can run it: one-time prerequisites

Complete the one-time setup in Part A (steps 2 to 4) first. In short, the pipeline cannot run until these exist:
- the Azure **resource groups** and **deploy identity** (created by `bootstrap.sh`);
- five GitHub **repository variables** (section 4 below);
- GitHub **environments** `dev` and `prod`.

If any is missing, the Azure login step fails immediately with a clear message: that is expected, not a bug.

#### Running it

| How | Steps | You should see |
|---|---|---|
| **Automatically** | change something under `infra/`, open a PR, merge | PR: `validate` plus `What-if (dev)` and `What-if (prod)` showing "Create/Modify" lists. After merge: `apply-dev`; `apply-prod` waits for approval |
| **Manually** | GitHub, **Actions**, **Infrastructure**, **Run workflow**, branch `main`, Run | `validate`, then `apply-dev`, then `apply-prod` (click **Review deployments**, tick `prod`, **Approve and deploy**) |
| **Command line (optional)** | `gh workflow run infra.yml --ref main` | same as manual |

First provisioning takes several minutes (Azure creates about ten resources). The **first** `ci-cd.yml` run on `main` also calls
`deploy.sh dev` in its `publish` job, so you do not have to run `infra.yml` first: whichever runs first creates the platform.

After a successful `apply-dev`, check in the Azure portal: resource group `rg-storeops-dev` contains a container registry, key vault,
log workspace, application insights, managed identity and a container apps environment (and the container app once an image has been deployed).

#### Reading a what-if

Green `+` is a resource it would create, `~` a change, `-` a deletion. On the very first PR everything is `+`. A `-` you did not expect
is a reason to stop and read the diff. The what-if never changes anything.

### 4. Information you need from Azure and GitHub **before** running

**Sign in to the directory that owns your subscription.** A plain `az login` signs you in to your *default* tenant, which may not be the one that holds your subscription,
and the CLI can also hold stale entries for tenants that no longer exist (that gives `AADSTS90002: Tenant not found`). Be explicit:

```bash
az login --tenant <your-directory>.onmicrosoft.com          # or the tenant id (a GUID); the directory name is shown in the Azure portal under Microsoft Entra ID
az account list --all -o table                                # your subscription must appear here, with State = Enabled
az account set --subscription "<subscription id or name>"
az account show --query "{name:name,id:id,tenant:tenantId}" -o table
```

If the subscription you expect is not listed after signing in to the right tenant, your user has no role on it yet: ask the subscription owner to add you as **Owner**.

Collect these first. Where it says "command", run it in a terminal after `az login`.

| # | You need | Why | How to get it |
|---|---|---|---|
| 1 | **Subscription** you are allowed to spend on | everything is created there | `az account list -o table`, then `az account set --subscription "<name or id>"` and `az account show --query "{name:name,id:id}" -o table` |
| 2 | **Subscription ID** | `AZURE_SUBSCRIPTION_ID` | `az account show --query id -o tsv` |
| 3 | **Tenant ID** | `AZURE_TENANT_ID` | `az account show --query tenantId -o tsv` |
| 4 | **Your role on the subscription** must be **Owner**, or **Contributor plus User Access Administrator** | to create resource groups and role assignments | `az role assignment list --assignee "$(az ad signed-in-user show --query id -o tsv)" --all --query "[].roleDefinitionName" -o tsv` |
| 5 | **Permission to create an app registration** in Entra ID | `bootstrap.sh` creates the deploy identity | Try `az ad app list --display-name test --query "[0]"`; if creating fails with `Insufficient privileges`, ask your tenant admin or use the portal route in Part A, step 2 |
| 6 | **Region** (default `uksouth`) | `AZURE_LOCATION`; Container Apps must be available there | `az provider show --namespace Microsoft.App --query "resourceTypes[?resourceType=='managedEnvironments'].locations[]" -o tsv` should list it (not yet tried against a live subscription; if it errors, check the region in the Azure portal under Container Apps, Create) |
| 7 | **Resource providers registered** | Azure refuses to create unknown resource types | `bootstrap.sh` registers them; check with `az provider show -n Microsoft.App --query registrationState -o tsv` (expect `Registered`) |
| 8 | **GitHub owner/repo** (`<user>/storeops-harness`) | federated credentials are tied to it exactly | the URL of your repo |
| 9 | **Deploy identity's object ID** | `DEPLOYER_OBJECT_ID` (used for registry push and secret write) | printed by `bootstrap.sh`; or `az ad sp list --display-name sp-storeops-github-deploy --query "[0].id" -o tsv` |
| 10 | **Client ID of the deploy identity** | `AZURE_CLIENT_ID` | printed by `bootstrap.sh`; or `az ad app list --display-name sp-storeops-github-deploy --query "[0].appId" -o tsv` |
| 11 | **SonarCloud** organisation, project key, token | Sonar job | sonarcloud.io; see Part A, step 4 |
| 12 | A **budget alert** (recommended) | avoid a surprise bill | Azure portal, Cost Management, Budgets, create a small monthly budget with an email alert |
| 13 | **GitHub plan features** | required reviewers on the `prod` environment need a public repo or a paid plan for private repos; CodeQL and free SonarCloud need a public repo | check your repo's Settings, Environments |

#### GitHub repository variables to create (Settings, Secrets and variables, Actions, **Variables**)

| Name | Value comes from |
|---|---|
| `AZURE_CLIENT_ID` | row 10 |
| `AZURE_TENANT_ID` | row 3 |
| `AZURE_SUBSCRIPTION_ID` | row 2 |
| `DEPLOYER_OBJECT_ID` | row 9 |
| `AZURE_LOCATION` | row 6 |
| `SONAR_ORGANIZATION`, `SONAR_PROJECT_KEY` | row 11 |

And one **secret**: `SONAR_TOKEN`. None of the Azure values are secrets (no password is stored; GitHub proves its identity to Azure by OIDC).

#### Pre-flight in one minute

The quickest way is the read-only script, which checks login, subscription state, your roles, Entra access, providers and the region, and tells you what to fix:

```bash
bash infra/scripts/preflight.sh "<subscription name or id>" uksouth      # creates nothing
```

Or by hand:

```bash
az account show --query "{name:name,id:id,tenant:tenantId}" -o table     # right subscription?
az group list --query "[?starts_with(name,'rg-storeops')].name" -o tsv   # after bootstrap: rg-storeops-dev, rg-storeops-prod
az ad sp list --display-name sp-storeops-github-deploy --query "[0].{id:id,appId:appId}" -o table
```

### 5. When something goes red

| Message in the log | Meaning, fix |
|---|---|
| `AADSTS700016` / `No subscription found` at **Azure login** | The variables are wrong or missing (names are case-sensitive), or the federated credential does not match the repo or environment name. Re-check rows 2, 3, 8, 10 |
| `AADSTS70021: No matching federated identity record` | The job ran in an environment/branch without a credential. `bootstrap.sh` created `dev`, `prod`, `main` and `pull_request`; confirm your environments are named exactly `dev` and `prod` |
| `AuthorizationFailed` on a role assignment | The deploy identity lacks **User Access Administrator** on the resource group; re-run `bootstrap.sh` |
| `MissingSubscriptionRegistration` | A provider is not registered; `az provider register --namespace <name> --wait` |
| Waiting for Key Vault role to propagate (10 attempts) | Normal for a few minutes after the first deployment |
| `Permission denied` running a script | Invoke it as `bash infra/scripts/<name>.sh` (the workflows already do) |
| `deploy-dev` ZAP step fails | First-run tuning: check the `target`/`cmd_options` in `ci-cd.yml`, and the alerts in the job summary |
| `sonar` fails on quality gate | Open the Sonar link in the log; fix the finding (or tune the gate, deliberately) |
| `Resource name already exists` for Key Vault | A soft-deleted vault with the same name; wait 7 days, purge it (`az keyvault purge`), or recover it |

### 6. Cost and cleanup

Run `bash infra/scripts/teardown.sh dev` (and `prod`) when you have your evidence. It asks you to type the resource group name before deleting.
Container Apps scales to zero in dev, so a few idle days cost little; the container registry is the main fixed cost.
