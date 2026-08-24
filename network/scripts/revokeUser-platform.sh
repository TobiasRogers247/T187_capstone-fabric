#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

usage() {
  cat <<EOF
Usage: $(basename "$0") <enrollment-id> [reason]

Revokes a PlatformOrgMSP user identity in ca-platform.

Example:
  bash network/scripts/revokeUser-platform.sh user-e33a875f-2186-4a4e-aa8b-ecb6d0b953b9 superseded
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Missing required file: $1" >&2
    exit 1
  fi
}

has_files() {
  local directory="$1"
  [[ -d "${directory}" ]] && find "${directory}" -maxdepth 1 -type f | read -r _
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage >&2
  exit 1
fi

USER_ID="$1"
REVOKE_REASON="${2:-}"

require_command fabric-ca-client

PLATFORM_CA_NAME="ca-platform"
DOMAIN="${FABRIC_DOMAIN:-capstone.local}"
PLATFORM_ORG_DOMAIN="platform.${DOMAIN}"
PLATFORM_CA_CERT="${ROOT_DIR}/organizations/fabric-ca/platform/ca-cert.pem"
PLATFORM_ORG_DIR="${ROOT_DIR}/organizations/peerOrganizations/${PLATFORM_ORG_DOMAIN}"
PLATFORM_MSP_DIR="${PLATFORM_ORG_DIR}/msp"

require_file "${PLATFORM_CA_CERT}"
require_file "${PLATFORM_MSP_DIR}/config.yaml"

if ! has_files "${PLATFORM_MSP_DIR}/signcerts"; then
  echo "Platform bootstrap is incomplete. Run bash network/scripts/registerEnroll-platform.sh first." >&2
  exit 1
fi

export FABRIC_CA_CLIENT_HOME="${PLATFORM_ORG_DIR}"

revoke_command=(
  fabric-ca-client revoke
  --caname "${PLATFORM_CA_NAME}"
  --revoke.name "${USER_ID}"
  --tls.certfiles "${PLATFORM_CA_CERT}"
)

if [[ -n "${REVOKE_REASON}" ]]; then
  revoke_command+=(--revoke.reason "${REVOKE_REASON}")
fi

echo "Revoking Platform user ${USER_ID}"
"${revoke_command[@]}"

echo "Platform user revocation complete."
