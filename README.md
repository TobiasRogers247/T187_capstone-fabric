# T187 Capstone Fabric

This repository contains the Hyperledger Fabric layer for the capstone project.

## Purpose

This repository stores the Fabric source, templates, and setup assets that can be pushed to GitHub, pulled onto Ubuntu, and used there to generate the runtime network.

## Repository Layout

```text
T187_capstone-fabric/
  chaincode/
    energy-market/
  docs/
  gateway/
    connection-profiles/
  network/
    compose/
    config/
    scripts/
  .env.example
  .gitignore
  README.md
```

## Current State

This repository is currently a Fabric scaffold.

It already includes:

- environment defaults in `.env.example`
- CA and network Docker Compose definitions
- channel topology in `network/config/configtx.yaml`
- initial TypeScript chaincode in `chaincode/energy-market`
- organization bootstrap, channel creation, and chaincode lifecycle scripts in `network/scripts/`
- setup documentation in `docs/`

It does not include gateway connection assets for the application. The backend uses
the generated Platform service identity through `network/scripts/exportBackendEnv.sh`.

## Commit These

- chaincode source
- docker compose files
- Fabric config templates
- channel and deployment scripts
- connection profile templates
- setup documentation

## Do Not Commit These

- private keys
- certificates
- MSP folders
- generated `organizations/`
- generated `channel-artifacts/`
- wallets / keystores
- local Docker ledger state
- real `.env` files

## Workflow

1. Keep source, templates, scripts, and docs in this repository.
2. Push approved changes to GitHub.
3. Pull the repository onto the Ubuntu host or VM.
4. Generate runtime artifacts there.
5. Run Docker and Fabric operations there, not from committed generated output.

## VM Bootstrap

On the Fabric VM, copy `.env.example` to `.env` if it does not already exist and
replace the example CA secrets before running a shared environment.

The first network bootstrap creates generated MSP/TLS material, starts the orderer
and peers, creates `energychannel`, and deploys `energy-market`:

```bash
cd ~/code/T187_capstone-fabric
bash network/scripts/bootstrapNetwork.sh
```

The deployed chaincode uses a Platform-only endorsement policy. `AuditOrgMSP`
approves the chaincode definition and maintains an independent peer for read and
audit queries, but does not need to endorse normal marketplace writes.

To deploy an approved chaincode upgrade, increment both values in the VM `.env`:

```text
FABRIC_CHAINCODE_VERSION=0.2.0
FABRIC_CHAINCODE_SEQUENCE=2
```

Then run:

```bash
bash network/scripts/deployChaincode.sh
```

`git pull` updates source only. It does not create a channel or deploy chaincode.
Run the lifecycle script after pulling an approved chaincode change.

The export script reads the backend endpoint values from `.env`, so shared VM setups can override `BACKEND_FABRIC_PEER_ENDPOINT`, `BACKEND_FABRIC_CA_URL`, and `BACKEND_FABRIC_CA_AFFILIATION` there.

After that bootstrap is in place, you can register a normal Platform user identity with `bash network/scripts/registerUser-platform.sh <enrollment-id> <secret>`.

To revoke a Platform user identity in Fabric CA, use `bash network/scripts/revokeUser-platform.sh <enrollment-id> [reason]`.
