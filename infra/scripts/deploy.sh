#!/usr/bin/env bash
# Idempotent environment deployment used by BOTH pipelines (infra.yml and ci-cd.yml).
#  deploy.sh <dev|prod> [image]
# 1. platform (logs, registry, key vault, identity, container apps environment)
# 2. secrets that must exist before the app starts (generated once, never printed)
# 3. the Container App - only if an image is supplied or one is already running
# Required env: DEPLOYER_OBJECT_ID. Optional: AZURE_LOCATION (default uksouth), DEPLOYER_PRINCIPAL_TYPE (ServicePrincipal, the default for the
# pipeline identity; use User when you run this from your laptop with DEPLOYER_OBJECT_ID=$(az ad signed-in-user show --query id -o tsv)).
set -euo pipefail

# shellcheck source=_common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

ENV_NAME="${1:?usage: deploy.sh <dev|prod> [image]}"
IMAGE="${2:-}"
RG="rg-storeops-${ENV_NAME}"
APP="ca-storeops-api-${ENV_NAME}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$HERE/../main.bicep"
: "${DEPLOYER_OBJECT_ID:?DEPLOYER_OBJECT_ID is required (printed by bootstrap.sh)}"
LOCATION="${AZURE_LOCATION:-uksouth}"
COMMON=(environmentName="$ENV_NAME" location="$LOCATION" deployerPrincipalId="$DEPLOYER_OBJECT_ID" deployerPrincipalType="${DEPLOYER_PRINCIPAL_TYPE:-ServicePrincipal}")

# `az containerapp` is an extension; without it the "is an app already running?" lookup below would silently see nothing.
az extension show --name containerapp >/dev/null 2>&1 || az extension add --name containerapp --only-show-errors

echo "==> [1/3] Platform for '$ENV_NAME'"
az deployment group create --resource-group "$RG" --name "platform-${ENV_NAME}" \
  --template-file "$TEMPLATE" --parameters "${COMMON[@]}" deployApp=false -o none

echo "==> [2/3] Secrets"
bash "$HERE/ensure-secrets.sh" "$ENV_NAME"

if [[ -z "$IMAGE" ]]; then
  IMAGE="$(az containerapp show --resource-group "$RG" --name "$APP" --query 'properties.template.containers[0].image' -o tsv 2>/dev/null || true)"
fi

if [[ -z "$IMAGE" ]]; then
  echo "==> [3/3] No image yet - platform only. Run the app pipeline to deploy the application."
  APP_URL=""
else
  echo "==> [3/3] Application image: $IMAGE"
  az deployment group create --resource-group "$RG" --name "app-${ENV_NAME}" \
    --template-file "$TEMPLATE" --parameters "${COMMON[@]}" deployApp=true containerImage="$IMAGE" -o none
  APP_URL="$(az deployment group show --resource-group "$RG" --name "app-${ENV_NAME}" --query properties.outputs.appUrl.value -o tsv)"
  echo "Application URL: $APP_URL"
fi

ACR_NAME="$(az deployment group show --resource-group "$RG" --name "platform-${ENV_NAME}" --query properties.outputs.acrName.value -o tsv)"
KV_NAME="$(az deployment group show --resource-group "$RG" --name "platform-${ENV_NAME}" --query properties.outputs.keyVaultName.value -o tsv)"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "acr_name=$ACR_NAME"
    echo "key_vault=$KV_NAME"
    echo "app_url=$APP_URL"
  } >> "$GITHUB_OUTPUT"
fi
