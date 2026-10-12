# shellcheck shell=bash
# Shared by the infra scripts (sourced, never run on its own).
#
# The Windows build of the Azure CLI ends every output line with CRLF. A stray carriage return silently corrupts any value captured with
# $(az ... -o tsv) and every comparison against it ("Enabled" is not "Enabled\r"; a vault name with \r is not a vault). This wrapper removes
# the carriage returns from az's standard output only; error messages and the exit status are untouched.
az() {
  command az "$@" | tr -d '\r'
  return "${PIPESTATUS[0]}"
}