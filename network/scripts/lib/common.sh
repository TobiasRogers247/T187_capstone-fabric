#!/usr/bin/env bash

set -euo pipefail

COMMON_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${COMMON_SCRIPT_DIR}/../../.." && pwd)"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

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

first_file() {
  find "$1" -maxdepth 1 -type f -print -quit
}

has_signcert() {
  [[ -d "$1/signcerts" ]] && [[ -n "$(first_file "$1/signcerts")" ]]
}

register_identity() {
  local ca_name="$1"
  local ca_cert="$2"
  local name="$3"
  local secret="$4"
  local identity_type="$5"

  set +e
  local output
  output="$(
    fabric-ca-client register \
      --caname "${ca_name}" \
      --id.name "${name}" \
      --id.secret "${secret}" \
      --id.type "${identity_type}" \
      --tls.certfiles "${ca_cert}" 2>&1
  )"
  local status=$?
  set -e

  if [[ ${status} -ne 0 ]] && ! grep -qi "already registered" <<<"${output}"; then
    printf '%s\n' "${output}" >&2
    exit "${status}"
  fi
}

write_node_ou_config() {
  local msp_dir="$1"
  local ca_cert_name
  ca_cert_name="$(basename "$(first_file "${msp_dir}/cacerts")")"

  cat > "${msp_dir}/config.yaml" <<EOF
NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: cacerts/${ca_cert_name}
    OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
    Certificate: cacerts/${ca_cert_name}
    OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
    Certificate: cacerts/${ca_cert_name}
    OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
    Certificate: cacerts/${ca_cert_name}
    OrganizationalUnitIdentifier: orderer
EOF
}

copy_tls_files() {
  local tls_dir="$1"

  cp "$(first_file "${tls_dir}/tlscacerts")" "${tls_dir}/ca.crt"
  cp "$(first_file "${tls_dir}/signcerts")" "${tls_dir}/server.crt"
  cp "$(first_file "${tls_dir}/keystore")" "${tls_dir}/server.key"
}

wait_for_file() {
  local file_path="$1"
  local retries="${2:-30}"

  for ((attempt = 1; attempt <= retries; attempt += 1)); do
    if [[ -f "${file_path}" ]]; then
      return 0
    fi

    sleep 2
  done

  echo "Timed out waiting for required file: ${file_path}" >&2
  exit 1
}

wait_for_container() {
  local container_name="$1"
  local retries="${2:-30}"

  for ((attempt = 1; attempt <= retries; attempt += 1)); do
    if [[ "$(docker inspect -f '{{.State.Running}}' "${container_name}" 2>/dev/null || true)" == "true" ]]; then
      return 0
    fi

    sleep 2
  done

  echo "Container did not start: ${container_name}" >&2
  exit 1
}

wait_for_peer() {
  local peer_context="$1"
  local retries="${2:-30}"

  for ((attempt = 1; attempt <= retries; attempt += 1)); do
    "${peer_context}"
    if peer node status >/dev/null 2>&1; then
      return 0
    fi

    sleep 2
  done

  echo "Peer did not become ready: ${CORE_PEER_ADDRESS}" >&2
  exit 1
}

configure_peer_cli() {
  export FABRIC_CFG_PATH="${FABRIC_CFG_PATH:-${HOME}/hyperledger/fabric-samples/config}"
  require_file "${FABRIC_CFG_PATH}/core.yaml"
}

set_platform_peer_context() {
  local domain="${FABRIC_DOMAIN:-capstone.local}"
  local org_domain="platform.${domain}"
  local org_dir="${ROOT_DIR}/organizations/peerOrganizations/${org_domain}"

  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID="${PLATFORM_ORG_MSP:-PlatformOrgMSP}"
  export CORE_PEER_TLS_ROOTCERT_FILE="${org_dir}/peers/peer0.${org_domain}/tls/ca.crt"
  export CORE_PEER_MSPCONFIGPATH="${org_dir}/users/Admin@${org_domain}/msp"
  export CORE_PEER_ADDRESS=localhost:7051
}

set_audit_peer_context() {
  local domain="${FABRIC_DOMAIN:-capstone.local}"
  local org_domain="audit.${domain}"
  local org_dir="${ROOT_DIR}/organizations/peerOrganizations/${org_domain}"

  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID="${AUDIT_ORG_MSP:-AuditOrgMSP}"
  export CORE_PEER_TLS_ROOTCERT_FILE="${org_dir}/peers/peer0.${org_domain}/tls/ca.crt"
  export CORE_PEER_MSPCONFIGPATH="${org_dir}/users/Admin@${org_domain}/msp"
  export CORE_PEER_ADDRESS=localhost:8051
}

orderer_tls_ca_path() {
  local domain="${FABRIC_DOMAIN:-capstone.local}"
  printf '%s\n' "${ROOT_DIR}/organizations/ordererOrganizations/${domain}/orderers/orderer0.${domain}/tls/ca.crt"
}
