// deno-lint-ignore-file no-explicit-any
/**
 * Mock Oak context helpers for API integration tests.
 *
 * Instead of starting a real HTTP server, we create mock Oak contexts
 * and call route handlers directly — same pattern as provider-platform.
 */

export type MockResponse = { status: number; body: any; headers: Map<string, string> };

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
            return Promise.reject(new SyntaxError("Unexpected end of JSON input"));
          }
          return Promise.resolve(opts.body);
        },
      },
    },
    response: {
      get status() { return responseStatus; },
      set status(s: number) { responseStatus = s; },
      get body() { return responseBody; },
      set body(b: unknown) { responseBody = b; },
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
