# Fabric transaction integration (0.5.1)

This document describes the application-facing boundary for the Fabric
`EnergyMarketContract`. The contract now owns token wallet value and the
token history used when an energy purchase settles. MongoDB may project the
results for application reads, but it must not be treated as the source of
wallet balances.

## Contract version and deployment baseline

The source version is `0.5.1`.

- Version `0.5.0` introduced the current user mapping and wallet-history state
  formats. Version `0.5.1` only handles empty pagination responses and keeps
  those formats unchanged.
- A read-only VM query on 12 October 2026 confirmed version `0.5.0`, sequence
  `1`. Deploy version `0.5.1` as sequence `2`. A newly initialized channel
  starts at sequence `1`.
- See the [Fabric handover guide](fabric-handover.md) and
  [wallet integration](wallet-integration.md) for deployment and runtime notes.

Do not commit generated packages, certificates, private keys, or runtime
artifacts.

## Contract transactions

All arguments are strings at the Fabric Gateway boundary. Numeric token
amounts are whole, positive, safe integers and are validated by chaincode.

| Transaction               | Arguments                                                                                                                        | Purpose                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `CreateWallet`            | `walletId, ownerUserId, ownerFabricEnrollmentId, ownerMspId`                                                                     | Create the single wallet mapped to an application user.                                                                  |
| `ReadWallet`              | `walletId`                                                                                                                       | Read the wallet summary.                                                                                                 |
| `ReadWalletByOwner`       | `ownerUserId`                                                                                                                    | Read the mapped wallet.                                                                                                  |
| `ReadWalletBalance`       | `walletId`                                                                                                                       | Read available, held, and derived total tokens.                                                                          |
| `ReadWalletHistory`       | `walletId, pageSize, bookmark`                                                                                                   | Read immutable wallet entries in ascending per-wallet sequence order.                                                    |
| `ReadWallets`             | `pageSize, bookmark`                                                                                                             | Backend-only paginated wallet source for rebuilding the Mongo projection.                                                |
| `IssueTokens`             | `walletId, amountTokens, reference`                                                                                              | Test-environment issuance by the authorised issuer identity.                                                             |
| `HoldTokens`              | `walletId, amountTokens, transactionId, listingId, idempotencyKey`                                                               | After seller acceptance, move available tokens into a hold and atomically claim the listing before immediate settlement. |
| `SettleEnergyPurchase`    | `buyerWalletId, sellerWalletId, holdId, transactionId, listingId, energyAmountKWh, priceTokensPerKWh, totalTokens, buyerAssetId` | Consume the buyer hold, credit the seller, and complete the energy transaction atomically.                               |
| `ReadSettlement`          | `transactionId`                                                                                                                  | Look up an existing settlement receipt before retrying an unknown request.                                               |
| `ReadTransaction`         | `transactionId, requestingUserId`                                                                                                | Read a completed energy transaction for its buyer or seller.                                                             |
| `ReadTransactionsForUser` | `requestingUserId, pageSize, bookmark`                                                                                           | Read completed transactions for a user.                                                                                  |
| `ReadAllTransactions`     | `pageSize, bookmark`                                                                                                             | Backend-only paginated completed-trade source for rebuilding the Mongo projection.                                       |
| `ReadListing`             | `listingId`                                                                                                                      | Read one listing.                                                                                                        |
| `ReadListings`            | `status`                                                                                                                         | Read listings filtered by `active`, `cancelled`, `sold`, or `all`.                                                       |

`CompletePurchaseHandshake` remains only as a compatibility-shaped transaction
name and is deliberately rejected. Application code must use
`SettleEnergyPurchase`, so a listing cannot be marked sold without the token
transfer.

The current testing scope intentionally has no public release/refund endpoint
and no freeze/unfreeze endpoint. Wallet status is limited to `active` and
`closed`.

## Authorization

The backend Fabric enrollment is the controlled invoker for application
wallet operations. The chaincode requires the invoker to have
`energyMarket.backend=true`.

`IssueTokens` additionally requires `energyMarket.issuer=true`. This is the
temporary testing path used by the token buttons; it is not a money purchase
flow and must not be exposed as arbitrary client-controlled issuance in
production.

The backend must map its authenticated application user to the registered
Fabric enrollment and must not accept arbitrary wallet owners, seller IDs,
buyer IDs, or balances from the browser.

## Application adapter behavior

The intended backend Fabric adapter behavior is:

1. Create or read the user wallet through the contract.
2. Use `ReadWallet` or `ReadWalletByOwner` for the frontend wallet display.
3. Call `IssueTokens` for the test-only token button with a deterministic
   development reference.
4. After seller acceptance, validate the listing, seller, kWh amount, price,
   and total; then call `HoldTokens` and immediately call
   `SettleEnergyPurchase` with the same validated terms.
5. Project the returned wallet/settlement data to MongoDB only after Fabric
   confirms the transaction.

Never retry `IssueTokens`, `HoldTokens`, or `SettleEnergyPurchase` blindly.
The reference/idempotency keys make duplicate requests safe, but an unknown
submission result must first be checked with `ReadSettlement` (and the
relevant wallet/hold read) before another money-changing submission.

`HoldTokens` creates one deterministic reservation per listing in the same
transaction as the hold. Competing holds for that listing contend on the same
Fabric key; only one can commit. Settlement consumes that reservation
atomically. With no `ReleaseHold` operation, do not run parallel purchases for
the same listing or treat a confirmed hold as cancellable.

**Current application wiring:** wallet reads and test issuance, plus listing
create/read/cancel, are integrated. Authenticated wallet history is exposed at
`GET /api/wallet/history`. The backend projection rebuild adapter uses
`ReadWallets` and `ReadAllTransactions`. The app does not currently call
`HoldTokens`, `SettleEnergyPurchase`, or `ReadSettlement`; purchase settlement
remains a contract capability and future integration task.

MongoDB wallet and completed-transaction projections can be repopulated from
the backend-only paginated Fabric reads. This does not rebuild application user
profiles, CA credentials, batteries, or other app-owned records. Run
`npm run backend:db:rebuild:fabric-projections` from the app repository root;
after all Fabric pages and projection writes succeed, it prunes stale rows only
from the wallet and transaction projection collections. Pause wallet writes
during the operation because Fabric pagination is a live view. This is not a
ledger or application-data migration.

## Response and failure contract

The adapter should parse Fabric JSON responses and preserve these outcomes:

- A deterministic chaincode validation error is a definitive failure; return
  it to the application without retrying the value-changing operation.
- A gateway timeout, lost connection, or ambiguous submit response is an
  unknown outcome; do not assume that no transaction committed.
- For settlement, call `ReadSettlement(transactionId)`. If a receipt exists,
  treat that receipt as authoritative and project the completed state. If it
  does not exist, the adapter may retry with the same deterministic terms and
  idempotency data according to the application retry policy.

The settlement receipt includes the Fabric transaction ID, settlement ID,
buyer and seller wallets, hold ID, marketplace transaction/listing IDs,
energy amount, price, and total tokens.

## Verification

From `chaincode/energy-market`:

```bash
npm test
npm run build
```

The test suite covers wallet creation, owner and issuer authorization,
idempotent issuance and holds, insufficient funds, settlement retries, exact
buyer debit/seller credit behavior, and immutable-history pagination.
