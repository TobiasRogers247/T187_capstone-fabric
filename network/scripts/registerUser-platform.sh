#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/common.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") <enrollment-id> <secret>

Registers and enrolls a normal PlatformOrgMSP client identity with ca-platform.

Example:
  bash network/scripts/registerUser-platform.sh alice alicepw
EOF
}

if [[ $# -ne 2 ]]; then
  usage >&2
  exit 1
fi

USER_ID="$1"
USER_SECRET="$2"

require_command fabric-ca-client

PLATFORM_CA_NAME="ca-platform"
DOMAIN="${FABRIC_DOMAIN:-capstone.local}"
PLATFORM_ORG_DOMAIN="platform.${DOMAIN}"
PLATFORM_CA_CERT="${ROOT_DIR}/organizations/fabric-ca/platform/ca-cert.pem"
PLATFORM_ORG_DIR="${ROOT_DIR}/organizations/peerOrganizations/${PLATFORM_ORG_DOMAIN}"
PLATFORM_MSP_DIR="${PLATFORM_ORG_DIR}/msp"
USER_DIR="${PLATFORM_ORG_DIR}/users/${USER_ID}@${PLATFORM_ORG_DOMAIN}"
USER_MSP_DIR="${USER_DIR}/msp"

require_file "${PLATFORM_CA_CERT}"
require_file "${PLATFORM_MSP_DIR}/config.yaml"

if ! has_signcert "${PLATFORM_MSP_DIR}"; then
  echo "Platform bootstrap is incomplete. Run bash network/scripts/registerEnroll-platform.sh first." >&2
  exit 1
fi

if has_signcert "${USER_MSP_DIR}"; then
  echo "User ${USER_ID} is already enrolled."
  echo "MSP path: ${USER_MSP_DIR}"
  exit 0
fi

export FABRIC_CA_CLIENT_HOME="${PLATFORM_ORG_DIR}"

echo "Registering Platform user ${USER_ID}"
register_identity "${PLATFORM_CA_NAME}" "${PLATFORM_CA_CERT}" "${USER_ID}" "${USER_SECRET}" client

echo "Enrolling Platform user ${USER_ID}"
fabric-ca-client enroll \
  -u "https://${USER_ID}:${USER_SECRET}@localhost:7054" \
  --caname "${PLATFORM_CA_NAME}" \
  -M "${USER_MSP_DIR}" \
  --tls.certfiles "${PLATFORM_CA_CERT}"

cp "${PLATFORM_MSP_DIR}/config.yaml" "${USER_MSP_DIR}/config.yaml"

echo "Platform user enrollment complete."
echo "MSP path: ${USER_MSP_DIR}"
echo "Signcert: ${USER_MSP_DIR}/signcerts/cert.pem"
echo "Keystore: ${USER_MSP_DIR}/keystore"
