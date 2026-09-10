#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/common.sh"

require_command docker
configure_peer_cli

cd "${ROOT_DIR}"

# Create bind-mount roots as the invoking user before Docker starts the CA
# containers. Otherwise Docker creates a root-owned organizations directory and
# the subsequent enrollment scripts cannot create MSP directories beneath it.
mkdir -p \
  "${ROOT_DIR}/organizations/fabric-ca/platform" \
  "${ROOT_DIR}/organizations/fabric-ca/audit" \
  "${ROOT_DIR}/organizations/fabric-ca/ordererOrg"

docker compose --env-file .env \
  -f network/compose/compose-ca.yaml \
  -f network/compose/compose-net.yaml \
  up -d ca_platform ca_audit ca_orderer

wait_for_file "${ROOT_DIR}/organizations/fabric-ca/platform/ca-cert.pem"
wait_for_file "${ROOT_DIR}/organizations/fabric-ca/audit/ca-cert.pem"
wait_for_file "${ROOT_DIR}/organizations/fabric-ca/ordererOrg/ca-cert.pem"

bash "${SCRIPT_DIR}/registerEnroll-orderer.sh"
bash "${SCRIPT_DIR}/registerEnroll-platform.sh"
bash "${SCRIPT_DIR}/registerEnroll-audit.sh"

docker compose --env-file .env \
  -f network/compose/compose-ca.yaml \
  -f network/compose/compose-net.yaml \
  up -d orderer0.capstone.local peer0.platform.capstone.local peer0.audit.capstone.local

wait_for_container orderer0.capstone.local
wait_for_container peer0.platform.capstone.local
wait_for_container peer0.audit.capstone.local
wait_for_peer set_platform_peer_context
wait_for_peer set_audit_peer_context

bash "${SCRIPT_DIR}/createChannel.sh"
bash "${SCRIPT_DIR}/deployChaincode.sh"

echo "Fabric network bootstrap and chaincode deployment complete."
