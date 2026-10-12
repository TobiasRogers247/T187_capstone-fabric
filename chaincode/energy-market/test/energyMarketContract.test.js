const assert = require("node:assert/strict");
const test = require("node:test");

const { EnergyMarketContract } = require("../dist/energyMarketContract");

class MockIterator {
  constructor(entries) {
    this.entries = entries;
    this.position = 0;
  }

  async next() {
    if (this.position >= this.entries.length) {
      return { done: true };
    }

    const value = this.entries[this.position];
    this.position += 1;
    return { done: false, value };
  }

  async close() {}
}

class MockStub {
  constructor() {
    this.state = new Map();
    this.versions = new Map();
    this.history = new Map();
    this.transactionNumber = 0;
  }

  createCompositeKey(objectType, attributes) {
    return `\u0000${objectType}\u0000${attributes.join("\u0000")}\u0000`;
  }

  getTxTimestamp() {
    return {
      seconds: {
        toString: () => String(1_725_897_600 + this.transactionNumber),
      },
      nanos: 0,
    };
  }

  getTxID() {
    return `tx-${this.transactionNumber}`;
  }

  async getState(key) {
    return this.state.get(key) ?? Buffer.alloc(0);
  }

  async putState(key, value) {
    this.transactionNumber += 1;
    const stateValue = Buffer.from(value);
    this.state.set(key, stateValue);
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    const history = this.history.get(key) ?? [];

    history.push({
      txId: this.getTxID(),
      timestamp: this.getTxTimestamp(),
      isDelete: false,
      value: stateValue,
    });
    this.history.set(key, history);
  }

  async getHistoryForKey(key) {
    return new MockIterator(this.history.get(key) ?? []);
  }

  async getStateByPartialCompositeKey(objectType) {
    const keyPrefix = `\u0000${objectType}\u0000`;
    const entries = [...this.state.entries()]
      .filter(([key]) => key.startsWith(keyPrefix))
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, value]) => ({ key, value }));

    return new MockIterator(entries);
  }

  async getStateByPartialCompositeKeyWithPagination(
    objectType,
    attributes,
    pageSize,
    bookmark,
  ) {
    const attributePrefix = attributes.length
      ? `${attributes.join("\u0000")}\u0000`
      : "";
    const keyPrefix = `\u0000${objectType}\u0000${attributePrefix}`;
    const entries = [...this.state.entries()]
      .filter(([key]) => key.startsWith(keyPrefix))
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, value]) => ({ key, value }));
    const start = bookmark
      ? Math.max(entries.findIndex((entry) => entry.key === bookmark) + 1, 0)
      : 0;
    const page = entries.slice(start, start + pageSize);
    const hasMore = start + page.length < entries.length;

    return {
      iterator: new MockIterator(page),
      metadata: {
        bookmark: hasMore ? page[page.length - 1].key : "",
      },
    };
  }
}

class TransactionSimulationStub {
  constructor(parent, transactionId) {
    this.parent = parent;
    this.snapshot = new Map(
      [...parent.state].map(([key, value]) => [key, Buffer.from(value)]),
    );
    this.snapshotVersions = new Map(parent.versions);
    this.readVersions = new Map();
    this.writeSet = new Map();
    this.transactionId = transactionId;
  }

  createCompositeKey(objectType, attributes) {
    return this.parent.createCompositeKey(objectType, attributes);
  }

  getTxTimestamp() {
    return this.parent.getTxTimestamp();
  }

  getTxID() {
    return this.transactionId;
  }

  async getState(key) {
    if (!this.readVersions.has(key)) {
      this.readVersions.set(key, this.snapshotVersions.get(key) ?? 0);
    }

    const value = this.writeSet.get(key) ?? this.snapshot.get(key);
    return value ? Buffer.from(value) : Buffer.alloc(0);
  }

  async putState(key, value) {
    this.writeSet.set(key, Buffer.from(value));
  }

  async commit() {
    for (const [key, readVersion] of this.readVersions) {
      if ((this.parent.versions.get(key) ?? 0) !== readVersion) {
        throw new Error(`MVCC read conflict on ${key}`);
      }
    }

    for (const [key, value] of this.writeSet) {
      await this.parent.putState(key, value);
    }
  }
}

