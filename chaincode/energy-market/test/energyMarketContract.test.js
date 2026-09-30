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
    const keyPrefix = `\u0000${objectType}\u0000${attributes.join("\u0000")}\u0000`;
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

function createContext({ issuer = false } = {}) {
  return {
    stub: new MockStub(),
    clientIdentity: {
      getMSPID: () => "PlatformOrgMSP",
      getID: () => "x509::/CN=backend-service",
      assertAttributeValue: (name, value) =>
        value === "true" &&
        (name === "energyMarket.backend" ||
          (issuer && name === "energyMarket.issuer")),
    },
  };
}

async function createUserAndWallet(contract, ctx, userId, walletId) {
  await contract.CreateUser(ctx, userId, `enrollment-${userId}`, "0");
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
  assert.equal(sellerAfter.availableBalanceTokens, 38);
  assert.equal(transaction.listingId, "listing-001");
  assert.equal(transaction.sellerId, "seller-001");
  assert.equal(transaction.buyerId, "buyer-001");
  assert.equal(transaction.energyKWh, 1.5);
  assert.equal(transaction.priceTokensPerKWh, 25);
  assert.equal(transaction.totalTokens, 38);
  assert.equal(transaction.buyerAssetId, "buyer-battery-001");
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
  assert.deepEqual(issueRetry, issued);
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
  await assert.rejects(
    () =>
      contract.HoldTokens(
        issuerContext,
        wallet.walletId,
        "61",
        "purchase-002",
        "listing-001",
        "hold-002",
      ),
    /Insufficient available token balance/,
  );

  const firstPage = JSON.parse(
    await contract.ReadWalletHistory(
      issuerContext,
      wallet.walletId,
      "1",
      "",
      "",
    ),
  );
  const secondPage = JSON.parse(
    await contract.ReadWalletHistory(
      issuerContext,
      wallet.walletId,
      "1",
      firstPage.bookmark,
      "",
    ),
  );

  assert.equal(firstPage.entries.length, 1);
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
