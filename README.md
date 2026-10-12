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

This repository contains the Fabric network setup and energy marketplace chaincode.
Transaction completion, wallet state, and participant-scoped query APIs are
documented in [the chaincode README](chaincode/energy-market/README.md). For the
wallet and backend handoff, see
[transaction integration](docs/transaction-integration.md).
An earlier [Fabric review](docs/fabric-review.md) includes reset-preparation
notes; those are planning notes, not current reset authorization or deployment
instructions. Use the handover guide below for the current integration status.
The wallet-specific contract details are in [wallet integration](docs/wallet-integration.md).
The end-to-end architecture, identity lifecycle, application endpoints, and
handover/deployment notes are in the [Fabric handover guide](docs/fabric-handover.md).

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
audit queries, but does not need to endorse normal marketplace writes. The
backend service identity is enrolled with the test-only
`energyMarket.issuer=true` attribute so its controlled issuance endpoint can call
`IssueTokens`.

The planned fresh deployment uses these values in the VM `.env`:

```text
FABRIC_CHAINCODE_VERSION=0.5.0
FABRIC_CHAINCODE_SEQUENCE=1
```

The bootstrap command above includes chaincode deployment. For a later approved
upgrade, set a new version and increment the committed sequence by exactly one,
then run:

```bash
bash network/scripts/deployChaincode.sh
```

The deployment script checks that the target sequence is exactly one greater
than the committed channel sequence. A read-only VM query on 12 October 2026
confirmed `energy-market` version `0.4.1`, sequence `3`. The current source
changes the `CreateUser` signature and wallet-ledger key and state formats, so
it targets a fresh channel at sequence `1`. Do not deploy it over the existing
VM ledger without an approved migration or reset plan. Bootstrap does not
erase or reset an old network.

`git pull` updates source only. It does not create a channel or deploy chaincode.
Run the lifecycle script after pulling an approved chaincode change.

The export script reads the backend endpoint values from `.env`, so shared VM setups can override `BACKEND_FABRIC_PEER_ENDPOINT`, `BACKEND_FABRIC_CA_URL`, and `BACKEND_FABRIC_CA_AFFILIATION` there.

After that bootstrap is in place, you can register a normal Platform user identity with `bash network/scripts/registerUser-platform.sh <enrollment-id> <secret>`.

To revoke a Platform user identity in Fabric CA, use `bash network/scripts/revokeUser-platform.sh <enrollment-id> [reason]`.
This updates the CA; peer rejection of an already-issued certificate also needs
a CRL update in the channel MSP. Application deactivation is a separate action.