function createContext({ issuer = false, backend = true } = {}) {
  return {
    stub: new MockStub(),
    clientIdentity: {
      getMSPID: () => "PlatformOrgMSP",
      getID: () => "x509::/CN=backend-service",
      assertAttributeValue: (name, value) =>
        value === "true" &&
        ((backend && name === "energyMarket.backend") ||
          (issuer && name === "energyMarket.issuer")),
    },
  };
}

async function createUserAndWallet(contract, ctx, userId, walletId) {
  await contract.CreateUser(ctx, userId, `enrollment-${userId}`);
  return JSON.parse(
    await contract.CreateWallet(
      ctx,
      walletId,
      userId,
      `enrollment-${userId}`,
      "PlatformOrgMSP",
    ),
  );
}

async function createListing(contract, ctx, listingId = "listing-001") {
  return JSON.parse(
    await contract.CreateListing(
      ctx,
      listingId,
      "seller-001",
      "battery-001",
      "1.5",
      "25",
    ),
  );
}

test("CreateUser stores the Fabric identity mapping without legacy cents", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext();
  const user = JSON.parse(
    await contract.CreateUser(ctx, "user-001", "enrollment-user-001"),
  );

  assert.equal(user.userId, "user-001");
  assert.equal(user.fabricEnrollmentId, "enrollment-user-001");
  assert.equal(user.status, "ACTIVE");
  assert.equal(Object.hasOwn(user, "balanceCents"), false);
});

test("creates and reads an active whole-energy listing", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext();
  const created = await createListing(contract, ctx);
  const read = JSON.parse(await contract.ReadListing(ctx, "listing-001"));

  assert.deepEqual(read, created);
  assert.equal(created.userId, "seller-001");
  assert.equal(created.energyKWh, 1.5);
  assert.equal(created.priceTokensPerKWh, 25);
  assert.equal(created.status, "active");
  assert.equal(created.closedAt, null);
  assert.equal("remainingKwh" in created, false);
  assert.equal("updatedAt" in created, false);
});

test("returns listings filtered by Fabric status", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext();
  await createListing(contract, ctx, "listing-002");
  await createListing(contract, ctx, "listing-001");
  await contract.CancelListing(ctx, "listing-001", "seller-001");

  const listings = JSON.parse(await contract.ReadListings(ctx, "active"));
  const allListings = JSON.parse(await contract.ReadListings(ctx, "all"));

  assert.equal(listings.length, 1);
  assert.equal(listings[0].listingId, "listing-002");
  assert.equal(allListings.length, 2);
});

