import {
  Context,
  Contract,
  Info,
  Returns,
  Transaction,
} from "fabric-contract-api";

type UserStatus = "ACTIVE" | "INACTIVE";

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

  private getUserKey(ctx: Context, userId: string): string {
    return ctx.stub.createCompositeKey("userAccount", [userId]);
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

  private getTimestampIso(ctx: Context): string {
    const timestamp = ctx.stub.getTxTimestamp();
    const milliseconds =
      Number(timestamp.seconds.toString()) * 1000 +
      Math.floor(timestamp.nanos / 1_000_000);

    return new Date(milliseconds).toISOString();
  }
}
