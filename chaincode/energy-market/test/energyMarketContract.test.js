const assert = require("node:assert/strict");
const test = require("node:test");

const { EnergyMarketContract } = require("../dist/energyMarketContract");

class MockHistoryIterator {
  constructor(entries) {
    this.entries = entries;
    this.position = 0;
    this.closed = false;
  }

  async next() {
    if (this.position >= this.entries.length) {
      return { done: true };
    }

    const value = this.entries[this.position];
    this.position += 1;
    return { done: false, value };
  }

  async close() {
    this.closed = true;
  }

  async *[Symbol.asyncIterator]() {
    while (this.position < this.entries.length) {
      const value = this.entries[this.position];
      this.position += 1;
      yield value;
    }
  }
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
    return new MockHistoryIterator(this.history.get(key) ?? []);
  }

  async getStateByPartialCompositeKey(objectType) {
    const keyPrefix = `\u0000${objectType}\u0000`;
    const entries = [...this.state.entries()]
      .filter(([key]) => key.startsWith(keyPrefix))
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, value]) => ({ key, value }));

    return new MockHistoryIterator(entries);
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
      "ENERGY",
    ),
  );
}

test("creates and reads an active listing", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext();

  const created = await createListing(contract, ctx);
  const read = JSON.parse(await contract.ReadListing(ctx, "listing-001"));

  assert.deepEqual(read, created);
  assert.equal(created.remainingKwh, 1.5);
  assert.equal(created.pricePerKwhTokenUnits, 25);
  assert.equal(created.tokenSymbol, "ENERGY");
  assert.equal(created.status, "active");
});

test("rejects duplicate listing IDs", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext();
  await createListing(contract, ctx);

  await assert.rejects(
    () => createListing(contract, ctx),
    /Listing listing-001 already exists/,
  );
});

test("returns only listings that are active and have available energy", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext();
  await createListing(contract, ctx, "listing-002");
  await createListing(contract, ctx, "listing-001");
  await contract.CancelListing(ctx, "listing-001", "seller-001");

  const zeroBalanceKey = ctx.stub.createCompositeKey("energyListing", [
    "listing-003",
  ]);
  ctx.stub.state.set(
    zeroBalanceKey,
    Buffer.from(
      JSON.stringify({
        listingId: "listing-003",
        status: "active",
        remainingKwh: 0,
      }),
    ),
  );

  const listings = JSON.parse(await contract.GetActiveListings(ctx));

  assert.equal(listings.length, 1);
  assert.equal(listings[0].listingId, "listing-002");
  assert.equal(listings[0].status, "active");
  assert.equal(listings[0].remainingKwh, 1.5);
});

test("rejects invalid listing arguments", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext();

  await assert.rejects(
    () =>
      contract.CreateListing(
        ctx,
        "",
        "seller-001",
        "battery-001",
        "1",
        "25",
        "ENERGY",
      ),
    /listingId is required/,
  );
  await assert.rejects(
    () =>
      contract.CreateListing(
        ctx,
        "listing-002",
        "seller-001",
        "battery-001",
        "0",
        "25",
        "ENERGY",
      ),
    /quantityKwh must be a finite value greater than zero/,
  );
  await assert.rejects(
    () =>
      contract.CreateListing(
        ctx,
        "listing-003",
        "seller-001",
        "battery-001",
        "1",
        "1.5",
        "ENERGY",
      ),
    /pricePerKwhTokenUnits must be a non-negative integer string/,
  );
  await assert.rejects(
    () =>
      contract.CreateListing(
        ctx,
        "listing-004",
        "seller-001",
        "battery-001",
        "1",
        "25",
        "AUD",
      ),
    /tokenSymbol must be ENERGY/,
  );
});

test("cancels an active listing only for its owner", async () => {
  const contract = new EnergyMarketContract();
  const ctx = createContext();
  const created = await createListing(contract, ctx);

  await assert.rejects(
    () => contract.CancelListing(ctx, "listing-001", "seller-002"),
    /does not own listing/,
  );

  const cancelled = JSON.parse(
    await contract.CancelListing(ctx, "listing-001", "seller-001"),
  );

  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.quantityKwh, created.quantityKwh);
  assert.equal(cancelled.remainingKwh, created.remainingKwh);
  assert.notEqual(cancelled.cancelledAt, null);

  await assert.rejects(
    () => contract.CancelListing(ctx, "listing-001", "seller-001"),
    /cannot be cancelled because it is cancelled/,
  );
  await assert.rejects(
    () => contract.CancelListing(ctx, "missing-listing", "seller-001"),
    /Listing missing-listing does not exist/,
  );
});

test("returns listing history after creation and cancellation", async () => {
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
  assert.equal(history[0].isDelete, false);
  assert.equal(history[1].transactionId, "tx-2");
});
