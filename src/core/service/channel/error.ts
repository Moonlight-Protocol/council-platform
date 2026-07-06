import { PlatformError } from "@/error/index.ts";

/** Channel service errors (on-chain channel state reads). */
export enum CHANNEL_ERROR_CODES {
  STATE_QUERY_FAILED = "CHANNEL_001",
}

const source = "@service/channel";

export class CHANNEL_STATE_QUERY_FAILED extends PlatformError {
  constructor(error?: Error | unknown) {
    super({
      source,
      code: CHANNEL_ERROR_CODES.STATE_QUERY_FAILED,
      message: "Failed to query channel on-chain state",
      details: "The channel Auth contract read did not respond successfully.",
      baseError: error,
      api: {
        // 503 — the network dependency is temporarily unavailable; retry.
        status: 503,
        message: "Channel network is temporarily unavailable",
        details:
          "The network could not be reached to read channel state. Please try again shortly.",
      },
    });
  }
}
