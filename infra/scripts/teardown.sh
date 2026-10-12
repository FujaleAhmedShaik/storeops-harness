#!/usr/bin/env bash
# Deletes an environment's resources to stop all cost, and waits until they are really gone.
#   bash infra/scripts/teardown.sh <dev|prod> [--yes] [--keep-group]
#
# Default: deletes the whole resource group. Afterwards the group and the pipeline identity's roles on it are gone, so run
#   bootstrap.sh again (idempotent, about 3 minutes) before the next deployment.
# --keep-group: deletes every resource in the group but keeps the group and the role assignments on it. This is what the manual
#   "Teardown dev" workflow uses, because the pipeline identity cannot recreate the group; the next pipeline run just redeploys.
#
# Why it does more than "az group delete":
#  - dev: the Key Vault is only soft-deleted and its name is deterministic, so it must be PURGED or the next deployment of the same
#    environment fails with "vault already exists in deleted state". Prod has purge protection (by design), so its vault cannot be purged.
#    Purging needs the "Key Vault Purge Operator" role at subscription scope. Whoever runs this must hold it (an Owner does); the pipeline
#    identity does not by default, so the script then prints the one command to run before the next deployment.
#  - the Log Analytics workspace is force-deleted for the same reason (otherwise its name stays reserved for 14 days).
set -euo pipefail

# shellcheck source=_common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

ENV_NAME="${1:?usage: teardown.sh <dev|prod> [--yes] [--keep-group]}"
shift
ASSUME_YES=false
KEEP_GROUP=false
for option in "$@"; do
  case "$option" in
    --yes) ASSUME_YES=true ;;
    --keep-group) KEEP_GROUP=true ;;
    *) echo "unknown option: $option" >&2; exit 2 ;;
  esac
done

RG="rg-storeops-${ENV_NAME}"
LOCATION="${AZURE_LOCATION:-uksouth}"

if ! az group show --name "$RG" >/dev/null 2>&1; then
  echo "Resource group '$RG' does not exist: nothing to delete."
  exit 0
fi

if [[ "$KEEP_GROUP" == "true" ]]; then
  echo "This permanently deletes every resource in '$RG' (the group itself and its role assignments are kept)."
else
  echo "This permanently deletes resource group '$RG' and everything in it."
fi
if [[ "$ASSUME_YES" != "true" ]]; then
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

if [[ "$KEEP_GROUP" == "true" ]]; then
  echo "Deleting the resources in '$RG' (a few minutes)..."
  # Some resources depend on others (the app before its environment), so retry what is left until nothing remains.
  for pass in 1 2 3 4 5 6; do
    REMAINING="$(az resource list --resource-group "$RG" --query '[].id' -o tsv)"
    [[ -n "$REMAINING" ]] || break
    while IFS= read -r resource_id; do
      [[ -n "$resource_id" ]] || continue
      az resource delete --ids "$resource_id" >/dev/null 2>&1 || echo " pass $pass: could not delete yet: $resource_id"
    done <<<"$REMAINING"
  done
  LEFT="$(az resource list --resource-group "$RG" --query 'length(@)' -o tsv)"
  [[ "$LEFT" == "0" ]] || { echo "ERROR: $LEFT resource(s) are still in '$RG'." >&2; exit 1; }
else
  echo "Deleting '$RG' (a few minutes)..."
  az group delete --name "$RG" --yes
fi

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

if [[ "$KEEP_GROUP" == "true" ]]; then
  echo "Done. To deploy '$ENV_NAME' again, run the CI/CD workflow on main (the group and roles are still in place)."
else
  echo "Done. To deploy '$ENV_NAME' again: run infra/scripts/bootstrap.sh (recreates the resource group and its roles), then the pipeline."
fi
