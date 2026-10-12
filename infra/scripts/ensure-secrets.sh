#!/usr/bin/env bash
# Creates the application secrets in Key Vault if (and only if) they do not exist. Values are random,
# written through a private temp file, and never echoed. Existing secrets are never rotated here.
set -euo pipefail

ENV_NAME="${1:?usage: ensure-secrets.sh <dev|prod>}"
RG="rg-storeops-${ENV_NAME}"
VAULT="$(az deployment group show --resource-group "$RG" --name "platform-${ENV_NAME}" --query properties.outputs.keyVaultName.value -o tsv)"

SECRETS=(jwt-secret)
[[ "$ENV_NAME" == "dev" ]] && SECRETS+=(demo-password) # demo users exist in dev only

umask 077
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

for name in "${SECRETS[@]}"; do
  # RBAC assignments can take a few minutes to propagate after the platform deployment.
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if az keyvault secret show --vault-name "$VAULT" --name "$name" --query id -o tsv >/dev/null 2>&1; then
      echo "secret '$name' already present"
      break
    fi
    openssl rand -hex 32 > "$TMP"
    if az keyvault secret set --vault-name "$VAULT" --name "$name" --file "$TMP" --encoding utf-8 -o none 2>/dev/null; then
      echo "secret '$name' created"
      break
    fi
    echo "waiting for Key Vault role assignment to propagate (attempt $attempt/10)..."
    sleep 15
    if [[ "$attempt" == "10" ]]; then
      echo "ERROR: could not write secret '$name'" >&2
      exit 1
    fi
  done
done
