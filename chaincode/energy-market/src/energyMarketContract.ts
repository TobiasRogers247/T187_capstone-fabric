import {
  Context,
  Contract,
  Info,
  Returns,
  Transaction,
} from "fabric-contract-api";

type UserStatus = "ACTIVE" | "INACTIVE";
type ListingStatus = "active" | "cancelled" | "sold" | "expired";

interface EnergyListing {
  docType: "energyListing";
  listingId: string;
  sellerId: string;
  assetId: string;
  quantityKwh: number;
  remainingKwh: number;
  pricePerKwhTokenUnits: number;
  tokenSymbol: "ENERGY";
  status: ListingStatus;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

interface ListingHistoryEntry {
  transactionId: string;
  timestamp: string;
  isDelete: boolean;
  value: EnergyListing | null;
}

interface UserAccount {
  docType: "userAccount";
  userId: string;
  fabricEnrollmentId: string;
  balanceCents: number;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
}

@Info({
  title: "energy-market",
  description: "Minimal user lifecycle contract for the T187 capstone",
})
export class EnergyMarketContract extends Contract {
  @Transaction()
  @Returns("string")
  public async CreateUser(
    ctx: Context,
    userId: string,
    fabricEnrollmentId: string,
    initialBalanceCents: string,
  ): Promise<string> {
    this.requireNonEmpty("userId", userId);
    this.requireNonEmpty("fabricEnrollmentId", fabricEnrollmentId);

    const balanceCents = this.parseNonNegativeInteger(
      "initialBalanceCents",
      initialBalanceCents,
    );
    const userKey = this.getUserKey(ctx, userId);
    const existingState = await ctx.stub.getState(userKey);

    if (existingState.length > 0) {
      throw new Error(`User ${userId} already exists`);
    }

    const timestamp = this.getTimestampIso(ctx);
    const user: UserAccount = {
      docType: "userAccount",
      userId,
      fabricEnrollmentId,
      balanceCents,
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
      deactivatedAt: null,
    };

    await ctx.stub.putState(userKey, Buffer.from(JSON.stringify(user)));

    return JSON.stringify(user);
  }

  @Transaction()
  @Returns("string")
  public async DeactivateUser(ctx: Context, userId: string): Promise<string> {
    this.requireNonEmpty("userId", userId);

    const userKey = this.getUserKey(ctx, userId);
    const user = await this.readUser(ctx, userKey, userId);

    if (user.status === "INACTIVE") {
      return JSON.stringify(user);
    }

    const timestamp = this.getTimestampIso(ctx);
    const updatedUser: UserAccount = {
      ...user,
      status: "INACTIVE",
      updatedAt: timestamp,
      deactivatedAt: timestamp,
    };

    await ctx.stub.putState(userKey, Buffer.from(JSON.stringify(updatedUser)));

    return JSON.stringify(updatedUser);
  }

  @Transaction()
  @Returns("string")
  public async CreateListing(
    ctx: Context,
    listingId: string,
    sellerId: string,
    assetId: string,
    quantityKwh: string,
    pricePerKwhTokenUnits: string,
    tokenSymbol: string,
  ): Promise<string> {
    this.requireNonEmpty("listingId", listingId);
    this.requireNonEmpty("sellerId", sellerId);
    this.requireNonEmpty("assetId", assetId);

    const parsedQuantityKwh = this.parsePositiveQuantity(
      "quantityKwh",
      quantityKwh,
    );
    const parsedPricePerKwhTokenUnits = this.parsePositiveInteger(
      "pricePerKwhTokenUnits",
      pricePerKwhTokenUnits,
    );

    if (tokenSymbol !== "ENERGY") {
      throw new Error("tokenSymbol must be ENERGY");
    }

    const listingKey = this.getListingKey(ctx, listingId);
    const existingState = await ctx.stub.getState(listingKey);

    if (existingState.length > 0) {
      throw new Error(`Listing ${listingId} already exists`);
    }

    const timestamp = this.getTimestampIso(ctx);
    const listing: EnergyListing = {
      docType: "energyListing",
      listingId,
      sellerId,
      assetId,
      quantityKwh: parsedQuantityKwh,
      remainingKwh: parsedQuantityKwh,
      pricePerKwhTokenUnits: parsedPricePerKwhTokenUnits,
      tokenSymbol: "ENERGY",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      cancelledAt: null,
    };

    await ctx.stub.putState(listingKey, Buffer.from(JSON.stringify(listing)));

    return JSON.stringify(listing);
  }

  @Transaction(false)
  @Returns("string")
  public async ReadListing(ctx: Context, listingId: string): Promise<string> {
    this.requireNonEmpty("listingId", listingId);

    const listing = await this.readListing(
      ctx,
      this.getListingKey(ctx, listingId),
      listingId,
    );

    return JSON.stringify(listing);
  }

