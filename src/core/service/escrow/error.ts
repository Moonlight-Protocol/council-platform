import { PlatformError } from "@/error/index.ts";

/** Escrow service errors (transparent deposits to non-registered recipients). */
export enum ESCROW_ERROR_CODES {
  INVALID_AMOUNT = "ESCROW_001",
  RECIPIENT_NOT_ACTIVE = "ESCROW_002",
}

const source = "@service/escrow";

export class INVALID_AMOUNT extends PlatformError {
  constructor() {
    super({
      source,
      code: ESCROW_ERROR_CODES.INVALID_AMOUNT,
      message: "Amount must be positive",
      details: "An escrow was requested with a non-positive amount.",
      api: {
        status: 400,
        message: "Amount must be positive",
        details: "The escrow amount must be greater than zero.",
      },
    });
  }
}

export class RECIPIENT_NOT_ACTIVE extends PlatformError {
  constructor() {
    super({
      source,
      code: ESCROW_ERROR_CODES.RECIPIENT_NOT_ACTIVE,
      message: "Recipient is not registered or not active",
      details:
        "The escrow recipient has no active custodial registration for the channel.",
      api: {
        status: 400,
        message: "Recipient is not registered or not active",
        details:
          "The recipient does not have an active account for this channel.",
      },
    });
  }
}
