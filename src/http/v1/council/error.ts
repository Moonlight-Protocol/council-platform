import { PlatformError } from "@/error/index.ts";

/**
 * Council-specific HTTP-edge errors. Generic request validation lives in
 * `@/http/v1/error.ts`; these carry council-governance-specific codes the
 * console maps to operator copy.
 */
export enum HTTP_COUNCIL_ERROR_CODES {
  MISSING_COUNCIL_ID = "HTTP_COUNCIL_001",
  COUNCIL_NOT_FOUND = "HTTP_COUNCIL_002",
}

const source = "@http/v1/council";

export class MISSING_COUNCIL_ID extends PlatformError {
  constructor() {
    super({
      source,
      code: HTTP_COUNCIL_ERROR_CODES.MISSING_COUNCIL_ID,
      message: "councilId query parameter is required",
      api: {
        status: 400,
        message: "councilId query parameter is required",
        details: "Include a councilId query parameter with the request.",
      },
    });
  }
}

export class COUNCIL_NOT_FOUND extends PlatformError {
  constructor() {
    super({
      source,
      code: HTTP_COUNCIL_ERROR_CODES.COUNCIL_NOT_FOUND,
      message: "Council not found",
      details: "No council matched the id for the authenticated owner.",
      api: {
        status: 404,
        message: "Council not found",
        details: "The requested council does not exist or is not yours.",
      },
    });
  }
}
