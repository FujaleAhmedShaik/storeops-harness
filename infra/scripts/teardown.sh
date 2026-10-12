#!/usr/bin/env bash
# Deletes an environment's resource group (and everything in it) to stop all cost.
#   teardown.sh <dev|prod>
# The Key Vault is soft-deleted; prod also has purge protection, so its name stays reserved for the retention period.
set -euo pipefail
ENV_NAME="${1:?usage: teardown.sh <dev|prod>}"
RG="rg-storeops-${ENV_NAME}"
echo "This permanently deletes resource group '$RG' and everything in it."
read -r -p "Type the resource group name to confirm: " answer
[[ "$answer" == "$RG" ]] || { echo "Aborted."; exit 1; }
az group delete --name "$RG" --yes --no-wait
echo "Deletion started (runs in the background)."
