import { PlatformError } from "@/error/index.ts";

/**
 * Council operator authentication errors (challenge issuance + signature
 * verification). Each carries a stable `code` the console maps to operator copy,
 * and a redacted `api` projection — the internal reason never leaks verbatim.
 */
export enum COUNCIL_AUTH_ERROR_CODES {
  TOO_MANY_CHALLENGES = "COUNCIL_AUTH_001",
  CHALLENGE_NOT_FOUND = "COUNCIL_AUTH_002",
  CHALLENGE_EXPIRED = "COUNCIL_AUTH_003",
  PUBLIC_KEY_MISMATCH = "COUNCIL_AUTH_004",
  INVALID_SIGNATURE = "COUNCIL_AUTH_005",
}

const source = "@service/auth";

export class TOO_MANY_CHALLENGES extends PlatformError {
  constructor() {
    super({
      source,
      code: COUNCIL_AUTH_ERROR_CODES.TOO_MANY_CHALLENGES,
      message: "Too many pending challenges",
      details:
        "The pending-challenge buffer is full; requests are rate limited.",
      api: {
        status: 429,
        message: "Too many pending sign-in attempts",
        details: "Please wait a moment and try signing in again.",
      },
    });
  }
}

export class CHALLENGE_NOT_FOUND extends PlatformError {
  constructor() {
    super({
      source,
      code: COUNCIL_AUTH_ERROR_CODES.CHALLENGE_NOT_FOUND,
      message: "Challenge not found or expired",
      details: "No pending challenge matched the supplied nonce.",
      api: {
        status: 401,
        message: "Sign-in challenge not found or expired",
        details: "Your sign-in request has expired. Please start again.",
      },
    });
  }
}

export class CHALLENGE_EXPIRED extends PlatformError {
  constructor() {
    super({
      source,
      code: COUNCIL_AUTH_ERROR_CODES.CHALLENGE_EXPIRED,
      message: "Challenge expired",
      details: "The challenge exceeded its time-to-live before verification.",
      api: {
        status: 401,
        message: "Sign-in challenge expired",
        details: "Your sign-in request took too long. Please start again.",
      },
    });
  }
}

export class PUBLIC_KEY_MISMATCH extends PlatformError {
  constructor() {
    super({
      source,
      code: COUNCIL_AUTH_ERROR_CODES.PUBLIC_KEY_MISMATCH,
      message: "Public key mismatch",
      details: "The verifying public key did not match the challenge subject.",
      api: {
        status: 401,
        message: "Sign-in key mismatch",
        details:
          "The wallet used to sign did not match the one that started sign-in.",
      },
    });
  }
}

export class INVALID_SIGNATURE extends PlatformError {
  constructor(error?: Error | unknown) {
    super({
      source,
      code: COUNCIL_AUTH_ERROR_CODES.INVALID_SIGNATURE,
      message: "Invalid signature",
      details: "The supplied signature failed verification for all formats.",
      baseError: error,
      api: {
        status: 401,
        message: "Invalid signature",
        details: "The signature could not be verified. Please try again.",
      },
    });
  }
}
