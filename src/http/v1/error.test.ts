import { assertEquals, assertInstanceOf } from "@std/assert";
import type { ErrorResponse } from "@/http/default-schemas.ts";
import { PlatformError } from "@/error/index.ts";
import * as E from "@/http/v1/error.ts";
import * as AuthE from "@/core/service/auth/error.ts";

// The edge translation the global errorMiddleware applies (see
// P_ErrorToApiResponse): any thrown error → the structured
// `{ status, code, message, details? }` ErrorResponse, redacting non-platform
// errors to a generic 500.
function toApi(error: unknown): ErrorResponse {
  return PlatformError.is(error)
    ? error.getAPIError()
    : PlatformError.fromUnknown(error).getAPIError();
}

Deno.test("VALIDATION_FAILED - is a PlatformError with a 400 code", () => {
  const err = new E.VALIDATION_FAILED("countryCode is required");
  assertInstanceOf(err, PlatformError);
  assertInstanceOf(err, Error);
  assertEquals(err.code, "HTTP_REQ_002");
  const api = err.getAPIError();
  assertEquals(api.status, 400);
  assertEquals(api.message, "countryCode is required");
});

Deno.test("RESOURCE_ID_REQUIRED - templates the resource into the message", () => {
  const err = new E.RESOURCE_ID_REQUIRED("Channel ID");
  assertEquals(err.code, "HTTP_REQ_003");
  assertEquals(err.getAPIError().message, "Channel ID is required");
});

Deno.test("RESOURCE_NOT_FOUND - 404", () => {
  const api = new E.RESOURCE_NOT_FOUND("Channel not found").getAPIError();
  assertEquals(api.status, 404);
  assertEquals(api.message, "Channel not found");
});

Deno.test("RESOURCE_CONFLICT - 409", () => {
  const api = new E.RESOURCE_CONFLICT("Already exists").getAPIError();
  assertEquals(api.status, 409);
});

Deno.test("FORBIDDEN - 403", () => {
  const err = new E.FORBIDDEN("Not authorized to sign for this user");
  assertEquals(err.code, "HTTP_REQ_006");
  assertEquals(err.getAPIError().status, 403);
});

Deno.test("INVALID_REQUEST_BODY - wraps the parse error as the cause", () => {
  const cause = new SyntaxError("Unexpected end of JSON input");
  const err = new E.INVALID_REQUEST_BODY(cause);
  assertEquals(err.code, "HTTP_REQ_001");
  assertEquals(err.getAPIError().status, 400);
  // The original is preserved on the native cause chain for logs/OTel, never
  // in the redacted api projection.
  assertEquals((err as Error & { cause?: unknown }).cause, cause);
  assertEquals(err.getAPIError().details, undefined);
});

Deno.test("COUNCIL_AUTH INVALID_SIGNATURE - redacts internal detail behind a 401 code", () => {
  const err = new AuthE.INVALID_SIGNATURE(new Error("bad DER bytes"));
  assertEquals(err.code, "COUNCIL_AUTH_005");
  const api = err.getAPIError();
  assertEquals(api.status, 401);
  assertEquals(api.message, "Invalid signature");
});

Deno.test("edge translation - a PlatformError maps to its own api projection", () => {
  const res = toApi(new E.RESOURCE_NOT_FOUND("Channel not found"));
  assertEquals(res, {
    status: 404,
    code: "HTTP_REQ_004",
    message: "Channel not found",
    details: undefined,
  });
});

Deno.test("edge translation - an unknown raw error is redacted to a generic 500", () => {
  const res = toApi(new Error("stack-y internal detail with secrets"));
  assertEquals(res.status, 500);
  assertEquals(res.code, "GEN_001");
  assertEquals(res.message, "Internal server error.");
});
