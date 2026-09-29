# Fabric transaction integration (0.3.0)

This change implements the ledger portion of completed purchases. Handshake
decisions, reservations, receiving-capacity checks and actual battery balance
updates remain application responsibilities. The VM has not been upgraded by
changing these source files.

## Fresh network baseline

The 0.3.0 contract is intended for the planned fresh ledger. It writes the current
transaction schema and buyer/seller history indexes together. It does not migrate
or index the old test records. Do not deploy it over the old test ledger and expect
those records to appear in user history.

The transaction methods are:

| Operation                            | Ordered arguments after `ctx`                           |
| ------------------------------------ | ------------------------------------------------------- |
| `CompletePurchaseHandshake` (submit) | `transactionId`, `listingId`, `buyerId`, `buyerAssetId` |
| `ReadTransaction` (evaluate)         | `transactionId`, `requestingUserId`                     |
| `ReadTransactionsForUser` (evaluate) | `requestingUserId`, `pageSize`, `bookmark`              |

Listing method signatures are unchanged, but all writes now require the
backend service certificate role. New listings must also have a positive, safe
integer total after rounding; invalid totals are rejected at creation as well as
completion.

After the separately scheduled Fabric and MongoDB reset:

1. Pull the reviewed source and prepare the VM's private `.env`. Use chaincode
   version `0.3.0` and sequence `1` for the new channel.
2. Run `bash network/scripts/bootstrapNetwork.sh`. This generates new CA/MSP/TLS
   material, enrolls the backend with `energyMarket.backend=true`, creates the
   channel and deploys the contract. It does not perform the reset itself.
3. Use `exportBackendEnv.sh` to replace the backend's private Fabric configuration.
   Restart the backend to load the new certificate, key and trust roots. Do not
   reuse credentials or queued submissions from the removed network.
4. Connect the updated application adapter and validate one complete purchase
   before enabling marketplace writes.

This source update does not reset either database. The future reset preparation
and remaining runtime checks are in [Fabric review](fabric-review.md).

## Prompt for the application repository

Implement the backend Fabric transaction adapter against the 0.3.0 contract in
`T187_capstone-fabric`. Keep all changes in the application repository:

- Authenticate the HTTP user and derive their ID from the server session.
  Supply this as `requestingUserId` for all transaction queries; never trust a
  browser-supplied identity. Fabric's shared service identity has no independent
  knowledge of which HTTP user is logged in.
- Start settlement only after seller acceptance makes the handshake final.
  Validate buyer ownership of the receiving battery and reserve its capacity.
  Preserve the seller's existing listing reservation.
- Persist a stable application transaction ID and the immutable completion
  arguments before calling `CompletePurchaseHandshake`. Parse its
  `{ listing, transaction }` response and check IDs, parties, both battery IDs,
  energy, price and total against the accepted agreement.
- Record the original `fabricTransactionId` separately from the application
  `transactionId`. Use the latter for `ReadTransaction` and exact retries.
- Only a confirmed successful Fabric commit authorizes the MongoDB completion
  step: atomically subtract seller kWh, add buyer kWh, consume reservations and
  mark the application transaction completed. Guard this step so it happens
  once even after retries or a process restart.
- When commit outcome is uncertain, hold reservations and reconcile by the
  same application ID. A not-found response from one read is not proof that an
  in-flight transaction cannot still commit. Do not create a replacement ID or
  release reservations merely because the client timed out.
- Wire individual transaction details and user history through the new read
  methods. Keep the user and page size unchanged while following bookmarks;
  stop on an empty bookmark. Return no unfiltered/global transaction feed to users.
- Coordinate token rounding with the contract's decimal rounding rule. The
  ledger stores whole tokens and rejects totals outside the safe integer range.

No contract call adjusts battery availability, transfers token balances, or
attests to physical delivery. The ledger records the final agreement and its
source and destination battery references.

## Response and failure contract

All successful results are JSON strings. Parse them once in the Fabric adapter.

| Operation                   | Parsed result                                                  |
| --------------------------- | -------------------------------------------------------------- |
| `CompletePurchaseHandshake` | `{ listing, transaction }`, including on an identical retry    |
| `ReadTransaction`           | One stored transaction in the current schema                   |
| `ReadTransactionsForUser`   | `{ transactions, bookmark }`; pass the bookmark back unchanged |

Validation and authorization failures reject the call before ledger writes.
An unavailable transaction and one belonging to another user both return
`Transaction not found or not accessible`. Other failures include an unauthorized
service identity, invalid arguments, a conflicting transaction ID, or a listing
that is no longer active. Keep raw infrastructure errors out of HTTP responses.

A successful proposal response alone is not a successful commit. Commit failures
and transport timeouts need the reconciliation behavior described above; do not
treat either as permission to repeat the battery transfer.

## Verification and reference

From `chaincode/energy-market`, run `npm run typecheck`, `npm run build`, and the
existing `npm test` suite. Validate shell scripts with `bash -n` before using them
on the VM. Source-level checks do not verify a fresh network bootstrap or
concurrent commit outcomes on peers.

The implementation uses Fabric's documented
[certificate attributes](https://hyperledger-fabric-ca.readthedocs.io/en/latest/users-guide.html),
and [composite keys and read-only pagination](https://hyperledger.github.io/fabric-chaincode-node/main/api/fabric-shim.ChaincodeStub.html).
