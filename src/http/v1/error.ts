import { PlatformError } from "@/error/index.ts";

/**
 * Generic HTTP request errors shared across the v1 routes. Business-meaningful
 * cases get their own stable `code`; generic field validation shares
 * `VALIDATION_FAILED` and passes its message through — the console maps known
 * codes and falls back to the body message otherwise.
 */
export enum HTTP_REQUEST_ERROR_CODES {
  INVALID_REQUEST_BODY = "HTTP_REQ_001",
  VALIDATION_FAILED = "HTTP_REQ_002",
  RESOURCE_ID_REQUIRED = "HTTP_REQ_003",
  RESOURCE_NOT_FOUND = "HTTP_REQ_004",
  RESOURCE_CONFLICT = "HTTP_REQ_005",
  FORBIDDEN = "HTTP_REQ_006",
}

const source = "@http/v1/request";

export class INVALID_REQUEST_BODY extends PlatformError {
  constructor(error?: Error | unknown) {
    super({
      source,
      code: HTTP_REQUEST_ERROR_CODES.INVALID_REQUEST_BODY,
      message: "Invalid request body",
      details: "The HTTP request body could not be parsed as JSON.",
      baseError: error,
      api: {
        status: 400,
        message: "Invalid request body",
      },
    });
  }
}

export class VALIDATION_FAILED extends PlatformError {
  constructor(message: string, details?: string) {
    super({
      source,
      code: HTTP_REQUEST_ERROR_CODES.VALIDATION_FAILED,
      message,
      details,
      api: {
        status: 400,
        message,
        details,
      },
    });
  }
}

export class RESOURCE_ID_REQUIRED extends PlatformError {
  constructor(resource: string) {
    super({
      source,
      code: HTTP_REQUEST_ERROR_CODES.RESOURCE_ID_REQUIRED,
      message: `${resource} is required`,
      meta: { resource },
      api: {
        status: 400,
        message: `${resource} is required`,
      },
    });
  }
}

export class RESOURCE_NOT_FOUND extends PlatformError {
  constructor(message: string) {
    super({
      source,
      code: HTTP_REQUEST_ERROR_CODES.RESOURCE_NOT_FOUND,
      message,
      api: {
        status: 404,
        message,
      },
    });
  }
}

export class RESOURCE_CONFLICT extends PlatformError {
  constructor(message: string, details?: string) {
    super({
      source,
      code: HTTP_REQUEST_ERROR_CODES.RESOURCE_CONFLICT,
      message,
      details,
      api: {
        status: 409,
        message,
        details,
      },
    });
  }
}

export class FORBIDDEN extends PlatformError {
  constructor(message: string, details?: string) {
    super({
      source,
      code: HTTP_REQUEST_ERROR_CODES.FORBIDDEN,
      message,
      details,
      api: {
        status: 403,
        message,
        details,
      },
    });
  }
}
