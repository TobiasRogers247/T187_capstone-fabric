#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/common.sh"

require_command configtxgen
require_command osnadmin
require_command peer
configure_peer_cli

DOMAIN="${FABRIC_DOMAIN:-capstone.local}"
CHANNEL_NAME="${FABRIC_CHANNEL_NAME:-energychannel}"
CHANNEL_BLOCK="${ROOT_DIR}/channel-artifacts/${CHANNEL_NAME}.block"
ORDERER_DIR="${ROOT_DIR}/organizations/ordererOrganizations/${DOMAIN}"
ORDERER_TLS_CA="$(orderer_tls_ca_path)"
ORDERER_ADMIN_TLS_DIR="${ORDERER_DIR}/users/Admin@${DOMAIN}/tls"

require_file "${ORDERER_TLS_CA}"
require_file "${ORDERER_ADMIN_TLS_DIR}/server.crt"
require_file "${ORDERER_ADMIN_TLS_DIR}/server.key"

mkdir -p "${ROOT_DIR}/channel-artifacts"

if [[ ! -f "${CHANNEL_BLOCK}" ]]; then
  configtxgen \
    -configPath "${ROOT_DIR}/network/config" \
    -profile EnergyChannelUsingRaft \
    -channelID "${CHANNEL_NAME}" \
    -outputBlock "${CHANNEL_BLOCK}"
fi

if ! osnadmin channel list \
  -o localhost:7053 \
  --ca-file "${ORDERER_TLS_CA}" \
  --client-cert "${ORDERER_ADMIN_TLS_DIR}/server.crt" \
  --client-key "${ORDERER_ADMIN_TLS_DIR}/server.key" | grep -Fq "\"name\": \"${CHANNEL_NAME}\""; then
  osnadmin channel join \
    --channelID "${CHANNEL_NAME}" \
    --config-block "${CHANNEL_BLOCK}" \
    -o localhost:7053 \
    --ca-file "${ORDERER_TLS_CA}" \
    --client-cert "${ORDERER_ADMIN_TLS_DIR}/server.crt" \
    --client-key "${ORDERER_ADMIN_TLS_DIR}/server.key"
fi

join_peer_if_needed() {
  local peer_context="$1"

  "${peer_context}"
  if ! peer channel list | grep -Fxq "${CHANNEL_NAME}"; then
    peer channel join -b "${CHANNEL_BLOCK}"
  fi
}

join_peer_if_needed set_platform_peer_context
join_peer_if_needed set_audit_peer_context

echo "Channel ${CHANNEL_NAME} is joined by the orderer, Platform peer, and Audit peer."
