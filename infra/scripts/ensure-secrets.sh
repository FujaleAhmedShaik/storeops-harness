#!/usr/bin/env bash
# Creates the application secrets in Key Vault if (and only if) they do not exist. Values are random,
# written through a private temp file, and never echoed. Existing secrets are never rotated here; the one thing
# that is repaired is a trailing newline, which an earlier version of this script stored by mistake.
set -euo pipefail

# shellcheck source=_common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

ENV_NAME="${1:?usage: ensure-secrets.sh <dev|prod>}"
RG="rg-storeops-${ENV_NAME}"
VAULT="$(az deployment group show --resource-group "$RG" --name "platform-${ENV_NAME}" --query properties.outputs.keyVaultName.value -o tsv)"

SECRETS=(jwt-secret)
[[ "$ENV_NAME" == "dev" ]] && SECRETS+=(demo-password) # demo users exist in dev only

umask 077
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# Writes the file in $TMP as the secret's value.
store_secret() { # name
  az keyvault secret set --vault-name "$VAULT" --name "$1" --file "$TMP" --encoding utf-8 -o none 2>/dev/null
}

for name in "${SECRETS[@]}"; do
  # RBAC assignments can take a few minutes to propagate after the platform deployment.
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if az keyvault secret show --vault-name "$VAULT" --name "$name" --query id -o tsv >/dev/null 2>&1; then
      # A stored value that ends in a newline would reach the app as part of the password and no login would ever match it.
      # JSON output shows the newline as \n or \r\n just before the closing quote.
      if az keyvault secret show --vault-name "$VAULT" --name "$name" --query value -o json | grep -Eq '\\[nr]"$'; then
        value="$(az keyvault secret show --vault-name "$VAULT" --name "$name" --query value -o tsv)" # the shell drops the trailing newline
        printf '%s' "$value" > "$TMP"
        store_secret "$name"
        echo "secret '$name' repaired (trailing newline removed)"
      else
        echo "secret '$name' already present"
      fi
      break
    fi
    openssl rand -hex 32 | tr -d '\r\n' > "$TMP" # no trailing newline, and no CR from a Windows openssl
    if store_secret "$name"; then
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
