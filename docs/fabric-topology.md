# Fabric Topology

This repository starts with a three-organization Fabric network:

- `OrdererOrgMSP`
- `PlatformOrgMSP`
- `AuditOrgMSP`

## Identity Mapping

| Identity type               | Org              | Issuing CA    | Purpose                                                                                     |
| --------------------------- | ---------------- | ------------- | ------------------------------------------------------------------------------------------- |
| `platformAdmin`             | `PlatformOrgMSP` | `ca-platform` | Administrative actions for the app org                                                      |
| `backend-service`           | `PlatformOrgMSP` | `ca-platform` | Marketplace writes and user-scoped transaction queries; carries `energyMarket.backend=true` |
| Normal app users            | `PlatformOrgMSP` | `ca-platform` | Buyers, sellers, and general platform identities                                            |
| `auditAdmin`                | `AuditOrgMSP`    | `ca-audit`    | Read/query/reporting identities                                                             |
| `ordererAdmin` / `orderer0` | `OrdererOrgMSP`  | `ca-orderer`  | Ordering service identities                                                                 |

## Node Layout

```text
OrdererOrgMSP
  ca-orderer
  orderer0.capstone.local

PlatformOrgMSP
  ca-platform
  peer0.platform.capstone.local

AuditOrgMSP
  ca-audit
  peer0.audit.capstone.local
```

## Channel

- Channel name: `energychannel`
- Channel members:
  - `PlatformOrgMSP`
  - `AuditOrgMSP`

`OrdererOrgMSP` provides the ordering service for the channel but is not an application org.

The checked-in Compose files, channel configuration and contract use the fixed
`capstone.local` domain and the MSP names above. The scripts reject incompatible
environment overrides; changing topology requires updating those sources together.

Application users access transactions through the authenticated backend. Normal
user and audit certificates cannot invoke the restricted transaction methods.
Audit peer operators still hold a copy of the channel ledger; query permissions
do not hide data from the organisations operating the peers.

## Where Data Lives

- `organizations/`
  - Generated MSP folders, TLS material, CA server data
- `channel-artifacts/`
  - Generated channel blocks and transactions
- `runtime/ledgers/`
  - Persistent peer and orderer ledger state mounted into Docker containers

These locations are ignored by Git because they are generated at runtime.

## Important Note

The Docker Compose files define the containers that run the network.

They do **not** by themselves create the MSP folders or user identities. Those are produced by the enrollment/register scripts that talk to:

- `ca-platform`
- `ca-audit`
- `ca-orderer`

## First Implementation Scope

Start with one peer per application org:

- `peer0.platform.capstone.local`
- `peer0.audit.capstone.local`

This is enough to:

- run a multi-org Fabric network
- issue user identities from `PlatformOrgMSP`
- keep an independent audit copy of the ledger
