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
}

function createContext() {
  return { stub: new MockStub() };
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

test("returns only active listings", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext();
  await createListing(contract, ctx, "listing-002");
  await createListing(contract, ctx, "listing-001");
  await contract.BeginPurchaseHandshake(ctx, "listing-001");

  const listings = JSON.parse(await contract.GetActiveListings(ctx));

  assert.equal(listings.length, 1);
  assert.equal(listings[0].listingId, "listing-002");
});

test("withdraws a pending handshake back to active", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext();
  await createListing(contract, ctx);

  const pending = JSON.parse(
    await contract.BeginPurchaseHandshake(ctx, "listing-001"),
  );
  const active = JSON.parse(
    await contract.WithdrawPurchaseHandshake(ctx, "listing-001"),
  );

  assert.equal(pending.status, "pending");
  assert.equal(active.status, "active");
  assert.equal(active.closedAt, null);
});

test("settles a pending handshake atomically", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext();
  await createListing(contract, ctx);
  await contract.BeginPurchaseHandshake(ctx, "listing-001");

  const result = JSON.parse(
    await contract.CompletePurchaseHandshake(ctx, "listing-001", "buyer-001"),
  );
  const transaction = JSON.parse(
    await contract.ReadTransaction(ctx, result.transaction.transactionId),
  );

  assert.equal(result.listing.status, "sold");
  assert.notEqual(result.listing.closedAt, null);
  assert.equal(transaction.listingId, "listing-001");
  assert.equal(transaction.sellerId, "seller-001");
  assert.equal(transaction.buyerId, "buyer-001");
  assert.equal(transaction.energyKWh, 1.5);
  assert.equal(transaction.priceTokensPerKWh, 25);
});

test("cancels active or pending listings for their seller", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext();
  await createListing(contract, ctx);
  await contract.BeginPurchaseHandshake(ctx, "listing-001");

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
  await assert.rejects(
    () => contract.CompletePurchaseHandshake(ctx, "listing-001", "buyer-001"),
    /must be pending; it is active/,
  );
});

test("returns listing history for lifecycle transitions", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext();
  await createListing(contract, ctx);
  await contract.BeginPurchaseHandshake(ctx, "listing-001");
  await contract.WithdrawPurchaseHandshake(ctx, "listing-001");

  const history = JSON.parse(
    await contract.GetListingHistory(ctx, "listing-001"),
  );

  assert.equal(history.length, 3);
  assert.equal(history[0].value.status, "active");
  assert.equal(history[1].value.status, "pending");
  assert.equal(history[2].value.status, "active");
});
