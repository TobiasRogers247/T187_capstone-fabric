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
- backend-first Platform bootstrap scripts in `network/scripts/`
- setup documentation in `docs/`

It does not yet include a complete bootstrap flow for:

- generated MSP and TLS material
- generated channel artifacts
- gateway connection assets for the application

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

## Next Step

Use `network/scripts/registerEnroll-platform.sh` to generate the minimum Platform org material for a backend health check, then start `peer0.platform.capstone.local` and run `network/scripts/exportBackendEnv.sh` to print the backend env block. The full multi-org bootstrap flow is still the next milestone after that.

After that bootstrap is in place, you can register a normal Platform user identity with `bash network/scripts/registerUser-platform.sh <enrollment-id> <secret>`.

To revoke a Platform user identity in Fabric CA, use `bash network/scripts/revokeUser-platform.sh <enrollment-id> [reason]`.
