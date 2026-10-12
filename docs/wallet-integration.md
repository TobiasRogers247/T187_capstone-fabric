# Fabric wallet integration (0.5.1)

The `energy-market` chaincode now contains the token wallet used to settle
whole-energy marketplace trades. Token amounts are positive whole integers,
separate from kWh values. No currency/AUD conversion exists; legacy
`balanceCents` is not wallet data and is not stored by the current chaincode.

## Contract operations

Submit operations:

| Operation              | Arguments after `ctx`                                                                                                                                     | Authorization                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `CreateWallet`         | `walletId`, `ownerUserId`, `ownerFabricEnrollmentId`, `ownerMspId`                                                                                        | backend service                                 |
| `IssueTokens`          | `walletId`, `amountTokens`, `reference`                                                                                                                   | backend service plus `energyMarket.issuer=true` |
| `HoldTokens`           | `walletId`, `amountTokens`, `transactionId`, `listingId`, `idempotencyKey`                                                                                | backend service                                 |
| `SettleEnergyPurchase` | `buyerWalletId`, `sellerWalletId`, `holdId`, `transactionId`, `listingId`, `energyAmountKWh`, `priceTokensPerKWh`, `totalTokens`, optional `buyerAssetId` | backend service                                 |

Evaluate operations:

| Operation             | Arguments after `ctx`                                    |
| --------------------- | -------------------------------------------------------- |
| `ReadWallet`          | `walletId`                                               |
| `ReadWalletByOwner`   | `ownerUserId`                                            |
| `ReadWalletBalance`   | `walletId`                                               |
| `ReadWalletHistory`   | `walletId`, `pageSize`, `bookmark`                       |
| `ReadWallets`         | `pageSize`, `bookmark` (backend-only projection rebuild) |
| `ReadSettlement`      | `transactionId`                                          |
| `ReadAllTransactions` | `pageSize`, `bookmark` (backend-only projection rebuild) |

`ReadWallets` is restricted to the authorised backend service identity. It is
not a public application endpoint.

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
tokenWalletLedger(walletId, zeroPaddedSequence)
tokenWalletOperation(operation, sha256(reference))
tokenWalletHold(holdId)
tokenWalletSettlement(transactionId)
energyListingReservation(listingId)
```

Ledger sequence is a per-wallet positive integer padded to 16 decimal digits in
the composite key. Fabric's deterministic key order therefore returns history
in increasing event order, including when timestamps are equal. `ReadWalletHistory`
arguments are `walletId, pageSize, bookmark`; page size is 1-100 and the returned
opaque bookmark must be passed unchanged to fetch the next page.
When Fabric omits pagination metadata, the contract returns an empty bookmark.
This keeps empty wallet histories readable and projection rebuilds safe before
the first wallet or transaction exists.

Hold IDs are `hold-` plus the SHA-256 digest of the marketplace transaction ID.
Settlement IDs are `settlement-` plus the same digest. Issue and hold operation
references are idempotency records. A retry with the same reference returns the
original result; reusing a reference with different terms is rejected.

`HoldTokens` also creates the single deterministic
`energyListingReservation(listingId)` in the same Fabric transaction as the
wallet hold. Competing holds for one listing write the same key, so Fabric MVCC
allows at most one to commit. `SettleEnergyPurchase` must match and consume that
reservation atomically with the wallet transfer and sold-listing update.
`CancelListing` rejects an active reservation. Since this test contract has no
`ReleaseHold`, a confirmed hold whose settlement cannot complete still needs
operator reconciliation; it cannot be refunded or reassigned automatically.

Wallet state contains:

```text
walletId
ownerUserId
ownerFabricEnrollmentId
ownerMspId
status: active | closed
availableBalanceTokens
heldBalanceTokens
lastLedgerSequence
lastFabricTransactionId
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
3. Seller accepts; only then hold the exact listing total with the marketplace
   transaction and listing IDs.
4. Immediately submit `SettleEnergyPurchase` with the same validated terms.
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
in this test-environment scope. Application flows must not create holds before
seller acceptance or treat a hold as a cancellable funded request. A definitive
settlement rejection after a confirmed hold still requires operator
reconciliation because no release operation exists.

## Application reads and projections

The authenticated app endpoints are:

| Endpoint                                        | Behavior                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /api/wallet`                               | Read or create the caller's Fabric wallet and refresh its Mongo projection.             |
| `GET /api/wallet/history?pageSize=50&bookmark=` | Return immutable Fabric history in increasing per-wallet sequence order.                |
| `POST /api/wallet/issue-tokens`                 | Issue exactly 100 development tokens with an `Idempotency-Key`; disabled in production. |

The wallet Mongo projection contains only `walletId`, `userId`, `status`,
`balanceTokens` (available/spendable tokens), `createdAt`, `updatedAt`,
`lastFabricTransactionId`, and `projectionUpdatedAt`. It does not store held or
total balance. The backend-only `ReadWallets` and `ReadAllTransactions` pages
support rebuilding wallet and completed-trade projections from Fabric. They do
not rebuild application profiles, certificate enrollment credentials, battery
records, or other app-owned data.

To rebuild the two projections after configuring the backend's Fabric and
MongoDB environment, run `npm run backend:db:rebuild:fabric-projections` from
the application repository root. The command reads all Fabric pages before
writing, refreshes the wallet and completed-transaction projections, and then
removes stale rows only from those two projection collections. It does not
modify Fabric, listings, users, batteries, or profiles. Fabric pagination is a
live view rather than a snapshot, so pause wallet issuance/settlement writes for
the duration of a rebuild. A failed Fabric read does not trigger stale-row
pruning.

## Deployment

The source package version is `0.5.1`. A read-only query on 12 October 2026
confirmed the VM definition is version `0.5.0`, sequence `1`. Version `0.5.1`
only fixes empty pagination responses, so deploy it as sequence `2` without
resetting or migrating the ledger. A newly initialized VM uses sequence `1`.
Set the VM's untracked `.env` to the package version and the correct sequence,
then run:

```bash
cd ~/code/T187_capstone-fabric
PATH="$HOME/hyperledger/fabric-samples/bin:$PATH" peer lifecycle chaincode querycommitted --channelID energychannel --name energy-market
# Set FABRIC_CHAINCODE_VERSION and FABRIC_CHAINCODE_SEQUENCE in the VM .env,
# then run the lifecycle deployment script.
bash network/scripts/deployChaincode.sh
```

The deployment script rejects any sequence other than the channel's exact
next sequence. See the [Fabric handover guide](fabric-handover.md) for the
full deployment and application integration status.

The Platform backend identity must be newly enrolled with both certificate
attributes:

```text
energyMarket.backend=true:ecert
energyMarket.issuer=true:ecert
```

The enrollment script registers those attributes for a fresh environment. An
already registered identity must be re-enrolled through the agreed reset or CA
credential rotation process before `IssueTokens` can succeed.
