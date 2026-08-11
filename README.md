# T187 Capstone Fabric

This repository contains the Hyperledger Fabric layer for the capstone project.

## Purpose

This repo should store the Fabric source and setup assets that can be cloned locally or onto the remote Ubuntu VM and then used to generate the runtime network there.

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

## Next Step

After this scaffold, set up the local runtime in `WSL2 Ubuntu` with `Docker Desktop`, then install the Fabric samples, binaries, and Docker images so the local dev network can be started and tested.

