#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/common.sh"

require_command npm
require_command peer
configure_peer_cli

DOMAIN="${FABRIC_DOMAIN:-capstone.local}"
CHANNEL_NAME="${FABRIC_CHANNEL_NAME:-energychannel}"
CHAINCODE_NAME="${FABRIC_CHAINCODE_NAME:-energy-market}"
CHAINCODE_VERSION="${FABRIC_CHAINCODE_VERSION:-0.1.0}"
CHAINCODE_SEQUENCE="${FABRIC_CHAINCODE_SEQUENCE:-1}"
CHAINCODE_LABEL="${CHAINCODE_NAME}_${CHAINCODE_VERSION}"
CHAINCODE_PATH="${ROOT_DIR}/chaincode/${CHAINCODE_NAME}"
PACKAGE_PATH="${ROOT_DIR}/channel-artifacts/${CHAINCODE_LABEL}.tar.gz"
ENDORSEMENT_POLICY="OR('${PLATFORM_ORG_MSP:-PlatformOrgMSP}.peer')"
ORDERER_TLS_CA="$(orderer_tls_ca_path)"

require_file "${ORDERER_TLS_CA}"
require_file "${CHAINCODE_PATH}/package.json"
mkdir -p "${ROOT_DIR}/channel-artifacts"

if set_platform_peer_context && peer lifecycle chaincode querycommitted \
  --channelID "${CHANNEL_NAME}" \
  --name "${CHAINCODE_NAME}" >/dev/null 2>&1; then
  echo "${CHAINCODE_NAME} is already committed on ${CHANNEL_NAME}." >&2
  echo "Set FABRIC_CHAINCODE_VERSION and FABRIC_CHAINCODE_SEQUENCE for an approved upgrade." >&2
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
