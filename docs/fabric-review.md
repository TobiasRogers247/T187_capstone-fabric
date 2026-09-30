# Fabric functionality review

The next deployment targets a fresh ledger and a coordinated reset of the
application's MongoDB data. Source changes do not perform either reset. The VM,
MongoDB and Git remote are untouched by this review.

## Contract responsibilities

| Area              | Operations                                                      | Responsibility                                                                               |
| ----------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Users             | `CreateUser`, `DeactivateUser`                                  | Record the application user/enrollment mapping and account lifecycle                         |
| Listings          | `CreateListing`, `ReadListing`, `ReadListings`, `CancelListing` | Record whole offers, validate quantities/prices/totals, and enforce terminal listing states  |
| Completion        | `SettleEnergyPurchase`                                          | Consume the buyer hold, credit the seller, and commit the sold listing and transaction together |
| Transaction reads | `ReadTransaction`, `ReadTransactionsForUser`                    | Authenticate the backend service and restrict returned records to the requested buyer/seller |
| Listing audit     | `GetListingHistory`                                             | Return the listing's ledger history                                                          |

Each completed purchase has one transaction record and two composite-key index
entries, one for each party. Retries use the same application ID and return the
original record without new writes. History queries use Fabric's native index
and pagination APIs. There is no global transaction scan or legacy-record adapter.

Wallet state and immutable wallet ledger entries are also authoritative in Fabric.
Test issuance uses the issuer-authorised backend identity. MongoDB may project
wallet balances and history, but it cannot authorise a spend or directly change a
wallet balance.

The backend owns user authentication, account eligibility, battery ownership,
energy reservations, receiving capacity, pending handshake decisions and expiry.
`DeactivateUser` records status; it does not revoke a certificate or independently
block marketplace operations submitted by the shared service identity. The
backend must enforce that eligibility. Its battery updates must happen exactly
once after confirmed Fabric commit. `SettleEnergyPurchase` transfers the held
tokens atomically; it does not change physical energy or battery balances.

## Network and scripts

- Three CAs enroll the Platform, Audit and Orderer organisations. Platform
  enrollment grants the backend service attribute on the fresh certificate.
- Bootstrap generates runtime identities, starts the nodes, creates/joins the
  channel and invokes chaincode deployment. It is not a reset command.
- Deployment uses the package version when no environment override is supplied,
  reads committed definitions as JSON and requires the next sequence exactly.
  Query failures stop deployment instead of being mistaken for an empty channel.
- Registration, revocation and backend export reuse `lib/common.sh` for shared
  environment and filesystem helpers.
- User revocation updates the CA. Propagating revocation to peers requires CRLs
  in the relevant local and channel MSPs; this repository does not automate that
  channel update. See the [Fabric CA revocation documentation](https://hyperledger-fabric-ca.readthedocs.io/en/latest/users-guide.html#generating-a-crl-certificate-revocation-list).
- The topology is fixed to the names in [Fabric topology](fabric-topology.md).
  It has one orderer and one peer per application organisation; it is a capstone
  environment, not a highly available deployment.

## Validation boundary

Local checks cover TypeScript compilation, the existing contract tests, targeted
user/listing/transaction checks, shell syntax, Compose configuration and formatting.
An in-memory contract check cannot prove endorsement, commit conflict behavior,
CA enrollment or successful startup of fresh containers.

After the scheduled reset, verify the following on the VM before opening writes:

1. Fresh enrollment and backend service attribute; both peers join the channel
  and commit chaincode version `0.4.0`, sequence `1` on a fresh channel.
2. User creation/deactivation and listing creation/read/filter/cancellation.
3. One accepted purchase appears in detail and both parties' paginated history;
   another user and an unprivileged Fabric client are denied transaction access.
4. A repeated settlement returns the original receipt; competing purchases and
   cancellation/completion races allow only one valid terminal transition.
5. The application debits/credits batteries once, including after a timeout or
   restart. A cancelled pending handshake releases its reservations.
6. Listing history and completed purchases remain readable after node restart.

## Future reset preparation

This is the scope to prepare when the reset is scheduled, not an instruction to
execute it during code review:

1. Stop application writes and workers, including settlement retries. Inventory
   the exact Fabric containers and resolved runtime paths, plus the application
   MongoDB database and collections. Limit removal to that project inventory.
2. Remove the project's old Fabric runtime, including peer/orderer ledgers,
   CA databases, generated MSP/TLS identities and channel/chaincode artifacts.
   Include old chaincode containers belonging to this network. Docker container
   removal alone does not erase the bind-mounted ledger and CA directories.
3. Clear the agreed MongoDB collections, pending jobs and cached Fabric identities
   together. Preserve/recreate required indexes. Do not let old reservations or
   settlement retries survive into the new ledger.
4. Bootstrap the new network with sequence `1`, export fresh backend credentials,
   restart the application and run the checks above. Recreate application data
   through the normal flows so IDs match across MongoDB and Fabric.

The precise MongoDB collection list and removal commands belong to the later
reset task, after inspecting the actual runtime. No deletion script is included.

API arguments, return values and the application handoff are documented in
[transaction integration](transaction-integration.md). Stored fields and access
rules are documented in the [chaincode README](../chaincode/energy-market/README.md).
