# Energy Market Chaincode

This package provides the on-chain marketplace lifecycle for whole-energy listings.
Fabric is authoritative for final listing status, energy amount, token-unit price,
Fabric timestamps, immutable history, and completed settlement records. MongoDB
owns the complete buyer/seller handshake protocol, expiry decisions, UI data, and
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
active -> sold
active -> cancelled
```

`cancelled` and `sold` are terminal and set `closedAt`. Listings are whole offers:
there is no remaining quantity, partial fill, mutable price/quantity state, or
on-chain pending state.

## Transactions

- `CreateListing(listingId, userId, assetId, energyKWh, priceTokensPerKWh)`
- `ReadListing(listingId)`
- `ReadListings(status)` where `status` is `active`, `cancelled`, `sold`, or `all`
- `CancelListing(listingId, userId)`
- `CompletePurchaseHandshake(listingId, buyerId)`
- `ReadTransaction(transactionId)`
- `GetListingHistory(listingId)`

`energyKWh` is a positive decimal string when submitted. `priceTokensPerKWh` is a
positive integer string and must be within JavaScript's safe integer range.

`ReadListing` returns one Fabric listing by ID. `ReadListings` returns the current
Fabric listings filtered by the requested status; it does not accept `pending`
because that handshake state remains in MongoDB.

The backend owns the handshake protocol and authorization because it signs through
the shared backend service Fabric identity. Fabric receives no handshake or buyer
data until `CompletePurchaseHandshake`, which atomically marks an active listing
`sold` and writes this immutable transaction state:

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
