import { createHash } from "node:crypto";

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
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
}

type WalletStatus = "active" | "closed";
type WalletLedgerEntryType =
  | "issue"
  | "hold"
  | "settlementDebit"
  | "settlementCredit";

interface TokenWallet {
  docType: "tokenWallet";
  walletId: string;
  ownerUserId: string;
  ownerFabricEnrollmentId: string;
  ownerMspId: string;
  status: WalletStatus;
  availableBalanceTokens: number;
  heldBalanceTokens: number;
  lastLedgerSequence: number;
  lastFabricTransactionId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface WalletLedgerEntry {
  docType: "walletLedgerEntry";
  entryId: string;
  sequence: number;
  walletId: string;
  entryType: WalletLedgerEntryType;
  amountTokens: number;
  sourceWalletId: string | null;
  destinationWalletId: string | null;
  transactionId: string | null;
  listingId: string | null;
  holdId: string | null;
  settlementId: string | null;
  reference: string;
  actingFabricIdentity: string;
  actingRole: string;
  fabricTransactionId: string;
  timestamp: string;
  resultingAvailableBalanceTokens: number;
  resultingHeldBalanceTokens: number;
}

interface TokenHold {
  docType: "tokenHold";
  holdId: string;
  walletId: string;
  amountTokens: number;
  transactionId: string;
  listingId: string;
  idempotencyKey: string;
  status: "active" | "consumed";
  settlementId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListingReservation {
  docType: "energyListingReservation";
  listingId: string;
  holdId: string;
  buyerWalletId: string;
  transactionId: string;
  status: "active" | "consumed";
  settlementId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface WalletOperationRecord {
  docType: "walletOperation";
  operation: "issue" | "hold";
  reference: string;
  walletId: string;
  amountTokens: number;
  result: string;
}

interface WalletIssueReceipt {
  operation: "issue";
  reference: string;
  fabricTransactionId: string;
  wallet: TokenWallet;
  ledgerEntry: WalletLedgerEntry;
}

interface WalletHoldReceipt {
  operation: "hold";
  idempotencyKey: string;
  hold: TokenHold;
  wallet: TokenWallet;
  ledgerEntry: WalletLedgerEntry;
}

interface WalletSettlementReceipt {
  docType: "walletSettlement";
  settlementId: string;
  transactionId: string;
  listingId: string;
  buyerWalletId: string;
  sellerWalletId: string;
  holdId: string;
  energyAmountKWh: number;
  priceTokensPerKWh: number;
  totalTokens: number;
  buyerAssetId: string;
  status: "completed";
  fabricTransactionId: string;
  completedAt: string;
  buyerWallet: TokenWallet;
  sellerWallet: TokenWallet;
  listing: EnergyListing;
  transaction: EnergyTransaction;
  buyerLedgerEntry: WalletLedgerEntry;
  sellerLedgerEntry: WalletLedgerEntry;
}

interface WalletHistoryPage {
  walletId: string;
  entries: WalletLedgerEntry[];
  bookmark: string;
}

interface WalletCollectionPage {
  wallets: TokenWallet[];
  bookmark: string;
}

interface TransactionCollectionPage {
  transactions: EnergyTransaction[];
  bookmark: string;
}

const maxSafeTokenAmount = BigInt(Number.MAX_SAFE_INTEGER);
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
  ): Promise<string> {
    this.requireBackendService(ctx);
    this.requireNonEmpty("userId", userId);
    this.requireNonEmpty("fabricEnrollmentId", fabricEnrollmentId);

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
  public async CreateWallet(
    ctx: Context,
    walletId: string,
    ownerUserId: string,
    ownerFabricEnrollmentId: string,
    ownerMspId: string,
  ): Promise<string> {
    this.requireBackendService(ctx);
    this.requireIdentifier("walletId", walletId);
    this.requireIdentifier("ownerUserId", ownerUserId);
    this.requireIdentifier("ownerFabricEnrollmentId", ownerFabricEnrollmentId);
    this.requireIdentifier("ownerMspId", ownerMspId);

    const user = await this.readUser(
      ctx,
      this.getUserKey(ctx, ownerUserId),
      ownerUserId,
    );
    if (user.fabricEnrollmentId !== ownerFabricEnrollmentId) {
      throw new Error(
        "Wallet owner does not match the registered Fabric enrollment",
      );
    }
    if (ownerMspId !== ctx.clientIdentity.getMSPID()) {
      throw new Error("Wallet owner MSP does not match the Platform MSP");
    }

    const walletKey = this.getWalletKey(ctx, walletId);
    const existingWalletState = await ctx.stub.getState(walletKey);
    if (existingWalletState.length > 0) {
      const existingWallet = JSON.parse(
        existingWalletState.toString(),
      ) as TokenWallet;
      if (
        existingWallet.ownerUserId === ownerUserId &&
        existingWallet.ownerFabricEnrollmentId === ownerFabricEnrollmentId &&
        existingWallet.ownerMspId === ownerMspId
      ) {
        return JSON.stringify(existingWallet);
      }

      throw new Error(`Wallet ${walletId} already exists`);
    }

    const ownerIndexKey = this.getWalletOwnerKey(ctx, ownerUserId);
    const existingOwnerState = await ctx.stub.getState(ownerIndexKey);
    if (existingOwnerState.length > 0) {
      const existingWalletId = existingOwnerState.toString();
      throw new Error(
        `User ${ownerUserId} already owns wallet ${existingWalletId}`,
      );
    }

    const timestamp = this.getTimestampIso(ctx);
    const wallet: TokenWallet = {
      docType: "tokenWallet",
      walletId,
      ownerUserId,
      ownerFabricEnrollmentId,
      ownerMspId,
      status: "active",
      availableBalanceTokens: 0,
      heldBalanceTokens: 0,
      lastLedgerSequence: 0,
      lastFabricTransactionId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await ctx.stub.putState(walletKey, Buffer.from(JSON.stringify(wallet)));
    await ctx.stub.putState(ownerIndexKey, Buffer.from(walletId));

    return JSON.stringify(wallet);
  }

  @Transaction(false)
  @Returns("string")
  public async ReadWallet(ctx: Context, walletId: string): Promise<string> {
    this.requireBackendService(ctx);
    this.requireIdentifier("walletId", walletId);

    return JSON.stringify(await this.readTokenWallet(ctx, walletId));
  }

  @Transaction(false)
  @Returns("string")
  public async ReadWalletByOwner(
    ctx: Context,
    ownerUserId: string,
  ): Promise<string> {
    this.requireBackendService(ctx);
    this.requireIdentifier("ownerUserId", ownerUserId);

    const ownerState = await ctx.stub.getState(
      this.getWalletOwnerKey(ctx, ownerUserId),
    );
    if (ownerState.length === 0) {
      throw new Error(`Wallet for user ${ownerUserId} does not exist`);
    }

    return JSON.stringify(
      await this.readTokenWallet(ctx, ownerState.toString()),
    );
  }

  @Transaction(false)
  @Returns("string")
  public async ReadWalletBalance(
    ctx: Context,
    walletId: string,
  ): Promise<string> {
    this.requireBackendService(ctx);
    this.requireIdentifier("walletId", walletId);

    const wallet = await this.readTokenWallet(ctx, walletId);
    return JSON.stringify(this.toWalletBalance(wallet));
  }

  @Transaction(false)
  @Returns("string")
  public async ReadWalletHistory(
    ctx: Context,
    walletId: string,
    pageSize: string,
    bookmark: string,
  ): Promise<string> {
    this.requireBackendService(ctx);
    this.requireIdentifier("walletId", walletId);
    const size = this.parsePositiveInteger("pageSize", pageSize);
    if (size > 100) {
      throw new Error("pageSize must not exceed 100");
    }
    if (typeof bookmark !== "string") {
      throw new Error("bookmark must be a string");
    }

    await this.readTokenWallet(ctx, walletId);
    const { iterator, metadata } =
      await ctx.stub.getStateByPartialCompositeKeyWithPagination(
        "tokenWalletLedger",
        [walletId],
        size,
        bookmark,
      );
    const entries: WalletLedgerEntry[] = [];

    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) {
          break;
        }

        entries.push(
          JSON.parse(result.value.value.toString()) as WalletLedgerEntry,
        );
      }
    } finally {
      await iterator.close();
    }