test("settles a listing and transfers held tokens exactly once", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext({ issuer: true });
  const sellerWallet = await createUserAndWallet(
    contract,
    ctx,
    "seller-001",
    "wallet-seller-001",
  );
  const buyerWallet = await createUserAndWallet(
    contract,
    ctx,
    "buyer-001",
    "wallet-buyer-001",
  );
  await contract.IssueTokens(
    ctx,
    buyerWallet.walletId,
    "100",
    "seed-buyer-001",
  );
  await createListing(contract, ctx);

  const held = JSON.parse(
    await contract.HoldTokens(
      ctx,
      buyerWallet.walletId,
      "38",
      "purchase-001",
      "listing-001",
      "hold-request-001",
    ),
  );
  const heldRetry = JSON.parse(
    await contract.HoldTokens(
      ctx,
      buyerWallet.walletId,
      "38",
      "purchase-001",
      "listing-001",
      "hold-request-001",
    ),
  );
  const result = JSON.parse(
    await contract.SettleEnergyPurchase(
      ctx,
      buyerWallet.walletId,
      sellerWallet.walletId,
      held.hold.holdId,
      "purchase-001",
      "listing-001",
      "1.5",
      "25",
      "38",
      "buyer-battery-001",
    ),
  );
  const retry = JSON.parse(
    await contract.SettleEnergyPurchase(
      ctx,
      buyerWallet.walletId,
      sellerWallet.walletId,
      held.hold.holdId,
      "purchase-001",
      "listing-001",
      "1.5",
      "25",
      "38",
      "buyer-battery-001",
    ),
  );
  const settlementRead = JSON.parse(
    await contract.ReadSettlement(ctx, "purchase-001"),
  );
  const buyerAfter = JSON.parse(
    await contract.ReadWallet(ctx, buyerWallet.walletId),
  );
  const sellerAfter = JSON.parse(
    await contract.ReadWallet(ctx, sellerWallet.walletId),
  );
  const transaction = JSON.parse(
    await contract.ReadTransaction(ctx, "purchase-001", "buyer-001"),
  );

  assert.equal(result.listing.status, "sold");
  assert.notEqual(result.listing.closedAt, null);
  assert.deepEqual(heldRetry, held);
  assert.deepEqual(retry, result);
  assert.deepEqual(settlementRead, result);
  await assert.rejects(
    () =>
      contract.SettleEnergyPurchase(
        ctx,
        buyerWallet.walletId,
        sellerWallet.walletId,
        held.hold.holdId,
        "purchase-001",
        "listing-001",
        "1.5",
        "25",
        "37",
        "buyer-battery-001",
      ),
    /Settlement reference is already used differently/,
  );
  assert.equal(buyerAfter.availableBalanceTokens, 62);
  assert.equal(buyerAfter.heldBalanceTokens, 0);
  assert.equal(buyerAfter.lastLedgerSequence, 3);
  assert.equal(buyerAfter.lastFabricTransactionId, result.fabricTransactionId);
  assert.equal(sellerAfter.availableBalanceTokens, 38);
  assert.equal(sellerAfter.lastLedgerSequence, 1);
  assert.equal(sellerAfter.lastFabricTransactionId, result.fabricTransactionId);
  assert.equal(transaction.listingId, "listing-001");
  assert.equal(transaction.sellerId, "seller-001");
  assert.equal(transaction.buyerId, "buyer-001");
  assert.equal(transaction.energyKWh, 1.5);
  assert.equal(transaction.priceTokensPerKWh, 25);
  assert.equal(transaction.totalTokens, 38);
  assert.equal(transaction.buyerAssetId, "buyer-battery-001");

  const buyerHistory = JSON.parse(
    await contract.ReadWalletHistory(ctx, buyerWallet.walletId, "10", ""),
  );
  assert.deepEqual(
    buyerHistory.entries.map(({ sequence, entryType }) => [
      sequence,
      entryType,
    ]),
    [
      [1, "issue"],
      [2, "hold"],
      [3, "settlementDebit"],
    ],
  );
  assert.deepEqual(
    buyerHistory.entries.map(({ timestamp }) => timestamp),
    [...buyerHistory.entries.map(({ timestamp }) => timestamp)].sort(),
  );
  assert.equal(buyerHistory.entries[1].transactionId, "purchase-001");
  assert.equal(buyerHistory.entries[2].settlementId, result.settlementId);
});

test("a listing can have only one active token hold", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext({ issuer: true });
  const sellerWallet = await createUserAndWallet(
    contract,
    ctx,
    "seller-001",
    "wallet-seller-001",
  );
  const firstBuyerWallet = await createUserAndWallet(
    contract,
    ctx,
    "buyer-001",
    "wallet-buyer-001",
  );
  const secondBuyerWallet = await createUserAndWallet(
    contract,
    ctx,
    "buyer-002",
    "wallet-buyer-002",
  );
  await contract.IssueTokens(ctx, firstBuyerWallet.walletId, "38", "issue-1");
  await contract.IssueTokens(ctx, secondBuyerWallet.walletId, "38", "issue-2");
  await createListing(contract, ctx);

  const firstHold = JSON.parse(
    await contract.HoldTokens(
      ctx,
      firstBuyerWallet.walletId,
      "38",
      "purchase-1",
      "listing-001",
      "hold-1",
    ),
  );

  await assert.rejects(
    () =>
      contract.HoldTokens(
        ctx,
        secondBuyerWallet.walletId,
        "38",
        "purchase-2",
        "listing-001",
        "hold-2",
      ),
    /already has an active token hold/,
  );
  await assert.rejects(
    () => contract.CancelListing(ctx, "listing-001", "seller-001"),
    /active token hold/,
  );

  const secondBuyerAfterRejectedHold = JSON.parse(
    await contract.ReadWallet(ctx, secondBuyerWallet.walletId),
  );
  assert.equal(secondBuyerAfterRejectedHold.availableBalanceTokens, 38);
  assert.equal(secondBuyerAfterRejectedHold.heldBalanceTokens, 0);

  const reservationKey = ctx.stub.createCompositeKey(
    "energyListingReservation",
    ["listing-001"],
  );
  const activeReservation = JSON.parse(
    (await ctx.stub.getState(reservationKey)).toString(),
  );
  assert.equal(activeReservation.holdId, firstHold.hold.holdId);
  assert.equal(activeReservation.buyerWalletId, firstBuyerWallet.walletId);
  assert.equal(activeReservation.status, "active");
  assert.deepEqual(JSON.parse(await contract.ReadListings(ctx, "active")), []);

  await contract.SettleEnergyPurchase(
    ctx,
    firstBuyerWallet.walletId,
    sellerWallet.walletId,
    firstHold.hold.holdId,
    "purchase-1",
    "listing-001",
    "1.5",
    "25",
    "38",
  );

  const consumedReservation = JSON.parse(
    (await ctx.stub.getState(reservationKey)).toString(),
  );
  assert.equal(consumedReservation.status, "consumed");
  assert.equal(consumedReservation.transactionId, "purchase-1");
});

