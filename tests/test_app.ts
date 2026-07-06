// deno-lint-ignore-file no-explicit-any
/**
 * Mock Oak context helpers for API integration tests.
 *
 * Instead of starting a real HTTP server, we create mock Oak contexts
 * and call route handlers directly — same pattern as provider-platform.
 */

import { PIPE_APIError } from "@/http/pipelines/error-pipeline.ts";
import { newNoop } from "@/utils/logger/index.ts";

/**
 * Run a route handler through the same edge error-translation the global
 * `errorMiddleware` applies in production. Handlers now `throw` structured
 * `PlatformError`s instead of writing ad-hoc bodies, so error paths must go
 * through `PIPE_APIError` to yield the `{ status, code, message, details }`
 * response the client (and these assertions) see. Success paths are unaffected.
 */
export async function runHandler(
  ctx: any,
  handler: (ctx: any) => Promise<void> | void,
): Promise<void> {
  try {
    await handler(ctx);
  } catch (error) {
    await PIPE_APIError(ctx, { log: newNoop() }).run(error as Error);
  }
}

/**
 * Same edge translation as `runHandler`, for middleware under test that now
 * `throw`s structured errors (e.g. `jwtMiddleware`) instead of writing the
 * response itself.
 */
export async function runMiddleware(
  ctx: any,
  middleware: (ctx: any, next: () => Promise<unknown>) => Promise<unknown>,
  next: () => Promise<unknown>,
): Promise<void> {
  try {
    await middleware(ctx, next);
  } catch (error) {
    await PIPE_APIError(ctx, { log: newNoop() }).run(error as Error);
  }
}

export type MockResponse = {
  status: number;
  body: any;
  headers: Map<string, string>;
};

/**
 * Create a mock Oak context for testing route handlers.
 */
export function createMockContext(opts: {
  method?: string;
  path?: string;
  body?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  query?: Record<string, string>;
  state?: Record<string, unknown>;
}): {
  ctx: any;
  getResponse: () => MockResponse;
} {
  let responseStatus = 200;
  let responseBody: unknown = undefined;
  const responseHeaders = new Map<string, string>();

  const url = new URL(`http://test.local${opts.path ?? "/"}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      url.searchParams.set(k, v);
    }
  }

  const requestHeaders = new Headers(opts.headers ?? {});

  const ctx = {
    request: {
      method: opts.method ?? "GET",
      url,
      headers: requestHeaders,
      ip: "127.0.0.1",
      body: {
        json: () => {
          if (opts.body === undefined) {
            return Promise.reject(
              new SyntaxError("Unexpected end of JSON input"),
            );
          }
          return Promise.resolve(opts.body);
        },
      },
    },
    response: {
      get status() {
        return responseStatus;
      },
      set status(s: number) {
        responseStatus = s;
      },
      get body() {
        return responseBody;
      },
      set body(b: unknown) {
        responseBody = b;
      },
      headers: {
        set: (key: string, value: string) => responseHeaders.set(key, value),
        get: (key: string) => responseHeaders.get(key),
      },
    },
    params: opts.params ?? {},
    state: opts.state ?? {},
  };

  return {
    ctx,
    getResponse: () => ({
      status: responseStatus,
      body: responseBody as any,
      headers: responseHeaders,
    }),
  };
}
