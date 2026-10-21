# T187 Capstone Fabric

Hyperledger Fabric network and TypeScript chaincode for the Kanavoogle energy marketplace. The contract manages user mappings, token wallets, energy listings and settlement. See the [chaincode README](chaincode/energy-market/README.md) for its operations and data model.

## Requirements

Run the network on Ubuntu with Docker Engine, the Compose plugin and Node.js/npm compatible with the [chaincode package](chaincode/energy-market/package.json).

The network uses Fabric 2.5.16 and Fabric CA 1.5.17. Install their binaries under ~/hyperledger/fabric-samples/bin and keep the Fabric configuration in ~/hyperledger/fabric-samples/config.

## Setup

For a fresh network, clone the repository onto the Ubuntu host and prepare the private configuration:

```bash
cd ~/code/T187_capstone-fabric
test -e .env || cp .env.example .env
chmod 600 .env
```

Replace the example enrolment secrets in .env. For the current package on a new channel, set:

```text
FABRIC_CHAINCODE_VERSION=0.5.1
FABRIC_CHAINCODE_SEQUENCE=1
```

Start initial provisioning:

```bash
bash network/scripts/bootstrapNetwork.sh
```

Bootstrap enrols the organisations and service identity, starts the CAs, orderer and peers, creates energychannel and deploys energy-market. Existing ledgers are preserved; inspect existing runtime state before provisioning.

## Backend configuration

Set BACKEND_FABRIC_PEER_ENDPOINT and BACKEND_FABRIC_CA_URL in .env to addresses reachable from the backend. For a remote CA connection, configure PLATFORM_CA_CSR_HOSTS before its first startup so the certificate includes that hostname.

Export credentials into a protected file:

```bash
umask 077
bash network/scripts/exportBackendEnv.sh > backend-fabric.env
```

The export includes a private signing key and CA administrator credentials. Keep it outside Git and use it only in the backend's private configuration.

## Chaincode updates

For an approved update, inspect the live committed definition, set the intended package version and use the committed sequence plus one in .env. Then run:

```bash
bash network/scripts/deployChaincode.sh
```

The script installs the package on both peers, collects their approvals and commits the definition. Normal marketplace transactions require Platform peer endorsement.

## Tests

```bash
cd chaincode/energy-market
npm ci
npm test
```

Tests build the TypeScript contract and exercise it with a mocked Fabric context.