test("Fabric MVCC permits only one competing listing reservation to commit", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext({ issuer: true });
  const firstBuyerWallet = await createUserAndWallet(
    contract,
    ctx,
    "buyer-001",
    "wallet-buyer-001",
  );
  const secondBuyerWallet = await createUserAndWallet(
    contract,
    ctx,
    "buyer-002",
    "wallet-buyer-002",
  );
  await contract.IssueTokens(ctx, firstBuyerWallet.walletId, "38", "issue-1");
  await contract.IssueTokens(ctx, secondBuyerWallet.walletId, "38", "issue-2");
  await createListing(contract, ctx);

  const firstContext = {
    ...ctx,
    stub: new TransactionSimulationStub(ctx.stub, "simulated-hold-1"),
  };
  const secondContext = {
    ...ctx,
    stub: new TransactionSimulationStub(ctx.stub, "simulated-hold-2"),
  };
  const [firstReceipt, secondReceipt] = await Promise.all([
    contract.HoldTokens(
      firstContext,
      firstBuyerWallet.walletId,
      "38",
      "purchase-1",
      "listing-001",
      "hold-1",
    ),
    contract.HoldTokens(
      secondContext,
      secondBuyerWallet.walletId,
      "38",
      "purchase-2",
      "listing-001",
      "hold-2",
    ),
  ]);

  assert.ok(firstReceipt);
  assert.ok(secondReceipt);
  await firstContext.stub.commit();
  await assert.rejects(
    () => secondContext.stub.commit(),
    /MVCC read conflict on .*energyListingReservation/u,
  );

  const firstBuyerAfterCommit = JSON.parse(
    await contract.ReadWallet(ctx, firstBuyerWallet.walletId),
  );
  const secondBuyerAfterConflict = JSON.parse(
    await contract.ReadWallet(ctx, secondBuyerWallet.walletId),
  );
  assert.equal(firstBuyerAfterCommit.heldBalanceTokens, 38);
  assert.equal(secondBuyerAfterConflict.availableBalanceTokens, 38);
  assert.equal(secondBuyerAfterConflict.heldBalanceTokens, 0);
});

test("creates one wallet per registered user and makes issuance idempotent", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext({ issuer: true });
  const wallet = await createUserAndWallet(
    contract,
    ctx,
    "buyer-001",
    "wallet-buyer-001",
  );

  const retry = JSON.parse(
    await contract.CreateWallet(
      ctx,
      wallet.walletId,
      "buyer-001",
      "enrollment-buyer-001",
      "PlatformOrgMSP",
    ),
  );
  const issued = JSON.parse(
    await contract.IssueTokens(ctx, wallet.walletId, "100", "issue-001"),
  );
  const issueRetry = JSON.parse(
    await contract.IssueTokens(ctx, wallet.walletId, "100", "issue-001"),
  );

  assert.deepEqual(retry, wallet);
  assert.equal(issued.wallet.availableBalanceTokens, 100);
  assert.match(issued.fabricTransactionId, /^tx-/u);
  assert.deepEqual(issueRetry, issued);
  assert.equal(issued.wallet.lastLedgerSequence, 1);
  assert.deepEqual(
    JSON.parse(await contract.ReadWalletByOwner(ctx, "buyer-001")),
    issued.wallet,
  );
  await assert.rejects(
    () =>
      contract.CreateWallet(
        ctx,
        "wallet-buyer-002",
        "buyer-001",
        "enrollment-buyer-001",
        "PlatformOrgMSP",
      ),
    /already owns wallet/,
  );

  await assert.rejects(
    () =>
      contract.CreateWallet(
        ctx,
        "wallet-buyer-003",
        "buyer-001",
        "different-enrollment",
        "PlatformOrgMSP",
      ),
    /does not match the registered Fabric enrollment/,
  );
});