    const page: WalletHistoryPage = {
      walletId,
      entries,
      bookmark: metadata.bookmark,
    };
    return JSON.stringify(page);
  }

  /** Backend-only, paginated source for rebuilding MongoDB wallet projections. */
  @Transaction(false)
  @Returns("string")
  public async ReadWallets(
    ctx: Context,
    pageSize: string,
    bookmark: string,
  ): Promise<string> {
    this.requireBackendService(ctx);
    const size = this.parsePositiveInteger("pageSize", pageSize);
    if (size > 100) {
      throw new Error("pageSize must not exceed 100");
    }
    if (typeof bookmark !== "string") {
      throw new Error("bookmark must be a string");
    }

    const { iterator, metadata } =
      await ctx.stub.getStateByPartialCompositeKeyWithPagination(
        "tokenWallet",
        [],
        size,
        bookmark,
      );
    const wallets: TokenWallet[] = [];
    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) break;
        wallets.push(JSON.parse(result.value.value.toString()) as TokenWallet);
      }
    } finally {
      await iterator.close();
    }

    const page: WalletCollectionPage = {
      wallets,
      bookmark: metadata.bookmark,
    };
    return JSON.stringify(page);
  }

  @Transaction()
  @Returns("string")
  public async IssueTokens(
    ctx: Context,
    walletId: string,
    amountTokens: string,
    reference: string,
  ): Promise<string> {
    this.requireTokenIssuer(ctx);
    this.requireIdentifier("walletId", walletId);
    const amount = this.parsePositiveInteger("amountTokens", amountTokens);
    this.requireReference("reference", reference);

    const operationKey = this.getWalletOperationKey(ctx, "issue", reference);
    const existingOperationState = await ctx.stub.getState(operationKey);
    if (existingOperationState.length > 0) {
      const existingOperation = JSON.parse(
        existingOperationState.toString(),
      ) as WalletOperationRecord;
      if (
        existingOperation.walletId !== walletId ||
        existingOperation.amountTokens !== amount
      ) {
        throw new Error("Issuance reference is already used differently");
      }

      return existingOperation.result;
    }

    const wallet = await this.getActiveWallet(ctx, walletId);
    const updatedWallet = this.withLedgerUpdate(
      ctx,
      wallet,
      {
        availableBalanceTokens: this.addTokenAmounts(
          wallet.availableBalanceTokens,
          amount,
        ),
        heldBalanceTokens: wallet.heldBalanceTokens,
      },
      this.getTimestampIso(ctx),
    );
    const ledgerEntry = this.buildWalletLedgerEntry(
      ctx,
      updatedWallet,
      "issue",
      amount,
      `issue-${this.digest(reference)}`,
      reference,
      null,
      null,
      null,
      null,
      null,
      "issuer",
    );
    const receipt: WalletIssueReceipt = {
      operation: "issue",
      reference,
      fabricTransactionId: ctx.stub.getTxID(),
      wallet: updatedWallet,
      ledgerEntry,
    };
    const result = JSON.stringify(receipt);
    const operation: WalletOperationRecord = {
      docType: "walletOperation",
      operation: "issue",
      reference,
      walletId,
      amountTokens: amount,
      result,
    };

    await ctx.stub.putState(
      this.getWalletKey(ctx, walletId),
      Buffer.from(JSON.stringify(updatedWallet)),
    );
    await this.putWalletLedgerEntry(ctx, ledgerEntry);
    await ctx.stub.putState(
      operationKey,
      Buffer.from(JSON.stringify(operation)),
    );

    return result;
  }

  @Transaction()
  @Returns("string")
  public async HoldTokens(
    ctx: Context,
    walletId: string,
    amountTokens: string,
    transactionId: string,
    listingId: string,
    idempotencyKey: string,
  ): Promise<string> {
    this.requireBackendService(ctx);
    this.requireIdentifier("walletId", walletId);
    this.requireIdentifier("transactionId", transactionId);
    this.requireIdentifier("listingId", listingId);
    this.requireReference("idempotencyKey", idempotencyKey);
    const amount = this.parsePositiveInteger("amountTokens", amountTokens);

    const operationKey = this.getWalletOperationKey(
      ctx,
      "hold",
      idempotencyKey,
    );
    const existingOperationState = await ctx.stub.getState(operationKey);
    if (existingOperationState.length > 0) {
      const existingOperation = JSON.parse(
        existingOperationState.toString(),
      ) as WalletOperationRecord;
      if (
        existingOperation.walletId !== walletId ||
        existingOperation.amountTokens !== amount
      ) {
        throw new Error("Hold idempotency key is already used differently");
      }

      const existingHoldReceipt = JSON.parse(
        existingOperation.result,
      ) as WalletHoldReceipt;
      if (
        existingHoldReceipt.hold.transactionId !== transactionId ||
        existingHoldReceipt.hold.listingId !== listingId ||
        existingHoldReceipt.hold.idempotencyKey !== idempotencyKey
      ) {
        throw new Error("Hold idempotency key is already used differently");
      }

      return existingOperation.result;
    }

    const holdId = `hold-${this.digest(transactionId)}`;
    const holdKey = this.getWalletHoldKey(ctx, holdId);
    const existingHoldState = await ctx.stub.getState(holdKey);
    if (existingHoldState.length > 0) {
      const existingHold = JSON.parse(
        existingHoldState.toString(),
      ) as TokenHold;
      if (
        existingHold.walletId === walletId &&
        existingHold.amountTokens === amount &&
        existingHold.transactionId === transactionId &&
        existingHold.listingId === listingId &&
        existingHold.idempotencyKey === idempotencyKey
      ) {
        throw new Error(
          "Hold exists but its idempotency record is missing; reconcile before retrying",
        );
      }

      throw new Error(`Transaction ${transactionId} already has a hold`);
    }

    await this.getActiveListing(ctx, listingId);
    const reservationKey = this.getListingReservationKey(ctx, listingId);
    const existingReservationState = await ctx.stub.getState(reservationKey);
    if (existingReservationState.length > 0) {
      const existingReservation = JSON.parse(
        existingReservationState.toString(),
      ) as ListingReservation;
      if (existingReservation.status === "active") {
        throw new Error(
          `Listing ${listingId} already has an active token hold`,
        );
      }

      throw new Error(`Listing ${listingId} already has a token reservation`);
    }

    const wallet = await this.getActiveWallet(ctx, walletId);
    if (wallet.availableBalanceTokens < amount) {
      throw new Error("Insufficient available token balance");
    }

    const updatedWallet = this.withLedgerUpdate(
      ctx,
      wallet,
      {
        availableBalanceTokens: this.subtractTokenAmounts(
          wallet.availableBalanceTokens,
          amount,
        ),
        heldBalanceTokens: this.addTokenAmounts(
          wallet.heldBalanceTokens,
          amount,
        ),
      },
      this.getTimestampIso(ctx),
    );
    const hold: TokenHold = {
      docType: "tokenHold",
      holdId,
      walletId,
      amountTokens: amount,
      transactionId,
      listingId,
      idempotencyKey,
      status: "active",
      settlementId: null,
      createdAt: updatedWallet.updatedAt,
      updatedAt: updatedWallet.updatedAt,
    };
    const reservation: ListingReservation = {
      docType: "energyListingReservation",
      listingId,
      holdId,
      buyerWalletId: walletId,
      transactionId,
      status: "active",
      settlementId: null,
      createdAt: updatedWallet.updatedAt,
      updatedAt: updatedWallet.updatedAt,
    };
    const ledgerEntry = this.buildWalletLedgerEntry(
      ctx,
      updatedWallet,
      "hold",
      amount,
      `hold-${this.digest(idempotencyKey)}`,
      idempotencyKey,
      null,
      null,
      transactionId,
      listingId,
      holdId,
      "backend",
    );
    const receipt: WalletHoldReceipt = {
      operation: "hold",
      idempotencyKey,
      hold,
      wallet: updatedWallet,
      ledgerEntry,
    };
    const result = JSON.stringify(receipt);
    const operation: WalletOperationRecord = {
      docType: "walletOperation",
      operation: "hold",
      reference: idempotencyKey,
      walletId,
      amountTokens: amount,
      result,
    };

    await ctx.stub.putState(
      this.getWalletKey(ctx, walletId),
      Buffer.from(JSON.stringify(updatedWallet)),
    );
    await ctx.stub.putState(holdKey, Buffer.from(JSON.stringify(hold)));
    // All holds for a listing write the same key. Fabric MVCC validation makes
    // concurrent competing holds single-winner even if both were endorsed.
    await ctx.stub.putState(
      reservationKey,
      Buffer.from(JSON.stringify(reservation)),
    );
    await this.putWalletLedgerEntry(ctx, ledgerEntry);
    await ctx.stub.putState(
      operationKey,
      Buffer.from(JSON.stringify(operation)),
    );

    return result;
  }

  @Transaction()
  @Returns("string")
  public async SettleEnergyPurchase(
    ctx: Context,
    buyerWalletId: string,
    sellerWalletId: string,
    holdId: string,
    transactionId: string,
    listingId: string,
    energyAmountKWh: string,
    priceTokensPerKWh: string,
    totalTokens: string,
    buyerAssetId: string = "",
  ): Promise<string> {
    this.requireBackendService(ctx);
    this.requireIdentifier("buyerWalletId", buyerWalletId);
    this.requireIdentifier("sellerWalletId", sellerWalletId);
    this.requireIdentifier("holdId", holdId);
    this.requireIdentifier("transactionId", transactionId);
    this.requireIdentifier("listingId", listingId);
    const parsedEnergyAmountKWh = this.parsePositiveQuantity(
      "energyAmountKWh",
      energyAmountKWh,
    );
    const parsedPriceTokensPerKWh = this.parsePositiveInteger(
      "priceTokensPerKWh",
      priceTokensPerKWh,
    );
    const parsedTotalTokens = this.parsePositiveInteger(
      "totalTokens",
      totalTokens,
    );
    if (buyerAssetId) {
      this.requireIdentifier("buyerAssetId", buyerAssetId);
    }

    const settlementKey = this.getWalletSettlementKey(ctx, transactionId);
    const existingSettlementState = await ctx.stub.getState(settlementKey);
    if (existingSettlementState.length > 0) {
      const existingSettlement = JSON.parse(
        existingSettlementState.toString(),
      ) as WalletSettlementReceipt;
      this.assertSettlementRequestMatches(existingSettlement, {
        buyerWalletId,
        sellerWalletId,
        holdId,
        transactionId,
        listingId,
        energyAmountKWh: parsedEnergyAmountKWh,
        priceTokensPerKWh: parsedPriceTokensPerKWh,
        totalTokens: parsedTotalTokens,
        buyerAssetId,
      });
      return JSON.stringify(existingSettlement);
    }

    const holdState = await ctx.stub.getState(
      this.getWalletHoldKey(ctx, holdId),
    );
    if (holdState.length === 0) {
      throw new Error(`Hold ${holdId} does not exist`);
    }
    const hold = JSON.parse(holdState.toString()) as TokenHold;
    if (hold.status !== "active") {
      throw new Error(`Hold ${holdId} has already been consumed`);
    }
    if (
      hold.walletId !== buyerWalletId ||
      hold.transactionId !== transactionId ||
      hold.listingId !== listingId ||
      hold.amountTokens !== parsedTotalTokens
    ) {
      throw new Error("Settlement does not match the active hold");
    }

    const buyerWallet = await this.getActiveWallet(ctx, buyerWalletId);
    const sellerWallet = await this.getActiveWallet(ctx, sellerWalletId);
    if (buyerWalletId === sellerWalletId) {
      throw new Error("Buyer and seller wallets must differ");
    }
    if (buyerWallet.ownerUserId === sellerWallet.ownerUserId) {
      throw new Error("Buyer and seller users must differ");
    }

    const listing = await this.getActiveListing(ctx, listingId);
    const reservationState = await ctx.stub.getState(
      this.getListingReservationKey(ctx, listingId),
    );
    if (reservationState.length === 0) {
      throw new Error(`Listing ${listingId} has no active token reservation`);
    }
    const reservation = JSON.parse(
      reservationState.toString(),
    ) as ListingReservation;
    if (
      reservation.status !== "active" ||
      reservation.listingId !== listingId ||
      reservation.holdId !== holdId ||
      reservation.buyerWalletId !== buyerWalletId ||
      reservation.transactionId !== transactionId
    ) {
      throw new Error(
        "Settlement does not match the active listing reservation",
      );
    }

    if (sellerWallet.ownerUserId !== listing.userId) {
      throw new Error("Seller wallet does not own the listing");
    }
    if (parsedEnergyAmountKWh !== listing.energyKWh) {
      throw new Error("Settlement energy does not match the listing");
    }
    if (parsedPriceTokensPerKWh !== listing.priceTokensPerKWh) {
      throw new Error("Settlement price does not match the listing");
    }
    if (
      this.calculateTotalTokens(
        listing.energyKWh,
        listing.priceTokensPerKWh,
      ) !== parsedTotalTokens
    ) {
      throw new Error("Settlement total does not match the listing");
    }

    const existingTransactionState = await ctx.stub.getState(
      this.getTransactionKey(ctx, transactionId),
    );
    if (existingTransactionState.length > 0) {
      throw new Error(`Transaction ${transactionId} already exists`);
    }

    const settlementId = `settlement-${this.digest(transactionId)}`;
    const completedAt = this.getTimestampIso(ctx);
    const buyerUpdatedWallet = this.withLedgerUpdate(
      ctx,
      buyerWallet,
      {
        availableBalanceTokens: buyerWallet.availableBalanceTokens,
        heldBalanceTokens: this.subtractTokenAmounts(
          buyerWallet.heldBalanceTokens,
          parsedTotalTokens,
        ),
      },
      completedAt,
    );
    const sellerUpdatedWallet = this.withLedgerUpdate(
      ctx,
      sellerWallet,
      {
        availableBalanceTokens: this.addTokenAmounts(
          sellerWallet.availableBalanceTokens,
          parsedTotalTokens,
        ),
        heldBalanceTokens: sellerWallet.heldBalanceTokens,
      },
      completedAt,
    );
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
      listingId,
      sellerId: listing.userId,
      buyerId: buyerWallet.ownerUserId,
      assetId: listing.assetId,
      buyerAssetId,
      energyKWh: listing.energyKWh,
      priceTokensPerKWh: listing.priceTokensPerKWh,
      totalTokens: parsedTotalTokens,
      status: "completed",
      completedAt,
    };
    const buyerLedgerEntry = this.buildWalletLedgerEntry(
      ctx,
      buyerUpdatedWallet,
      "settlementDebit",
      parsedTotalTokens,
      `settlement-${this.digest(transactionId)}-debit`,
      transactionId,
      buyerWalletId,
      sellerWalletId,
      transactionId,
      listingId,
      holdId,
      "backend",
      settlementId,
    );
    const sellerLedgerEntry = this.buildWalletLedgerEntry(
      ctx,
      sellerUpdatedWallet,
      "settlementCredit",
      parsedTotalTokens,
      `settlement-${this.digest(transactionId)}-credit`,
      transactionId,
      buyerWalletId,
      sellerWalletId,
      transactionId,
      listingId,
      holdId,
      "backend",
      settlementId,
    );
    const consumedHold: TokenHold = {
      ...hold,
      status: "consumed",
      settlementId,
      updatedAt: completedAt,
    };
    const consumedReservation: ListingReservation = {
      ...reservation,
      status: "consumed",
      settlementId,
      updatedAt: completedAt,
    };
    const receipt: WalletSettlementReceipt = {
      docType: "walletSettlement",
      settlementId,
      transactionId,
      listingId,
      buyerWalletId,
      sellerWalletId,
      holdId,
      energyAmountKWh: parsedEnergyAmountKWh,
      priceTokensPerKWh: parsedPriceTokensPerKWh,
      totalTokens: parsedTotalTokens,
      buyerAssetId,
      status: "completed",
      fabricTransactionId: transaction.fabricTransactionId,
      completedAt,
      buyerWallet: buyerUpdatedWallet,
      sellerWallet: sellerUpdatedWallet,
      listing: soldListing,
      transaction,
      buyerLedgerEntry,
      sellerLedgerEntry,
    };

    await ctx.stub.putState(
      this.getWalletKey(ctx, buyerWalletId),
      Buffer.from(JSON.stringify(buyerUpdatedWallet)),
    );
    await ctx.stub.putState(
      this.getWalletKey(ctx, sellerWalletId),
      Buffer.from(JSON.stringify(sellerUpdatedWallet)),
    );
    await ctx.stub.putState(
      this.getWalletHoldKey(ctx, holdId),
      Buffer.from(JSON.stringify(consumedHold)),
    );
    await ctx.stub.putState(
      this.getListingReservationKey(ctx, listingId),
      Buffer.from(JSON.stringify(consumedReservation)),
    );
    await this.putWalletLedgerEntry(ctx, buyerLedgerEntry);
    await this.putWalletLedgerEntry(ctx, sellerLedgerEntry);
    await ctx.stub.putState(
      this.getListingKey(ctx, listingId),
      Buffer.from(JSON.stringify(soldListing)),
    );
    await ctx.stub.putState(
      this.getTransactionKey(ctx, transactionId),
      Buffer.from(JSON.stringify(transaction)),
    );
    await ctx.stub.putState(
      this.getUserTransactionKey(ctx, transaction.sellerId, transactionId),
      Buffer.from(transactionId),
    );
    await ctx.stub.putState(
      this.getUserTransactionKey(ctx, transaction.buyerId, transactionId),
      Buffer.from(transactionId),
    );
    await ctx.stub.putState(
      settlementKey,
      Buffer.from(JSON.stringify(receipt)),
    );

    return JSON.stringify(receipt);
  }

  @Transaction(false)
  @Returns("string")
  public async ReadSettlement(
    ctx: Context,
    transactionId: string,
  ): Promise<string> {
    this.requireBackendService(ctx);
    this.requireIdentifier("transactionId", transactionId);

    const state = await ctx.stub.getState(
      this.getWalletSettlementKey(ctx, transactionId),
    );
    if (state.length === 0) {
      throw new Error(
        `Settlement for transaction ${transactionId} does not exist`,
      );
    }

    return state.toString();
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

        if (queryStatus !== "all" && listing.status !== queryStatus) {
          continue;
        }

        if (queryStatus === "active") {
          const reservationState = await ctx.stub.getState(
            this.getListingReservationKey(ctx, listing.listingId),
          );
          if (reservationState.length > 0) {
            const reservation = JSON.parse(
              reservationState.toString(),
            ) as ListingReservation;
            if (reservation.status === "active") continue;
          }
        }

        listings.push(listing);
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

    const reservationState = await ctx.stub.getState(
      this.getListingReservationKey(ctx, listingId),
    );
    if (reservationState.length > 0) {
      const reservation = JSON.parse(
        reservationState.toString(),
      ) as ListingReservation;
      if (reservation.status === "active") {
        throw new Error(
          `Listing ${listingId} cannot be cancelled while it has an active token hold`,
        );
      }
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

  /**
   * Retained as a compatibility-shaped method name, but disabled so a caller
   * cannot mark an energy sale complete without a token settlement.
   */
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
    void transactionId;
    void listingId;
    void buyerId;
    void buyerAssetId;
    throw new Error(
      "CompletePurchaseHandshake is retired; use SettleEnergyPurchase",
    );
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

  /** Backend-only, paginated source for rebuilding MongoDB transaction projections. */
  @Transaction(false)
  @Returns("string")
  public async ReadAllTransactions(
    ctx: Context,
    pageSize: string,
    bookmark: string,
  ): Promise<string> {
    this.requireBackendService(ctx);
    const size = this.parsePositiveInteger("pageSize", pageSize);
    if (size > 100) {
      throw new Error("pageSize must not exceed 100");
    }
    if (typeof bookmark !== "string") {
      throw new Error("bookmark must be a string");
    }

    const { iterator, metadata } =
      await ctx.stub.getStateByPartialCompositeKeyWithPagination(
        "energyTransaction",
        [],
        size,
        bookmark,
      );
    const transactions: EnergyTransaction[] = [];
    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) break;
        transactions.push(
          JSON.parse(result.value.value.toString()) as EnergyTransaction,
        );
      }
    } finally {
      await iterator.close();
    }

    const page: TransactionCollectionPage = {
      transactions,
      bookmark: metadata.bookmark,
    };
    return JSON.stringify(page);
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

  private requireTokenIssuer(ctx: Context): void {
    this.requireBackendService(ctx);
    if (
      !ctx.clientIdentity.assertAttributeValue("energyMarket.issuer", "true")
    ) {
      throw new Error("Only the authorised token issuer may issue tokens");
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

  private getListingReservationKey(ctx: Context, listingId: string): string {
    return ctx.stub.createCompositeKey("energyListingReservation", [listingId]);
  }

  private getTransactionKey(ctx: Context, transactionId: string): string {
    return ctx.stub.createCompositeKey("energyTransaction", [transactionId]);
  }

  private getWalletKey(ctx: Context, walletId: string): string {
    return ctx.stub.createCompositeKey("tokenWallet", [walletId]);
  }

  private getWalletOwnerKey(ctx: Context, ownerUserId: string): string {
    return ctx.stub.createCompositeKey("tokenWalletByOwner", [ownerUserId]);
  }

  private getWalletLedgerKey(
    ctx: Context,
    walletId: string,
    sequence: number,
  ): string {
    return ctx.stub.createCompositeKey("tokenWalletLedger", [
      walletId,
      this.formatLedgerSequence(sequence),
    ]);
  }

  private formatLedgerSequence(sequence: number): string {
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error("Wallet ledger sequence must be a positive safe integer");
    }

    return String(sequence).padStart(16, "0");
  }

  private withLedgerUpdate(
    ctx: Context,
    wallet: TokenWallet,
    balances: Pick<TokenWallet, "availableBalanceTokens" | "heldBalanceTokens">,
    updatedAt: string,
  ): TokenWallet {
    if (
      !Number.isSafeInteger(wallet.lastLedgerSequence) ||
      wallet.lastLedgerSequence < 0 ||
      wallet.lastLedgerSequence >= Number.MAX_SAFE_INTEGER
    ) {
      throw new Error(
        "Wallet ledger sequence would exceed the safe integer range",
      );
    }

    return {
      ...wallet,
      ...balances,
      lastLedgerSequence: wallet.lastLedgerSequence + 1,
      lastFabricTransactionId: ctx.stub.getTxID(),
      updatedAt,
    };
  }

  private getWalletOperationKey(
    ctx: Context,
    operation: WalletOperationRecord["operation"],
    reference: string,
  ): string {
    return ctx.stub.createCompositeKey("tokenWalletOperation", [
      operation,
      this.digest(reference),
    ]);
  }

  private getWalletHoldKey(ctx: Context, holdId: string): string {
    return ctx.stub.createCompositeKey("tokenWalletHold", [holdId]);
  }

  private getWalletSettlementKey(ctx: Context, transactionId: string): string {
    return ctx.stub.createCompositeKey("tokenWalletSettlement", [
      transactionId,
    ]);
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

  private async readTokenWallet(
    ctx: Context,
    walletId: string,
  ): Promise<TokenWallet> {
    const state = await ctx.stub.getState(this.getWalletKey(ctx, walletId));

    if (state.length === 0) {
      throw new Error(`Wallet ${walletId} does not exist`);
    }

    return JSON.parse(state.toString()) as TokenWallet;
  }

  private async getActiveWallet(
    ctx: Context,
    walletId: string,
  ): Promise<TokenWallet> {
    const wallet = await this.readTokenWallet(ctx, walletId);

    if (wallet.status !== "active") {
      throw new Error(`Wallet ${walletId} is ${wallet.status}`);
    }

    return wallet;
  }

  private toWalletBalance(wallet: TokenWallet) {
    return {
      walletId: wallet.walletId,
      ownerUserId: wallet.ownerUserId,
      status: wallet.status,
      availableBalanceTokens: wallet.availableBalanceTokens,
      heldBalanceTokens: wallet.heldBalanceTokens,
      totalBalanceTokens: this.addTokenAmounts(
        wallet.availableBalanceTokens,
        wallet.heldBalanceTokens,
      ),
      updatedAt: wallet.updatedAt,
    };
  }

  private buildWalletLedgerEntry(
    ctx: Context,
    wallet: TokenWallet,
    entryType: WalletLedgerEntryType,
    amountTokens: number,
    entryId: string,
    reference: string,
    sourceWalletId: string | null,
    destinationWalletId: string | null,
    transactionId: string | null,
    listingId: string | null,
    holdId: string | null,
    actingRole: string,
    settlementId: string | null = null,
  ): WalletLedgerEntry {
    return {
      docType: "walletLedgerEntry",
      entryId,
      sequence: wallet.lastLedgerSequence,
      walletId: wallet.walletId,
      entryType,
      amountTokens,
      sourceWalletId,
      destinationWalletId,
      transactionId,
      listingId,
      holdId,
      settlementId,
      reference,
      actingFabricIdentity: ctx.clientIdentity.getID(),
      actingRole,
      fabricTransactionId: ctx.stub.getTxID(),
      timestamp: wallet.updatedAt,
      resultingAvailableBalanceTokens: wallet.availableBalanceTokens,
      resultingHeldBalanceTokens: wallet.heldBalanceTokens,
    };
  }

  private async putWalletLedgerEntry(
    ctx: Context,
    entry: WalletLedgerEntry,
  ): Promise<void> {
    await ctx.stub.putState(
      this.getWalletLedgerKey(ctx, entry.walletId, entry.sequence),
      Buffer.from(JSON.stringify(entry)),
    );
  }

  private assertSettlementRequestMatches(
    settlement: WalletSettlementReceipt,
    request: Pick<
      WalletSettlementReceipt,
      | "buyerWalletId"
      | "sellerWalletId"
      | "holdId"
      | "transactionId"
      | "listingId"
      | "energyAmountKWh"
      | "priceTokensPerKWh"
      | "totalTokens"
      | "buyerAssetId"
    >,
  ): void {
    const fields: Array<keyof typeof request> = [
      "buyerWalletId",
      "sellerWalletId",
      "holdId",
      "transactionId",
      "listingId",
      "energyAmountKWh",
      "priceTokensPerKWh",
      "totalTokens",
      "buyerAssetId",
    ];

    for (const field of fields) {
      if (settlement[field] !== request[field]) {
        throw new Error("Settlement reference is already used differently");
      }
    }
  }

  private requireNonEmpty(fieldName: string, value: string): void {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`${fieldName} is required`);
    }
  }

  private requireIdentifier(fieldName: string, value: string): void {
    this.requireNonEmpty(fieldName, value);

    if (
      value !== value.trim() ||
      value.length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(value)
    ) {
      throw new Error(`${fieldName} is not a valid identifier`);
    }
  }

  private requireReference(fieldName: string, value: string): void {
    this.requireNonEmpty(fieldName, value);

    if (value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new Error(`${fieldName} is not a valid reference`);
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

  private addTokenAmounts(left: number, right: number): number {
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
      throw new Error("Token balances must be safe integers");
    }

    const result = BigInt(left) + BigInt(right);
    if (result > maxSafeTokenAmount) {
      throw new Error("Token balance would exceed the safe integer range");
    }

    return Number(result);
  }

  private subtractTokenAmounts(left: number, right: number): number {
    if (
      !Number.isSafeInteger(left) ||
      !Number.isSafeInteger(right) ||
      right > left
    ) {
      throw new Error("Token balance cannot become negative");
    }

    return left - right;
  }

  private digest(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
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
