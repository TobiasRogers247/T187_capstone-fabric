# Energy Market Chaincode

This package provides the on-chain marketplace lifecycle for whole-energy listings.
Fabric is authoritative for final listing status, energy amount, token-unit price,
Fabric timestamps, immutable history, and completed settlement records. MongoDB
owns the complete buyer/seller handshake protocol, expiry decisions, UI data, and
operational projections.

Version 0.3.0 targets a fresh ledger. There is one transaction record format and
no migration path for the earlier test data.

## Listing State

```ts
{
  docType: "energyListing",
  listingId: "listing-001",
  userId: "seller-uuid",
  assetId: "battery-uuid",
  status: "active",
  energyKWh: 4.01,
  priceTokensPerKWh: 22,
  createdAt: "2026-09-10T00:00:00.000Z",
  closedAt: null,
}
```

The allowed lifecycle is:

```text
active -> sold
active -> cancelled
```

`cancelled` and `sold` are terminal and set `closedAt`. Listings are whole offers:
there is no remaining quantity, partial fill, mutable price/quantity state, or
on-chain pending state.

## Contract operations

- `CreateUser(userId, fabricEnrollmentId, initialBalanceCents)`
- `DeactivateUser(userId)`
- `CreateListing(listingId, userId, assetId, energyKWh, priceTokensPerKWh)`
- `ReadListing(listingId)`
- `ReadListings(status)` where `status` is `active`, `cancelled`, `sold`, or `all`
- `CancelListing(listingId, userId)`
- `CompletePurchaseHandshake(transactionId, listingId, buyerId, buyerAssetId)`
- `ReadTransaction(transactionId, requestingUserId)`
- `ReadTransactionsForUser(requestingUserId, pageSize, bookmark)`
- `GetListingHistory(listingId)`

`energyKWh` is a positive decimal string when submitted. `priceTokensPerKWh` is a
positive integer string and must be within JavaScript's safe integer range.
Creation also checks that the resulting total rounds to a positive, safe integer
token amount, so an invalid offer fails before it reaches the marketplace.

User account records contain the application user ID, Fabric enrollment ID,
initial `balanceCents`, account status and lifecycle timestamps. The existing
`balanceCents` field is separate from marketplace tokens; purchase completion
does not debit or credit it.

`ReadListing` returns one Fabric listing by ID. `ReadListings` returns the current
Fabric listings filtered by the requested status; it does not accept `pending`
because that handshake state remains in MongoDB.

The backend owns the handshake protocol, battery reservations, battery balances,
and application-user authentication. Fabric receives buyer information only after
acceptance, when `CompletePurchaseHandshake` atomically marks an active listing
`sold` and records the completed purchase. This does not itself update either
battery's stored energy or transfer token balances.

### What is stored

| Field                 | Meaning                                                                |
| --------------------- | ---------------------------------------------------------------------- |
| `docType`             | `energyTransaction`                                                    |
| `schemaVersion`       | `2` for new completed transactions                                     |
| `transactionId`       | Stable application transaction/handshake ID supplied by the backend    |
| `fabricTransactionId` | Fabric transaction ID of the original completion                       |
| `listingId`           | Purchased listing                                                      |
| `sellerId`, `buyerId` | Application user IDs                                                   |
| `assetId`             | Seller battery ID, copied from the listing                             |
| `buyerAssetId`        | Receiving battery ID validated by the backend                          |
| `energyKWh`           | Entire listing quantity, copied from the ledger                        |
| `priceTokensPerKWh`   | Whole-token price per kWh, copied from the ledger                      |
| `totalTokens`         | Quantity times price, rounded to the nearest whole token, ties upwards |
| `status`              | `completed`                                                            |
| `completedAt`         | Fabric proposal timestamp in UTC                                       |

No personal contact details, raw readings, pending requests, or battery balances
are stored in this transaction record. The sold listing also receives the
application `transactionId` to link it to its immutable purchase record.
Two `energyTransactionByUser` composite keys, containing the seller/buyer ID and
transaction ID, reference that record. They are written in the same commit as
the sold listing and transaction; they do not duplicate the purchase data.

### Complete a purchase

Submit `CompletePurchaseHandshake` once the seller has accepted and the backend
has validated the receiving battery. All four arguments are required strings.
The transaction ID must be allocated and persisted before the first submission.
Never generate a new ID just because a request timed out.

The contract rejects self-purchases, identical source/destination batteries,
cancelled or already sold listings, invalid totals, and reuse of an existing
transaction ID for different arguments. An exact retry returns the original
`{ listing, transaction }` without rewriting either record. Different completion
attempts for the same listing conflict through Fabric's normal read/write
validation; only one can commit. Clients must check commit status.

There is no arbitrary setter, edit, cancellation, or deletion operation for a
completed transaction. Listing quantity, seller and price come from the existing
ledger listing and cannot be overridden by completion arguments.

The total calculation uses the stored numeric kWh value's decimal representation
and integer arithmetic, rounding once at the end. For example, `1.005` kWh at
`100` tokens/kWh produces `101` tokens. This avoids binary floating-point rounding
at the half-token boundary without introducing a general-purpose decimal library.
It does not add arbitrary precision to the existing numeric kWh storage format.

### Read transactions

`ReadTransaction(transactionId, requestingUserId)` returns the stored record only
when the authenticated application user is its buyer or seller. Missing and
inaccessible transactions return the same error.

`ReadTransactionsForUser(requestingUserId, pageSize, bookmark)` returns
`{ transactions, bookmark }`, including purchases and sales. Pass a page size from
`"1"` to `"100"` and `""` as the initial bookmark. Pass each returned bookmark to
the next call, stopping only when it is empty. Keep the user and page size the
same for the duration of pagination.

The query reads only that user's composite-key index, then loads each referenced
transaction through the same access check used by the detail query. Page size
limits the user's results, not a scan of other users' transactions. Results are
in transaction ID order, not chronological order; consumers can sort the complete
history by `completedAt`. Pagination is a live view, not a frozen snapshot across
calls. The index is created with new transactions; old test ledgers are outside
this deployment's supported baseline.

### Access boundary

All write operations, including the existing user/listing writes, and both
transaction queries require a `PlatformOrgMSP` certificate carrying the
CA-issued attribute `energyMarket.backend=true`. An ordinary user, audit client,
or administrator without that service role cannot invoke these operations.
Listing reads and listing history retain their existing behavior.

The shared backend identity is trusted to supply `requestingUserId` from the
verified login session. **It must never forward a user ID chosen by a browser.**
Fabric sees the backend signer, not independent buyer/seller signatures. The
contract checks transaction membership after authenticating that service.

These are application-query permissions, not encryption or per-user ledger
privacy. Platform and Audit peer operators hold the shared channel ledger and
can inspect its data. Hiding records from those organisations would require a
different storage/privacy design.

See [transaction integration](../../docs/transaction-integration.md)
for the backend handoff and fresh deployment steps.

`expiresAt` remains a MongoDB operational field. When MongoDB determines a listing
has expired, the backend submits `CancelListing` using the listing owner's user ID.