test("requires the issuer attribute, validates amounts, and paginates wallet history", async () => {
  const contract = new EnergyMarketContract();
  const issuerContext = createContext({ issuer: true });
  const wallet = await createUserAndWallet(
    contract,
    issuerContext,
    "buyer-001",
    "wallet-buyer-001",
  );
  const regularContext = createContext();
  regularContext.stub = issuerContext.stub;

  await assert.rejects(
    () =>
      contract.IssueTokens(
        regularContext,
        wallet.walletId,
        "100",
        "issue-unauthorised",
      ),
    /authorised token issuer/,
  );
  await assert.rejects(
    () => contract.IssueTokens(issuerContext, wallet.walletId, "0", "issue-0"),
    /amountTokens must be greater than zero/,
  );
  await assert.rejects(
    () =>
      contract.IssueTokens(
        issuerContext,
        wallet.walletId,
        "9007199254740992",
        "issue-overflow",
      ),
    /safe integer range/,
  );
  await contract.IssueTokens(
    issuerContext,
    wallet.walletId,
    "100",
    "issue-001",
  );
  await createListing(contract, issuerContext);
  await contract.HoldTokens(
    issuerContext,
    wallet.walletId,
    "40",
    "purchase-001",
    "listing-001",
    "hold-001",
  );
  await createListing(contract, issuerContext, "listing-002");
  await assert.rejects(
    () =>
      contract.HoldTokens(
        issuerContext,
        wallet.walletId,
        "61",
        "purchase-002",
        "listing-002",
        "hold-002",
      ),
    /Insufficient available token balance/,
  );

  const firstPage = JSON.parse(
    await contract.ReadWalletHistory(issuerContext, wallet.walletId, "1", ""),
  );
  const secondPage = JSON.parse(
    await contract.ReadWalletHistory(
      issuerContext,
      wallet.walletId,
      "1",
      firstPage.bookmark,
    ),
  );

  assert.equal(firstPage.entries.length, 1);
  assert.equal(firstPage.entries[0].sequence, 1);
  assert.equal(firstPage.entries[0].entryType, "issue");
  assert.equal(secondPage.entries[0].sequence, 2);
  assert.equal(secondPage.entries[0].entryType, "hold");
  assert.equal(secondPage.entries.length, 1);
  assert.equal(secondPage.bookmark, "");
  const balance = JSON.parse(
    await contract.ReadWalletBalance(issuerContext, wallet.walletId),
  );
  assert.equal(balance.walletId, wallet.walletId);
  assert.equal(balance.ownerUserId, "buyer-001");
  assert.equal(balance.status, "active");
  assert.equal(balance.availableBalanceTokens, 60);
  assert.equal(balance.heldBalanceTokens, 40);
  assert.equal(balance.totalBalanceTokens, 100);
});

test("paginates every wallet and completed transaction for projection rebuilds", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext({ issuer: true });
  const seller = await createUserAndWallet(
    contract,
    ctx,
    "seller-001",
    "wallet-seller-001",
  );
  const buyer = await createUserAndWallet(
    contract,
    ctx,
    "buyer-001",
    "wallet-buyer-001",
  );
  await contract.IssueTokens(ctx, buyer.walletId, "38", "issue-rebuild");
  await createListing(contract, ctx);
  const hold = JSON.parse(
    await contract.HoldTokens(
      ctx,
      buyer.walletId,
      "38",
      "purchase-rebuild",
      "listing-001",
      "hold-rebuild",
    ),
  );
  await contract.SettleEnergyPurchase(
    ctx,
    buyer.walletId,
    seller.walletId,
    hold.hold.holdId,
    "purchase-rebuild",
    "listing-001",
    "1.5",
    "25",
    "38",
    "buyer-battery-001",
  );

  const firstWalletPage = JSON.parse(await contract.ReadWallets(ctx, "1", ""));
  const secondWalletPage = JSON.parse(
    await contract.ReadWallets(ctx, "1", firstWalletPage.bookmark),
  );
  const transactionPage = JSON.parse(
    await contract.ReadAllTransactions(ctx, "1", ""),
  );

  assert.equal(firstWalletPage.wallets.length, 1);
  assert.equal(secondWalletPage.wallets.length, 1);
  assert.equal(secondWalletPage.bookmark, "");
  assert.deepEqual(
    [
      firstWalletPage.wallets[0].walletId,
      secondWalletPage.wallets[0].walletId,
    ].sort(),
    [buyer.walletId, seller.walletId].sort(),
  );
  assert.equal(transactionPage.transactions.length, 1);
  assert.equal(
    transactionPage.transactions[0].transactionId,
    "purchase-rebuild",
  );
  assert.equal(transactionPage.bookmark, "");
});

