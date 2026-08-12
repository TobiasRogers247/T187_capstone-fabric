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
- setup documentation in `docs/`

It does not yet include a complete bootstrap flow for:

- enrollment and registration scripts
- generated MSP and TLS material
- generated channel artifacts
- committed chaincode source
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

Solidify the Ubuntu-side Fabric bootstrap flow by adding the missing registration, enrollment, and channel startup scripts under `network/scripts/`. After that, this repository can become the single source of truth for standing up the runtime network on Ubuntu.
