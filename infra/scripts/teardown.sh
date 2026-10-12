#!/usr/bin/env bash
# Deletes an environment's resource group (and everything in it) to stop all cost, and waits until it is really gone.
#   bash infra/scripts/teardown.sh <dev|prod> [--yes]
#
# Why it does more than "az group delete":
#  - dev: the Key Vault is only soft-deleted and its name is deterministic, so it must be PURGED or the next deployment of the same
#    environment fails with "vault already exists in deleted state". Prod has purge protection (by design), so its vault cannot be purged.
#  - the Log Analytics workspace is force-deleted for the same reason (otherwise its name stays reserved for 14 days).
# Afterwards the resource group and its role assignments are gone: run bootstrap.sh again (idempotent, about 3 minutes) before the next deployment.
set -euo pipefail

# shellcheck source=_common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

ENV_NAME="${1:?usage: teardown.sh <dev|prod> [--yes]}"
RG="rg-storeops-${ENV_NAME}"
LOCATION="${AZURE_LOCATION:-uksouth}"

if ! az group show --name "$RG" >/dev/null 2>&1; then
  echo "Resource group '$RG' does not exist: nothing to delete."
  exit 0
fi

echo "This permanently deletes resource group '$RG' and everything in it."
if [[ "${2:-}" != "--yes" ]]; then
  read -r -p "Type the resource group name to confirm: " answer
  [[ "$answer" == "$RG" ]] || { echo "Aborted."; exit 1; }
fi

VAULTS="$(az keyvault list --resource-group "$RG" --query '[].name' -o tsv)"
WORKSPACES="$(az monitor log-analytics workspace list --resource-group "$RG" --query '[].name' -o tsv)"

while IFS= read -r workspace; do
  [[ -n "$workspace" ]] || continue
  az monitor log-analytics workspace delete --resource-group "$RG" --workspace-name "$workspace" --force true --yes >/dev/null 2>&1 \
    || echo " note: could not force-delete workspace '$workspace'; its name stays reserved for 14 days"
done <<<"$WORKSPACES"

echo "Deleting '$RG' (a few minutes)..."
az group delete --name "$RG" --yes

while IFS= read -r vault; do
  [[ -n "$vault" ]] || continue
  if [[ "$ENV_NAME" == "dev" ]]; then
    if az keyvault purge --name "$vault" --location "$LOCATION" >/dev/null 2>&1; then
      echo "Purged soft-deleted key vault '$vault'."
    else
      echo " note: could not purge '$vault'. Purge it before redeploying: az keyvault purge --name $vault --location $LOCATION"
    fi
  else
    echo "Key vault '$vault' has purge protection and stays soft-deleted for its retention period (it cannot be purged)."
  fi
done <<<"$VAULTS"

echo "Done. To deploy '$ENV_NAME' again: run infra/scripts/bootstrap.sh (recreates the resource group and its roles), then the pipeline."