test("restricts projection rebuild reads to the authorised backend identity", async () => {
  const contract = new EnergyMarketContract();
  const nonBackendContext = createContext({ backend: false });

  await assert.rejects(
    () => contract.ReadWallets(nonBackendContext, "10", ""),
    /authorised backend service/u,
  );
  await assert.rejects(
    () => contract.ReadAllTransactions(nonBackendContext, "10", ""),
    /authorised backend service/u,
  );
});

test("rejects value-changing operations for a closed wallet", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext({ issuer: true });
  const wallet = await createUserAndWallet(
    contract,
    ctx,
    "buyer-001",
    "wallet-buyer-001",
  );
  const walletKey = ctx.stub.createCompositeKey("tokenWallet", [
    wallet.walletId,
  ]);
  const closedWallet = {
    ...wallet,
    status: "closed",
  };
  await ctx.stub.putState(walletKey, Buffer.from(JSON.stringify(closedWallet)));
  await createListing(contract, ctx);

  await assert.rejects(
    () => contract.IssueTokens(ctx, wallet.walletId, "10", "closed-issue"),
    /Wallet wallet-buyer-001 is closed/,
  );
  await assert.rejects(
    () =>
      contract.HoldTokens(
        ctx,
        wallet.walletId,
        "10",
        "purchase-001",
        "listing-001",
        "closed-hold",
      ),
    /Wallet wallet-buyer-001 is closed/,
  );
});

test("cancels active listings for their seller", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext();
  await createListing(contract, ctx);

  await assert.rejects(
    () => contract.CancelListing(ctx, "listing-001", "seller-002"),
    /does not own listing/,
  );

  const cancelled = JSON.parse(
    await contract.CancelListing(ctx, "listing-001", "seller-001"),
  );

  assert.equal(cancelled.status, "cancelled");
  assert.notEqual(cancelled.closedAt, null);
});

test("rejects invalid listing arguments and invalid state transitions", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext();

  await assert.rejects(
    () =>
      contract.CreateListing(ctx, "", "seller-001", "battery-001", "1", "25"),
    /listingId is required/,
  );
  await assert.rejects(
    () =>
      contract.CreateListing(
        ctx,
        "listing-001",
        "seller-001",
        "battery-001",
        "0",
        "25",
      ),
    /energyKWh must be a finite value greater than zero/,
  );
  await assert.rejects(
    () =>
      contract.CreateListing(
        ctx,
        "listing-001",
        "seller-001",
        "battery-001",
        "1",
        "1.5",
      ),
    /priceTokensPerKWh must be a non-negative integer string/,
  );

  await createListing(contract, ctx);
  await contract.CancelListing(ctx, "listing-001", "seller-001");
  await assert.rejects(
    () =>
      contract.CompletePurchaseHandshake(
        ctx,
        "purchase-001",
        "listing-001",
        "buyer-001",
        "buyer-battery-001",
      ),
    /retired; use SettleEnergyPurchase/,
  );
  await assert.rejects(
    () => contract.ReadListings(ctx, "pending"),
    /status must be active, cancelled, sold, or all/,
  );
});

test("returns listing history for lifecycle transitions", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext();
  await createListing(contract, ctx);
  await contract.CancelListing(ctx, "listing-001", "seller-001");

  const history = JSON.parse(
    await contract.GetListingHistory(ctx, "listing-001"),
  );

  assert.equal(history.length, 2);
  assert.equal(history[0].value.status, "active");
  assert.equal(history[1].value.status, "cancelled");
});
