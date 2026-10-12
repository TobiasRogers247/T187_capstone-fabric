# Energy Market Chaincode

This package provides the on-chain marketplace lifecycle for whole-energy listings
and their token settlement. Fabric is authoritative for wallet value, immutable
wallet entries, final listing status, energy amount, token-unit price, Fabric
timestamps, and completed settlement records. MongoDB owns UI data and operational
projections only.

Version 0.5.0 aligns the fresh-start data model: `CreateUser` no longer accepts
legacy cents, wallet history uses per-wallet chronological sequences, and
backend-only paginated reads support rebuilding wallet and completed-trade
projections. This contract shape is intended for a fresh channel/ledger, not as
an in-place migration of the earlier test ledger.

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

- `CreateUser(userId, fabricEnrollmentId)`
- `DeactivateUser(userId)`
- `CreateWallet(walletId, ownerUserId, ownerFabricEnrollmentId, ownerMspId)`
- `ReadWallet(walletId)`
- `ReadWalletByOwner(ownerUserId)`
- `ReadWalletBalance(walletId)`
- `ReadWalletHistory(walletId, pageSize, bookmark)`
- `ReadWallets(pageSize, bookmark)` (backend-only projection rebuild)
- `IssueTokens(walletId, amountTokens, reference)`
- `HoldTokens(walletId, amountTokens, transactionId, listingId, idempotencyKey)`
- `SettleEnergyPurchase(buyerWalletId, sellerWalletId, holdId, transactionId, listingId, energyAmountKWh, priceTokensPerKWh, totalTokens, buyerAssetId)`
- `ReadSettlement(transactionId)`
- `CreateListing(listingId, userId, assetId, energyKWh, priceTokensPerKWh)`
- `ReadListing(listingId)`
- `ReadListings(status)` where `status` is `active`, `cancelled`, `sold`, or `all`
- `CancelListing(listingId, userId)`
- `ReadTransaction(transactionId, requestingUserId)`
- `ReadTransactionsForUser(requestingUserId, pageSize, bookmark)`
- `ReadAllTransactions(pageSize, bookmark)` (backend-only projection rebuild)
- `GetListingHistory(listingId)`

`CompletePurchaseHandshake` is retained as a rejected compatibility method. A
listing cannot be marked sold through that method; callers must use
`SettleEnergyPurchase` so the token transfer and marketplace completion are one
Fabric transaction.

## Token wallets

Each application user has at most one active wallet. Wallet creation verifies the
registered `CreateUser` enrollment mapping and the Platform MSP. A wallet stores
only whole, safe-integer token amounts in `availableBalanceTokens` and
`heldBalanceTokens`; its total is derived from those two values. Wallet status is
currently `active` or `closed`. Closed-wallet recovery operations are not part of
the test scope.

`IssueTokens` is the test-environment issuance operation. It requires the backend
service certificate to carry both `energyMarket.backend=true` and
`energyMarket.issuer=true`. Its reference is idempotent, and every issuance adds
an immutable `walletLedgerEntry`. It is not a balance setter.

`HoldTokens` moves tokens from available to held and is idempotent by its
idempotency key. The hold ID is deterministic from the marketplace transaction
ID. `SettleEnergyPurchase` consumes the active hold, credits the seller wallet,
writes buyer debit and seller credit entries, records the settlement receipt, and
marks the listing sold and transaction completed in the same Fabric transaction.
Repeating the same transaction ID returns the original receipt without moving
tokens again. Hold release/refunds and wallet freeze operations are intentionally
outside the current test scope.

Wallet history is stored as immutable entries. Each entry records its positive
amount, wallet/counterparty, marketplace references, idempotency reference,
acting Fabric identity and role, Fabric transaction ID, timestamp, and resulting
available/held values. Those entries can reconstruct the wallet's balance changes;
MongoDB must treat any wallet document as a projection.

The composite-key formats are deterministic:

