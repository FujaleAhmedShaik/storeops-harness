#!/usr/bin/env bash
# Read-only Azure pre-flight. Creates and changes NOTHING. Run it before bootstrap.sh and before the first pipeline run.
#   bash infra/scripts/preflight.sh [subscription-name-or-id] [location]
# Prints PASS / WARN / FAIL per item with what to do about it. Exits 1 if anything FAILed.
set -uo pipefail

# shellcheck source=_common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

SUBSCRIPTION="${1:-}"
LOCATION="${2:-uksouth}"
FAILS=0

pass() { echo "PASS  $1"; }
warn() { echo "WARN  $1"; }
fail() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }

SUB_ARGS=()
if [[ -n "$SUBSCRIPTION" ]]; then
  SUB_ARGS=(--subscription "$SUBSCRIPTION")
fi

echo "== 1. Azure CLI"
if ! command -v az >/dev/null 2>&1; then
  fail "Azure CLI not found. Install it from https://aka.ms/installazurecli"
  exit 1
fi
pass "Azure CLI $(az version --query '"azure-cli"' -o tsv 2>/dev/null)"

echo "== 2. Login and token (this is what every az command needs)"
if az account get-access-token "${SUB_ARGS[@]}" --query expiresOn -o tsv >/dev/null 2>&1; then
  pass "a valid token can be obtained"
else
  fail "no usable token. Run: az login   (if it then says the tenant is not found, that subscription's tenant no longer exists: pick another with 'az account list --all -o table')"
  exit 1
fi

echo "== 3. Subscription"
NAME="$(az account show "${SUB_ARGS[@]}" --query name -o tsv 2>/dev/null)"
STATE="$(az account show "${SUB_ARGS[@]}" --query state -o tsv 2>/dev/null)"
SUB_ID="$(az account show "${SUB_ARGS[@]}" --query id -o tsv 2>/dev/null)"
TENANT_ID="$(az account show "${SUB_ARGS[@]}" --query tenantId -o tsv 2>/dev/null)"
echo "      name=$NAME  tenant=$TENANT_ID"
if [[ "$STATE" == "Enabled" ]]; then
  pass "subscription is Enabled"
else
  fail "subscription state is '$STATE' (needs Enabled)"
fi
echo "      (confirm this is the subscription you intend to spend on; AZURE_SUBSCRIPTION_ID = $SUB_ID)"

echo "== 4. Your permissions on the subscription"
ME="$(az ad signed-in-user show --query id -o tsv 2>/dev/null)"
if [[ -z "$ME" ]]; then
  warn "could not read your Entra user (guest or restricted account?). Roles below may be incomplete"
fi
ROLES="$(az role assignment list "${SUB_ARGS[@]}" --all ${ME:+--assignee "$ME"} --include-inherited --query '[].roleDefinitionName' -o tsv 2>/dev/null | sort -u)"
if grep -qx "Owner" <<<"$ROLES"; then
  pass "you are Owner (can create resource groups and role assignments)"
elif grep -qx "Contributor" <<<"$ROLES" && grep -qx "User Access Administrator" <<<"$ROLES"; then
  pass "you have Contributor + User Access Administrator"
elif [[ -z "$ROLES" ]]; then
  warn "no role assignments found for you (they may come from a group). bootstrap.sh will tell you if it is denied"
else
  fail "roles found: $(tr '\n' ',' <<<"$ROLES") . You need Owner, or Contributor + User Access Administrator"
fi

echo "== 5. Entra ID: can you read app registrations? (bootstrap creates one)"
if az ad app list --display-name sp-storeops-github-deploy --query 'length(@)' -o tsv >/dev/null 2>&1; then
  pass "directory read works. Creating the app registration can only be proven by running bootstrap.sh"
else
  warn "cannot read app registrations. Ask your tenant admin, or create the app and federated credentials in the portal (docs/INFRA-SETUP.md)"
fi

echo "== 6. Resource providers"
for provider in Microsoft.App Microsoft.ContainerRegistry Microsoft.KeyVault Microsoft.OperationalInsights Microsoft.Insights Microsoft.ManagedIdentity; do
  REG="$(az provider show "${SUB_ARGS[@]}" -n "$provider" --query registrationState -o tsv 2>/dev/null)"
  if [[ "$REG" == "Registered" ]]; then
    pass "$provider registered"
  else
    warn "$provider is '${REG:-unknown}' (bootstrap.sh registers it; needs a few minutes)"
  fi
done

echo "== 7. Region '$LOCATION' supports Container Apps environments"
WANT="$(tr '[:upper:]' '[:lower:]' <<<"${LOCATION// /}")"
REGIONS="$(az provider show "${SUB_ARGS[@]}" --namespace Microsoft.App --query "resourceTypes[?resourceType=='managedEnvironments'].locations[]" -o tsv 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
if grep -qx "$WANT" <<<"$REGIONS"; then
  pass "$LOCATION is available"
elif [[ -z "$REGIONS" ]]; then
  warn "could not list regions (provider not registered yet?). Check the Azure portal: Container Apps, Create"
else
  fail "$LOCATION not offered for Container Apps environments. Available: $(tr '\n' ' ' <<<"$REGIONS" | cut -c1-200)"
fi

echo "== 8. Existing StoreOps resources"
GROUPS_FOUND="$(az group list "${SUB_ARGS[@]}" --query "[?starts_with(name,'rg-storeops')].name" -o tsv 2>/dev/null)"
if [[ -z "$GROUPS_FOUND" ]]; then
  pass "none yet (expected before bootstrap)"
else
  warn "already present: $(tr '\n' ' ' <<<"$GROUPS_FOUND") (fine if you are re-running)"
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "Pre-flight OK. Next: bash infra/scripts/bootstrap.sh <github-owner>/<repo> $LOCATION"
else
  echo "Pre-flight found $FAILS problem(s). Fix the FAIL lines above, then re-run."
  exit 1
fi
