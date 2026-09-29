import {
  Context,
  Contract,
  Info,
  Returns,
  Transaction,
} from "fabric-contract-api";

type UserStatus = "ACTIVE" | "INACTIVE";
type ListingStatus = "active" | "cancelled" | "sold";
type ListingQueryStatus = ListingStatus | "all";

interface EnergyListing {
  docType: "energyListing";
  listingId: string;
  userId: string;
  assetId: string;
  status: ListingStatus;
  energyKWh: number;
  priceTokensPerKWh: number;
  createdAt: string;
  closedAt: string | null;
  transactionId?: string;
}

interface EnergyTransaction {
  docType: "energyTransaction";
  schemaVersion: 2;
  transactionId: string;
  fabricTransactionId: string;
  listingId: string;
  sellerId: string;
  buyerId: string;
  assetId: string;
  buyerAssetId: string;
  energyKWh: number;
  priceTokensPerKWh: number;
  totalTokens: number;
  status: "completed";
  completedAt: string;
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
  description:
    "Energy marketplace listing and settlement contract for the T187 capstone",
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
    this.requireBackendService(ctx);
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
    this.requireBackendService(ctx);
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
    userId: string,
    assetId: string,
    energyKWh: string,
    priceTokensPerKWh: string,
  ): Promise<string> {
    this.requireBackendService(ctx);
    this.requireNonEmpty("listingId", listingId);
    this.requireNonEmpty("userId", userId);
    this.requireNonEmpty("assetId", assetId);

    const parsedEnergyKWh = this.parsePositiveQuantity("energyKWh", energyKWh);
    const parsedPriceTokensPerKWh = this.parsePositiveInteger(
      "priceTokensPerKWh",
      priceTokensPerKWh,
    );
    // Reject an offer now if its total could never be settled.
    this.calculateTotalTokens(parsedEnergyKWh, parsedPriceTokensPerKWh);
    const listingKey = this.getListingKey(ctx, listingId);
    const existingState = await ctx.stub.getState(listingKey);

    if (existingState.length > 0) {
      throw new Error(`Listing ${listingId} already exists`);
    }

    const listing: EnergyListing = {
      docType: "energyListing",
      listingId,
      userId,
      assetId,
      status: "active",
      energyKWh: parsedEnergyKWh,
      priceTokensPerKWh: parsedPriceTokensPerKWh,
      createdAt: this.getTimestampIso(ctx),
      closedAt: null,
    };

    await ctx.stub.putState(listingKey, Buffer.from(JSON.stringify(listing)));

    return JSON.stringify(listing);
  }

  @Transaction(false)
  @Returns("string")
  public async ReadListing(ctx: Context, listingId: string): Promise<string> {
    this.requireNonEmpty("listingId", listingId);

    return JSON.stringify(
      await this.readListing(
        ctx,
        this.getListingKey(ctx, listingId),
        listingId,
      ),
    );
  }

  @Transaction(false)
  @Returns("string")
  public async ReadListings(ctx: Context, status: string): Promise<string> {
    const queryStatus = this.parseListingQueryStatus(status);
    const iterator = await ctx.stub.getStateByPartialCompositeKey(
      "energyListing",
      [],
    );
    const listings: EnergyListing[] = [];

    try {
      while (true) {
        const result = await iterator.next();

        if (result.done) {
          break;
        }

        const listing = JSON.parse(
          result.value.value.toString(),
        ) as EnergyListing;

        if (queryStatus === "all" || listing.status === queryStatus) {
          listings.push(listing);
        }
      }
    } finally {
      await iterator.close();
    }

    return JSON.stringify(listings);
  }

  @Transaction()
  @Returns("string")
  public async CancelListing(
    ctx: Context,
    listingId: string,
    userId: string,
  ): Promise<string> {
    this.requireBackendService(ctx);
    this.requireNonEmpty("listingId", listingId);
    this.requireNonEmpty("userId", userId);

    const listing = await this.readListing(
      ctx,
      this.getListingKey(ctx, listingId),
      listingId,
    );

    if (listing.userId !== userId) {
      throw new Error(`User ${userId} does not own listing ${listingId}`);
    }

    if (listing.status !== "active") {
      throw new Error(
        `Listing ${listingId} cannot be cancelled because it is ${listing.status}`,
      );
    }

    const cancelledListing: EnergyListing = {
      ...listing,
      status: "cancelled",
      closedAt: this.getTimestampIso(ctx),
    };

    await ctx.stub.putState(
      this.getListingKey(ctx, listingId),
      Buffer.from(JSON.stringify(cancelledListing)),
    );

    return JSON.stringify(cancelledListing);
  }

  /** Records an accepted whole-listing purchase; an identical retry is safe. */
  @Transaction()
  @Returns("string")
  public async CompletePurchaseHandshake(
    ctx: Context,
    transactionId: string,
    listingId: string,
    buyerId: string,
    buyerAssetId: string,
  ): Promise<string> {
    this.requireBackendService(ctx);
    this.requireNonEmpty("transactionId", transactionId);
    this.requireNonEmpty("listingId", listingId);
    this.requireNonEmpty("buyerId", buyerId);
    this.requireNonEmpty("buyerAssetId", buyerAssetId);

    // The application supplies one stable ID for the accepted handshake.
    // A retry after a lost commit response must not create another purchase.
    const existingState = await ctx.stub.getState(
      this.getTransactionKey(ctx, transactionId),
    );
    if (existingState.length > 0) {
      const existing = JSON.parse(
        existingState.toString(),
      ) as EnergyTransaction;
      if (
        existing.schemaVersion !== 2 ||
        existing.listingId !== listingId ||
        existing.buyerId !== buyerId ||
        existing.buyerAssetId !== buyerAssetId
      ) {
        throw new Error(
          "Transaction ID is already used for a different purchase",
        );
      }
      const listing = await this.readListing(
        ctx,
        this.getListingKey(ctx, listingId),
        listingId,
      );
      if (
        listing.status !== "sold" ||
        listing.transactionId !== transactionId
      ) {
        throw new Error("Transaction and listing state are inconsistent");
      }
      return JSON.stringify({ listing, transaction: existing });
    }

    const listing = await this.getActiveListing(ctx, listingId);
    if (listing.userId === buyerId) {
      throw new Error("A seller cannot purchase their own listing");
    }
    if (listing.assetId === buyerAssetId) {
      throw new Error(
        "The receiving battery must differ from the seller's battery",
      );
    }
    const totalTokens = this.calculateTotalTokens(
      listing.energyKWh,
      listing.priceTokensPerKWh,
    );
    const completedAt = this.getTimestampIso(ctx);
    const soldListing: EnergyListing = {
      ...listing,
      status: "sold",
      closedAt: completedAt,
      transactionId,
    };
    const transaction: EnergyTransaction = {
      docType: "energyTransaction",
      schemaVersion: 2,
      transactionId,
      fabricTransactionId: ctx.stub.getTxID(),
      listingId: listing.listingId,
      sellerId: listing.userId,
      buyerId,
      assetId: listing.assetId,
      buyerAssetId,
      energyKWh: listing.energyKWh,
      priceTokensPerKWh: listing.priceTokensPerKWh,
      totalTokens,
      status: "completed",
      completedAt,
    };
    const sellerIndexKey = this.getUserTransactionKey(
      ctx,
      transaction.sellerId,
      transactionId,
    );
    const buyerIndexKey = this.getUserTransactionKey(
      ctx,
      buyerId,
      transactionId,
    );

    await ctx.stub.putState(
      this.getListingKey(ctx, listingId),
      Buffer.from(JSON.stringify(soldListing)),
    );
    await ctx.stub.putState(
      this.getTransactionKey(ctx, transaction.transactionId),
      Buffer.from(JSON.stringify(transaction)),
    );
    // Store references, so the completed transaction has one authoritative copy.
    await ctx.stub.putState(sellerIndexKey, Buffer.from(transactionId));
    await ctx.stub.putState(buyerIndexKey, Buffer.from(transactionId));

    return JSON.stringify({ listing: soldListing, transaction });
  }

  /** Reads a purchase for its buyer or seller, as authenticated by the backend. */
  @Transaction(false)
  @Returns("string")
  public async ReadTransaction(
    ctx: Context,
    transactionId: string,
    requestingUserId: string,
  ): Promise<string> {
    this.requireBackendService(ctx);
    this.requireNonEmpty("transactionId", transactionId);
    this.requireNonEmpty("requestingUserId", requestingUserId);
    const state = await ctx.stub.getState(
      this.getTransactionKey(ctx, transactionId),
    );

    if (state.length === 0) {
      throw new Error("Transaction not found or not accessible");
    }

    const transaction = JSON.parse(state.toString()) as EnergyTransaction;
    if (!this.isTransactionParty(transaction, requestingUserId)) {
      throw new Error("Transaction not found or not accessible");
    }

    return state.toString();
  }

  /** Reads one page of purchases and sales from the user's ledger index. */
  @Transaction(false)
  @Returns("string")
  public async ReadTransactionsForUser(
    ctx: Context,
    requestingUserId: string,
    pageSize: string,
    bookmark: string,
  ): Promise<string> {
    this.requireBackendService(ctx);
    this.requireNonEmpty("requestingUserId", requestingUserId);
    const size = this.parsePositiveInteger("pageSize", pageSize);
    if (size > 100) {
      throw new Error("pageSize must not exceed 100");
    }
    if (typeof bookmark !== "string") {
      throw new Error("bookmark must be a string");
    }

    const { iterator, metadata } =
      await ctx.stub.getStateByPartialCompositeKeyWithPagination(
        "energyTransactionByUser",
        [requestingUserId],
        size,
        bookmark,
      );
    const transactions: EnergyTransaction[] = [];
    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) {
          break;
        }
        const transactionId = result.value.value.toString();
        // Reuse the detail query's access check even when following an index.
        transactions.push(
          JSON.parse(
            await this.ReadTransaction(ctx, transactionId, requestingUserId),
          ) as EnergyTransaction,
        );
      }
    } finally {
      await iterator.close();
    }
    return JSON.stringify({ transactions, bookmark: metadata.bookmark });
  }

  @Transaction(false)
  @Returns("string")
  public async GetListingHistory(
    ctx: Context,
    listingId: string,
  ): Promise<string> {
    this.requireNonEmpty("listingId", listingId);

    const iterator = await ctx.stub.getHistoryForKey(
      this.getListingKey(ctx, listingId),
    );
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

  private requireBackendService(ctx: Context): void {
    // A caller-supplied user ID is trusted only from this CA-authorised service.
    // The backend must derive requestingUserId from its authenticated session.
    if (
      ctx.clientIdentity.getMSPID() !== "PlatformOrgMSP" ||
      !ctx.clientIdentity.assertAttributeValue("energyMarket.backend", "true")
    ) {
      throw new Error(
        "Only the authorised backend service may invoke this operation",
      );
    }
  }

  private isTransactionParty(
    transaction: EnergyTransaction,
    userId: string,
  ): boolean {
    return transaction.buyerId === userId || transaction.sellerId === userId;
  }

  private calculateTotalTokens(
    energyKWh: number,
    priceTokensPerKWh: number,
  ): number {
    if (
      !Number.isFinite(energyKWh) ||
      energyKWh <= 0 ||
      !Number.isSafeInteger(priceTokensPerKWh) ||
      priceTokensPerKWh <= 0
    ) {
      throw new Error("Listing has invalid energy or token price");
    }
    // Decimal arithmetic avoids rounding 1.005 kWh * 100 tokens down to 100.
    const [coefficient, exponent = "0"] = String(energyKWh).split("e");
    const [whole, fraction = ""] = coefficient.split(".");
    const scale = fraction.length - Number(exponent);
    let numerator = BigInt(whole + fraction) * BigInt(priceTokensPerKWh);
    const denominator = 10n ** BigInt(Math.max(scale, 0));
    if (scale < 0) {
      numerator *= 10n ** BigInt(-scale);
    }
    const rounded = (numerator + denominator / 2n) / denominator;
    if (rounded < 1n || rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        "Transaction total must be a positive safe integer token amount",
      );
    }
    return Number(rounded);
  }

  private getUserKey(ctx: Context, userId: string): string {
    return ctx.stub.createCompositeKey("userAccount", [userId]);
  }

  private getListingKey(ctx: Context, listingId: string): string {
    return ctx.stub.createCompositeKey("energyListing", [listingId]);
  }

  private getTransactionKey(ctx: Context, transactionId: string): string {
    return ctx.stub.createCompositeKey("energyTransaction", [transactionId]);
  }

  private getUserTransactionKey(
    ctx: Context,
    userId: string,
    transactionId: string,
  ): string {
    return ctx.stub.createCompositeKey("energyTransactionByUser", [
      userId,
      transactionId,
    ]);
  }

  private async getActiveListing(
    ctx: Context,
    listingId: string,
  ): Promise<EnergyListing> {
    this.requireNonEmpty("listingId", listingId);
    const listing = await this.readListing(
      ctx,
      this.getListingKey(ctx, listingId),
      listingId,
    );

    if (listing.status !== "active") {
      throw new Error(
        `Listing ${listingId} must be active; it is ${listing.status}`,
      );
    }

    return listing;
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
    if (typeof value !== "string" || value.trim().length === 0) {
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

  private parseListingQueryStatus(value: string): ListingQueryStatus {
    this.requireNonEmpty("status", value);

    if (
      value !== "active" &&
      value !== "cancelled" &&
      value !== "sold" &&
      value !== "all"
    ) {
      throw new Error("status must be active, cancelled, sold, or all");
    }

    return value;
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