```text
userAccount(userId)
energyListing(listingId)
energyTransaction(transactionId)
energyTransactionByUser(userId, transactionId) -> transactionId
energyListingReservation(listingId)
tokenWallet(walletId)
tokenWalletByOwner(ownerUserId)
tokenWalletLedger(walletId, zeroPaddedSequence)  # sequence padded to 16 digits
tokenWalletOperation(operation, sha256(reference))
tokenWalletHold(holdId)
tokenWalletSettlement(transactionId)
```

`HoldTokens` atomically creates the deterministic listing reservation alongside
the hold and wallet update. The reservation key is unique per listing, so
competing hold transactions conflict during Fabric MVCC validation. Settlement
must consume the matching reservation in the same transaction that marks the
listing sold. Listing cancellation is rejected while a reservation is active.
There is no release/refund operation in this test scope, so a confirmed hold
that cannot settle still requires operator reconciliation.

The backend derives wallet IDs as `wallet-<applicationUserId>`. The ledger
sequence is allocated from the wallet state in the same Fabric transaction as
the balance change and ledger entry.

`energyKWh` is a positive decimal string when submitted. `priceTokensPerKWh` is a
positive integer string and must be within JavaScript's safe integer range.
Creation also checks that the resulting total rounds to a positive, safe integer
token amount, so an invalid offer fails before it reaches the marketplace.

User account records contain the application user ID, Fabric enrollment ID,
account status and lifecycle timestamps. Legacy `balanceCents` is not stored
or used by this contract; token issuance and settlement do not use currency
fields.

`ReadListing` returns one Fabric listing by ID. `ReadListings` returns the current
Fabric listings filtered by the requested status; it does not accept `pending`
because that handshake state remains in MongoDB. An `active` listing with an
active token reservation is omitted from `ReadListings("active")`, although its
stored listing status remains `active` until settlement marks it sold.

The backend owns the handshake protocol, battery reservations, battery balances,
and application-user authentication. After acceptance, the backend creates a
token hold and calls `SettleEnergyPurchase`. Fabric verifies the listing terms and
wallet relationships, consumes the hold, credits the seller, records the completed
purchase, and marks the listing `sold` in one commit. This does not itself update
either battery's stored energy.

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

### Settle a purchase

After the seller has accepted and the backend has validated the receiving battery,
call `HoldTokens` and immediately call `SettleEnergyPurchase` using the same
validated terms. The settlement arguments are
the buyer wallet, seller wallet, hold ID, application transaction ID, listing ID,
energy quantity, whole-token price, expected total, and optional buyer battery ID.
The transaction ID must be allocated and persisted before the first submission.
Never generate a new ID just because a request timed out.

The contract rejects self-purchases, wallet mismatches, cancelled or already sold
listings, invalid totals, and reuse of an existing transaction ID for different
arguments. An exact retry returns the original settlement receipt without rewriting
wallets, entries, the listing, or the transaction. Different settlement attempts
for the same listing conflict through Fabric's normal read/write validation; only
one can commit. Clients must check commit status and use `ReadSettlement` after an
unknown outcome.

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

`ReadWalletHistory(walletId, pageSize, bookmark)` returns entries in ascending
per-wallet sequence. The sequence is allocated atomically with each wallet
balance change and stored in the immutable entry. The composite key uses a
zero-padded 16-digit sequence, so Fabric key ordering is chronological for that
wallet even when multiple entries share a timestamp. The read page is a live
view; reuse the returned bookmark exactly until it is empty.

`ReadWallets(pageSize, bookmark)` and `ReadAllTransactions(pageSize, bookmark)`
are backend-service-only reads for rebuilding MongoDB projections. They do not
expose data to the frontend. Rebuild wallet documents with `availableBalanceTokens`
mapped to Mongo `balanceTokens`; do not project held or derived total balances
into the current wallet collection. Rebuild completed transaction documents
from the Fabric `energyTransaction` records. Application user profiles and
certificate/private-key material remain app-owned and cannot be rebuilt from
these contract queries.

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
