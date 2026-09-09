# Energy Market Chaincode

This package contains the first Fabric chaincode slice for the capstone.

## Current Transactions

- `CreateUser(userId, fabricEnrollmentId, initialBalanceCents)`
- `DeactivateUser(userId)`
- `CreateListing(listingId, sellerId, assetId, quantityKwh, pricePerKwhTokenUnits, tokenSymbol)`
- `ReadListing(listingId)`
- `CancelListing(listingId, sellerId)`
- `GetListingHistory(listingId)`

## User State

Each on-chain user account stores:

- `userId`
- `fabricEnrollmentId`
- `balanceCents`
- `status`
- `createdAt`
- `updatedAt`
- `deactivatedAt`

## Notes

- Balances are stored as integer cents.
- User deletion is modeled as status change to `INACTIVE`.
- Fabric CA identity revocation is handled separately from chaincode state changes.

## Listing State

Each listing is an immutable lifecycle record addressed by `listingId`. Its current
world-state value is updated as the listing progresses, while Fabric retains every
version in key history. Listings are never physically deleted.

```ts
{
  docType: "energyListing",
  listingId: "listing-001",
  sellerId: "application-user-uuid",
  assetId: "battery-uuid",
  quantityKwh: 1.5,
  remainingKwh: 1.5,
  pricePerKwhTokenUnits: 25,
  tokenSymbol: "ENERGY",
  status: "active",
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  cancelledAt: null
}
```

The allowed statuses are `active`, `cancelled`, `sold`, and `expired`. This slice
creates active listings and cancels active listings. A future purchase transaction
will reduce `remainingKwh`, transfer tokens, create a purchase record, and mark a
listing `sold` when its remaining quantity reaches zero.

`quantityKwh` is a positive decimal string at invocation time. Token prices are
positive integer units; use no floating-point currency values. The only supported
token symbol is `ENERGY`.

## Listing Transactions

### CreateListing

Submit a new seller offer. Duplicate IDs, empty IDs, non-positive quantities,
non-positive/non-integer token prices, and token symbols other than `ENERGY` are
rejected. `remainingKwh` is initialized from `quantityKwh`; timestamps come from
the Fabric transaction timestamp.

```ts
await fabricClient.submitTransaction(
  "CreateListing",
  listingId,
  sellerId,
  assetId,
  quantityKwh.toString(),
  pricePerKwhTokenUnits.toString(),
  "ENERGY",
);
```

Returns the created listing JSON.

### ReadListing

Evaluate the current listing state. A missing ID returns `Listing <listingId> does not exist`.

```ts
await fabricClient.evaluateTransaction("ReadListing", listingId);
```

### CancelListing

Submit a cancellation. The supplied seller ID must own the listing, and only an
`active` listing can be cancelled. Cancellation preserves `quantityKwh` and
`remainingKwh`, sets `status` to `cancelled`, and sets Fabric-derived timestamps.

```ts
await fabricClient.submitTransaction("CancelListing", listingId, sellerId);
```

### GetListingHistory

Evaluate the Fabric audit history for a listing. It returns an array in this format:

```ts
[
  {
    transactionId: "fabric-transaction-id",
    timestamp: "2026-09-09T00:00:00.000Z",
    isDelete: false,
    value: { "...": "listing state at that transaction" },
  },
];
```

```ts
await fabricClient.evaluateTransaction("GetListingHistory", listingId);
```
