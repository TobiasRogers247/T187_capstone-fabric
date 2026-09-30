# Fabric wallet integration (0.4.1)

The `energy-market` chaincode now contains the token wallet used to settle
whole-energy marketplace trades. Token amounts are positive whole integers and
are separate from kWh values and the legacy user `balanceCents` field.

## Contract operations

Submit operations:

| Operation | Arguments after `ctx` | Authorization |
| --- | --- | --- |
| `CreateWallet` | `walletId`, `ownerUserId`, `ownerFabricEnrollmentId`, `ownerMspId` | backend service |
| `IssueTokens` | `walletId`, `amountTokens`, `reference` | backend service plus `energyMarket.issuer=true` |
| `HoldTokens` | `walletId`, `amountTokens`, `transactionId`, `listingId`, `idempotencyKey` | backend service |
| `SettleEnergyPurchase` | `buyerWalletId`, `sellerWalletId`, `holdId`, `transactionId`, `listingId`, `energyAmountKWh`, `priceTokensPerKWh`, `totalTokens`, optional `buyerAssetId` | backend service |

Evaluate operations:

| Operation | Arguments after `ctx` |
| --- | --- |
| `ReadWallet` | `walletId` |
| `ReadWalletByOwner` | `ownerUserId` |
| `ReadWalletBalance` | `walletId` |
| `ReadWalletHistory` | `walletId`, `pageSize`, `bookmark`, optional `entryType` |
| `ReadSettlement` | `transactionId` |

`CompletePurchaseHandshake` is retained only as a rejected compatibility method.
It cannot complete a trade without token settlement.

`IssueTokens` is the controlled test-environment issuance method. The frontend
must call the backend, never Fabric directly. The backend derives the current
user and wallet, supplies a stable issuance reference, and returns the confirmed
Fabric result. A generic balance setter does not exist.

## State and key formats

The chaincode uses these deterministic composite keys:

```text
tokenWallet(walletId)
tokenWalletByOwner(ownerUserId)
tokenWalletLedger(walletId, entryType, entryId)
tokenWalletOperation(operation, sha256(reference))
tokenWalletHold(holdId)
tokenWalletSettlement(transactionId)
```

Hold IDs are `hold-` plus the SHA-256 digest of the marketplace transaction ID.
Settlement IDs are `settlement-` plus the same digest. Issue and hold operation
references are idempotency records. A retry with the same reference returns the
original result; reusing a reference with different terms is rejected.

Wallet state contains:

```text
walletId
ownerUserId
ownerFabricEnrollmentId
ownerMspId
status: active | closed
availableBalanceTokens
heldBalanceTokens
createdAt
updatedAt
```

Every value change writes an immutable wallet ledger entry. Entries record the
positive amount, source/destination wallets where relevant, marketplace IDs,
reference, acting identity and role, Fabric transaction ID, timestamp, and the
resulting available/held balances.

## Settlement flow

1. Create or load the buyer and seller wallets.
2. Issue test tokens to the buyer with a unique reference.
3. Hold the exact listing total with the marketplace transaction and listing IDs.
4. Submit `SettleEnergyPurchase` after seller acceptance.
5. Fabric verifies the active listing, hold, wallets, energy, price, and total.
6. Fabric consumes the hold, debits the buyer's held balance, credits the seller,
   writes both ledger entries, records the transaction and receipt, and marks the
   listing sold in one transaction.
7. The backend updates MongoDB only after the Fabric commit is confirmed.

If submission or commit status is unknown, the backend must call
`ReadSettlement(transactionId)` before retrying. It must reuse the same
transaction ID and hold ID, never create a replacement settlement ID, and never
apply a MongoDB balance change based only on a timeout.

Hold release/refund and wallet freeze operations are intentionally not included
in this test-environment scope. Until a release operation exists, application
flows should not create holds that can be cancelled without settlement.

## Deployment

The package version is `0.4.1`. A fresh channel uses sequence `1`. The existing
VM ledger currently has `energy-market` version `0.4.0`, sequence `2`, so its
upgrade must use version `0.4.1` and sequence `3`:

```bash
cd ~/code/T187_capstone-fabric
FABRIC_CHAINCODE_VERSION=0.4.1 FABRIC_CHAINCODE_SEQUENCE=3 \
  bash network/scripts/deployChaincode.sh
```

The Platform backend identity must be newly enrolled with both certificate
attributes:

```text
energyMarket.backend=true:ecert
energyMarket.issuer=true:ecert
```

The enrollment script registers those attributes for a fresh environment. An
already registered identity must be re-enrolled through the agreed reset or CA
credential rotation process before `IssueTokens` can succeed.
