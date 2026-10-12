#!/usr/bin/env bash
# One-time, human-run bootstrap. Creates the things a pipeline cannot create for itself:
#   - resource groups for dev and prod
#   - an Entra app registration + service principal for GitHub Actions (no client secret: OIDC federation)
#   - federated credentials limited to this repository's dev / prod environments, main branch and pull requests
#     (in both subject formats GitHub can issue: by name, and by numeric owner/repository id)
#   - role assignments scoped to the two resource groups only (never the subscription)
# Everything else (registry, key vault, container apps ...) is created by the infra pipeline from infra/main.bicep.
#
# Usage:  az login && bash infra/scripts/bootstrap.sh <github-owner>/<repo> [location]
# Run from Git Bash, WSL or Azure Cloud Shell. Needs permission to create app registrations in your Entra tenant.
set -euo pipefail

# shellcheck source=_common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

REPO="${1:?usage: bootstrap.sh <github-owner>/<repo> [location]}"
LOCATION="${2:-uksouth}"
APP_NAME="sp-storeops-github-deploy"
ENVIRONMENTS=(dev prod)

command -v az >/dev/null || { echo "Azure CLI not found"; exit 1; }
SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
TENANT_ID="$(az account show --query tenantId -o tsv)"
echo "Subscription: $(az account show --query name -o tsv) ($SUBSCRIPTION_ID)"
echo "Repository:   $REPO"
echo "Location:     $LOCATION"
read -r -p "Continue and create resources in this subscription? [y/N] " answer
[[ "$answer" == "y" || "$answer" == "Y" ]] || { echo "Aborted."; exit 1; }

echo "==> Registering resource providers (idempotent)"
for provider in Microsoft.App Microsoft.ContainerRegistry Microsoft.KeyVault Microsoft.OperationalInsights Microsoft.Insights Microsoft.ManagedIdentity; do
  az provider register --namespace "$provider" --wait >/dev/null
done

echo "==> Creating resource groups"
for env in "${ENVIRONMENTS[@]}"; do
  az group create --name "rg-storeops-$env" --location "$LOCATION" --tags workload=storeops environment="$env" -o none
done

echo "==> Creating the pipeline identity"
APP_ID="$(az ad app list --display-name "$APP_NAME" --query '[0].appId' -o tsv)"
if [[ -z "$APP_ID" ]]; then
  APP_ID="$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)"
fi
OBJECT_ID="$(az ad sp list --filter "appId eq '$APP_ID'" --query '[0].id' -o tsv)"
if [[ -z "$OBJECT_ID" ]]; then
  OBJECT_ID="$(az ad sp create --id "$APP_ID" --query id -o tsv)"
fi

echo "==> Federated credentials (OIDC, no secrets)"
add_federated_credential() { # name subject
  if ! az ad app federated-credential list --id "$APP_ID" --query "[?name=='$1'].name" -o tsv | grep -q .; then
    az ad app federated-credential create --id "$APP_ID" --parameters \
      "{\"name\":\"$1\",\"issuer\":\"https://token.actions.githubusercontent.com\",\"subject\":\"$2\",\"audiences\":[\"api://AzureADTokenExchange\"]}" -o none
  fi
}
add_subject_credentials() { # name-prefix subject-prefix
  for env in "${ENVIRONMENTS[@]}"; do
    add_federated_credential "$1env-$env" "$2:environment:$env"
  done
  add_federated_credential "${1}main" "$2:ref:refs/heads/main"
  add_federated_credential "${1}pull-request" "$2:pull_request"
}
add_subject_credentials "github-" "repo:$REPO"

# GitHub can put the numeric owner and repository ids in the OIDC subject (repo:OWNER@ID/REPO@ID:...). The token then
# matches only a credential written the same way, so create both forms: whichever one GitHub presents will match.
github_id() { # $1 = jq path (gh), $2 = sed expression (public API fallback)
  if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
    gh api "repos/$REPO" --jq "$1" 2>/dev/null
  else
    curl -fsS "https://api.github.com/repos/$REPO" 2>/dev/null | tr -d '\n ' | sed -n "$2"
  fi
}
OWNER_ID="${GITHUB_OWNER_ID:-$(github_id '.owner.id' 's/.*"owner":{"login":"[^"]*","id":\([0-9]*\).*/\1/p')}"
REPO_ID="${GITHUB_REPO_ID:-$(github_id '.id' 's/^{"id":\([0-9]*\),.*/\1/p')}"
if [[ -n "$OWNER_ID" && -n "$REPO_ID" ]]; then
  add_subject_credentials "github-id-" "repo:${REPO%%/*}@$OWNER_ID/${REPO#*/}@$REPO_ID"
else
  echo "WARNING: could not look up the GitHub owner/repository ids, so only the plain-name credentials exist."
  echo "         If the pipeline later fails with AADSTS700213, re-run with GITHUB_OWNER_ID=<id> GITHUB_REPO_ID=<id> set."
fi

echo "==> Role assignments (resource-group scope only)"
for env in "${ENVIRONMENTS[@]}"; do
  scope="/subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-storeops-$env"
  # Contributor deploys resources; User Access Administrator lets the template create its own role assignments.
  az role assignment create --assignee-object-id "$OBJECT_ID" --assignee-principal-type ServicePrincipal --role "Contributor" --scope "$scope" -o none 2>/dev/null || true
  az role assignment create --assignee-object-id "$OBJECT_ID" --assignee-principal-type ServicePrincipal --role "User Access Administrator" --scope "$scope" -o none 2>/dev/null || true
done

cat <<EOF

Bootstrap complete. Add these as GitHub *repository variables* (Settings > Secrets and variables > Actions > Variables).
They are identifiers, not secrets:

  AZURE_CLIENT_ID        = $APP_ID
  AZURE_TENANT_ID        = $TENANT_ID
  AZURE_SUBSCRIPTION_ID  = $SUBSCRIPTION_ID
  DEPLOYER_OBJECT_ID     = $OBJECT_ID
  AZURE_LOCATION         = $LOCATION

Then create GitHub *environments* named "dev" and "prod" (add required reviewers to prod).
Full walkthrough: docs/INFRA-SETUP.md
EOF

if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  read -r -p "Set these variables on $REPO now with the GitHub CLI? [y/N] " set_vars
  if [[ "$set_vars" == "y" || "$set_vars" == "Y" ]]; then
    gh variable set AZURE_CLIENT_ID --repo "$REPO" --body "$APP_ID"
    gh variable set AZURE_TENANT_ID --repo "$REPO" --body "$TENANT_ID"
    gh variable set AZURE_SUBSCRIPTION_ID --repo "$REPO" --body "$SUBSCRIPTION_ID"
    gh variable set DEPLOYER_OBJECT_ID --repo "$REPO" --body "$OBJECT_ID"
    gh variable set AZURE_LOCATION --repo "$REPO" --body "$LOCATION"
    echo "Variables set."
  fi
fi
