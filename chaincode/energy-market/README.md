# Energy Market Chaincode

This package provides the on-chain marketplace lifecycle for whole-energy listings.
Fabric is authoritative for listing status, energy amount, token-unit price,
Fabric timestamps, immutable history, and completed settlement records. MongoDB
owns the buyer handshake details before settlement, expiry decisions, UI data, and
operational projections.

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
active -> pending -> active
active -> pending -> sold
active -> cancelled
pending -> cancelled
```

`cancelled` and `sold` are terminal and set `closedAt`. Listings are whole offers:
there is no remaining quantity, partial fill, or mutable price/quantity state.

## Transactions

- `CreateListing(listingId, userId, assetId, energyKWh, priceTokensPerKWh)`
- `ReadListing(listingId)`
- `GetActiveListings()`
- `BeginPurchaseHandshake(listingId)`
- `WithdrawPurchaseHandshake(listingId)`
- `CancelListing(listingId, userId)`
- `CompletePurchaseHandshake(listingId, buyerId)`
- `ReadTransaction(transactionId)`
- `GetListingHistory(listingId)`

`energyKWh` is a positive decimal string when submitted. `priceTokensPerKWh` is a
positive integer string and must be within JavaScript's safe integer range.

The backend owns handshake authorization because it signs through the shared
backend service Fabric identity. A buyer ID is not stored in a listing while the
handshake is pending. On `CompletePurchaseHandshake`, Fabric atomically marks the
pending listing `sold` and writes this immutable transaction state:

```ts
{
  docType: "energyTransaction",
  transactionId: "fabric-transaction-id",
  listingId: "listing-001",
  sellerId: "seller-uuid",
  buyerId: "buyer-uuid",
  assetId: "battery-uuid",
  energyKWh: 4.01,
  priceTokensPerKWh: 22,
  completedAt: "2026-09-10T00:00:00.000Z",
}
```

`expiresAt` remains a MongoDB operational field. When MongoDB determines a listing
has expired, the backend submits `CancelListing` using the listing owner's user ID.
