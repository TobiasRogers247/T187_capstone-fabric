# Fabric transaction integration (0.4.1)

This document describes the application-facing boundary for the Fabric
`EnergyMarketContract`. The contract now owns token wallet value and the
token history used when an energy purchase settles. MongoDB may project the
results for application reads, but it must not be treated as the source of
wallet balances.

## Contract version and deployment baseline

The source version is `0.4.1`.

- A fresh channel deployment uses chaincode sequence `1`.
- The current VM channel runs `0.4.0` at sequence `2`; it must install the
  `0.4.1` package and approve/commit it as sequence `3`.
- The full deployment notes and current VM state are in
  [`docs/wallet-integration.md`](wallet-integration.md).

Do not commit generated packages, certificates, private keys, or runtime
artifacts.

## Contract transactions

All arguments are strings at the Fabric Gateway boundary. Numeric token
amounts are whole, positive, safe integers and are validated by chaincode.

| Transaction | Arguments | Purpose |
| --- | --- | --- |
| `CreateWallet` | `walletId, ownerUserId, ownerFabricEnrollmentId, ownerMspId` | Create the single wallet mapped to an application user. |
| `ReadWallet` | `walletId` | Read the wallet summary. |
| `ReadWalletByOwner` | `ownerUserId` | Read the mapped wallet. |
| `ReadWalletBalance` | `walletId` | Read available, held, and derived total tokens. |
| `ReadWalletHistory` | `walletId, pageSize, bookmark, entryType` | Read immutable wallet entries with deterministic pagination. |
| `IssueTokens` | `walletId, amountTokens, reference` | Test-environment issuance by the authorised issuer identity. |
| `HoldTokens` | `walletId, amountTokens, transactionId, listingId, idempotencyKey` | Move available tokens into an active hold before purchase acceptance. |
| `SettleEnergyPurchase` | `buyerWalletId, sellerWalletId, holdId, transactionId, listingId, energyAmountKWh, priceTokensPerKWh, totalTokens, buyerAssetId` | Consume the buyer hold, credit the seller, and complete the energy transaction atomically. |
| `ReadSettlement` | `transactionId` | Look up an existing settlement receipt before retrying an unknown request. |
| `ReadTransaction` | `transactionId, requestingUserId` | Read a completed energy transaction for its buyer or seller. |
| `ReadTransactionsForUser` | `requestingUserId, pageSize, bookmark` | Read completed transactions for a user. |
| `ReadListing` | `listingId` | Read one listing. |
| `ReadListings` | `status` | Read listings filtered by `active`, `cancelled`, `sold`, or `all`. |

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

The backend Fabric adapter should:

1. Create or read the user wallet through the contract.
2. Use `ReadWallet` or `ReadWalletByOwner` for the frontend wallet display.
3. Call `IssueTokens` for the test-only token button with a deterministic
   development reference.
4. Validate the listing, seller, kWh amount, price, and total before calling
   `HoldTokens`.
5. Treat a successful hold as the funded purchase state.
6. Call `SettleEnergyPurchase` only after the seller accepts and the terms are
   unchanged.
7. Project the returned wallet/settlement data to MongoDB only after Fabric
   confirms the transaction.

Never retry `IssueTokens`, `HoldTokens`, or `SettleEnergyPurchase` blindly.
The reference/idempotency keys make duplicate requests safe, but an unknown
submission result must first be checked with `ReadSettlement` (and the
relevant wallet/hold read) before another money-changing submission.

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
