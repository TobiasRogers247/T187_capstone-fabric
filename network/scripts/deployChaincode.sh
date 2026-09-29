#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/common.sh"

require_command npm
require_command node
require_command peer
configure_peer_cli

DOMAIN="${FABRIC_DOMAIN:-capstone.local}"
CHANNEL_NAME="${FABRIC_CHANNEL_NAME:-energychannel}"
CHAINCODE_NAME="${FABRIC_CHAINCODE_NAME:-energy-market}"
CHAINCODE_SEQUENCE="${FABRIC_CHAINCODE_SEQUENCE:-1}"
CHAINCODE_PATH="${ROOT_DIR}/chaincode/${CHAINCODE_NAME}"
require_file "${CHAINCODE_PATH}/package.json"
CHAINCODE_VERSION="${FABRIC_CHAINCODE_VERSION:-$(node -p 'require(process.argv[1]).version' "${CHAINCODE_PATH}/package.json")}"
CHAINCODE_LABEL="${CHAINCODE_NAME}_${CHAINCODE_VERSION}"
PACKAGE_PATH="${ROOT_DIR}/channel-artifacts/${CHAINCODE_LABEL}.tar.gz"
ENDORSEMENT_POLICY="OR('${PLATFORM_ORG_MSP:-PlatformOrgMSP}.peer')"
ORDERER_TLS_CA="$(orderer_tls_ca_path)"

require_file "${ORDERER_TLS_CA}"
if [[ ! "${CHAINCODE_SEQUENCE}" =~ ^[1-9][0-9]*$ ]]; then
  echo "FABRIC_CHAINCODE_SEQUENCE must be a positive integer." >&2
  exit 1
fi
mkdir -p "${ROOT_DIR}/channel-artifacts"

set_platform_peer_context
committed_definitions="$(
  peer lifecycle chaincode querycommitted \
    --channelID "${CHANNEL_NAME}" \
    --output json
)"
committed_sequence="$(
  node -e '
    const fs = require("node:fs");
    const response = JSON.parse(fs.readFileSync(0, "utf8"));
    const definition = (response.chaincode_definitions ?? [])
      .find(item => item.name === process.argv[1]);
    process.stdout.write(String(definition?.sequence ?? 0));
  ' "${CHAINCODE_NAME}" <<<"${committed_definitions}"
)"
expected_sequence=$((committed_sequence + 1))
if ((CHAINCODE_SEQUENCE != expected_sequence)); then
  echo "FABRIC_CHAINCODE_SEQUENCE must be ${expected_sequence} for this deployment." >&2
  exit 1
fi

pushd "${CHAINCODE_PATH}" >/dev/null
npm ci
npm run build
popd >/dev/null

peer lifecycle chaincode package "${PACKAGE_PATH}" \
  --path "${CHAINCODE_PATH}" \
  --lang node \
  --label "${CHAINCODE_LABEL}"

PACKAGE_ID="$(peer lifecycle chaincode calculatepackageid "${PACKAGE_PATH}")"

install_and_approve() {
  local peer_context="$1"

  "${peer_context}"
  if ! peer lifecycle chaincode queryinstalled | grep -Fq "Package ID: ${PACKAGE_ID}"; then
    peer lifecycle chaincode install "${PACKAGE_PATH}"
  fi
  peer lifecycle chaincode approveformyorg \
    -o localhost:7050 \
    --ordererTLSHostnameOverride "orderer0.${DOMAIN}" \
    --tls \
    --cafile "${ORDERER_TLS_CA}" \
    --channelID "${CHANNEL_NAME}" \
    --name "${CHAINCODE_NAME}" \
    --version "${CHAINCODE_VERSION}" \
    --package-id "${PACKAGE_ID}" \
    --sequence "${CHAINCODE_SEQUENCE}" \
    --signature-policy "${ENDORSEMENT_POLICY}"
}

install_and_approve set_platform_peer_context
install_and_approve set_audit_peer_context

set_platform_peer_context
peer lifecycle chaincode checkcommitreadiness \
  --channelID "${CHANNEL_NAME}" \
  --name "${CHAINCODE_NAME}" \
  --version "${CHAINCODE_VERSION}" \
  --sequence "${CHAINCODE_SEQUENCE}" \
  --signature-policy "${ENDORSEMENT_POLICY}" \
  --output json

PLATFORM_TLS_CA="${CORE_PEER_TLS_ROOTCERT_FILE}"
set_audit_peer_context
AUDIT_TLS_CA="${CORE_PEER_TLS_ROOTCERT_FILE}"

peer lifecycle chaincode commit \
  -o localhost:7050 \
  --ordererTLSHostnameOverride "orderer0.${DOMAIN}" \
  --tls \
  --cafile "${ORDERER_TLS_CA}" \
  --channelID "${CHANNEL_NAME}" \
  --name "${CHAINCODE_NAME}" \
  --version "${CHAINCODE_VERSION}" \
  --sequence "${CHAINCODE_SEQUENCE}" \
  --signature-policy "${ENDORSEMENT_POLICY}" \
  --peerAddresses localhost:7051 \
  --tlsRootCertFiles "${PLATFORM_TLS_CA}" \
  --peerAddresses localhost:8051 \
  --tlsRootCertFiles "${AUDIT_TLS_CA}"

set_platform_peer_context
peer lifecycle chaincode querycommitted \
  --channelID "${CHANNEL_NAME}" \
  --name "${CHAINCODE_NAME}"

echo "Chaincode ${CHAINCODE_NAME} deployment complete."