  @Transaction()
  @Returns("string")
  public async CancelListing(
    ctx: Context,
    listingId: string,
    sellerId: string,
  ): Promise<string> {
    this.requireNonEmpty("listingId", listingId);
    this.requireNonEmpty("sellerId", sellerId);

    const listingKey = this.getListingKey(ctx, listingId);
    const listing = await this.readListing(ctx, listingKey, listingId);

    if (listing.sellerId !== sellerId) {
      throw new Error(`Seller ${sellerId} does not own listing ${listingId}`);
    }

    if (listing.status !== "active") {
      throw new Error(
        `Listing ${listingId} cannot be cancelled because it is ${listing.status}`,
      );
    }

    const timestamp = this.getTimestampIso(ctx);
    const updatedListing: EnergyListing = {
      ...listing,
      status: "cancelled",
      updatedAt: timestamp,
      cancelledAt: timestamp,
    };

    await ctx.stub.putState(
      listingKey,
      Buffer.from(JSON.stringify(updatedListing)),
    );

    return JSON.stringify(updatedListing);
  }

  @Transaction(false)
  @Returns("string")
  public async GetListingHistory(
    ctx: Context,
    listingId: string,
  ): Promise<string> {
    this.requireNonEmpty("listingId", listingId);

    const listingKey = this.getListingKey(ctx, listingId);
    const iterator = await ctx.stub.getHistoryForKey(listingKey);
    const history: ListingHistoryEntry[] = [];

    try {
      while (true) {
        const result = await iterator.next();

        if (result.done) {
          break;
        }

        const modification = result.value;
        history.push({
          transactionId: modification.txId,
          timestamp: this.timestampToIso(modification.timestamp),
          isDelete: modification.isDelete,
          value:
            modification.value.length > 0
              ? (JSON.parse(modification.value.toString()) as EnergyListing)
              : null,
        });
      }
    } finally {
      await iterator.close();
    }

    return JSON.stringify(history);
  }

  private getUserKey(ctx: Context, userId: string): string {
    return ctx.stub.createCompositeKey("userAccount", [userId]);
  }

  private getListingKey(ctx: Context, listingId: string): string {
    return ctx.stub.createCompositeKey("energyListing", [listingId]);
  }

  private async readUser(
    ctx: Context,
    userKey: string,
    userId: string,
  ): Promise<UserAccount> {
    const state = await ctx.stub.getState(userKey);

    if (state.length === 0) {
      throw new Error(`User ${userId} does not exist`);
    }

    return JSON.parse(state.toString()) as UserAccount;
  }

  private async readListing(
    ctx: Context,
    listingKey: string,
    listingId: string,
  ): Promise<EnergyListing> {
    const state = await ctx.stub.getState(listingKey);

    if (state.length === 0) {
      throw new Error(`Listing ${listingId} does not exist`);
    }

    return JSON.parse(state.toString()) as EnergyListing;
  }

  private requireNonEmpty(fieldName: string, value: string): void {
    if (value.trim().length === 0) {
      throw new Error(`${fieldName} is required`);
    }
  }

  private parseNonNegativeInteger(fieldName: string, value: string): number {
    this.requireNonEmpty(fieldName, value);

    if (!/^\d+$/.test(value)) {
      throw new Error(`${fieldName} must be a non-negative integer string`);
    }

    const parsedValue = Number.parseInt(value, 10);

    if (!Number.isSafeInteger(parsedValue)) {
      throw new Error(
        `${fieldName} must be within JavaScript safe integer range`,
      );
    }

    return parsedValue;
  }

  private parsePositiveInteger(fieldName: string, value: string): number {
    const parsedValue = this.parseNonNegativeInteger(fieldName, value);

    if (parsedValue === 0) {
      throw new Error(`${fieldName} must be greater than zero`);
    }

    return parsedValue;
  }

  private parsePositiveQuantity(fieldName: string, value: string): number {
    this.requireNonEmpty(fieldName, value);

    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
      throw new Error(`${fieldName} must be a positive decimal string`);
    }

    const parsedValue = Number(value);

    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      throw new Error(`${fieldName} must be a finite value greater than zero`);
    }

    return parsedValue;
  }

  private getTimestampIso(ctx: Context): string {
    return this.timestampToIso(ctx.stub.getTxTimestamp());
  }

  private timestampToIso(timestamp: {
    seconds: { toString(): string };
    nanos: number;
  }): string {
    const milliseconds =
      Number(timestamp.seconds.toString()) * 1000 +
      Math.floor(timestamp.nanos / 1_000_000);

    return new Date(milliseconds).toISOString();
  }
}
