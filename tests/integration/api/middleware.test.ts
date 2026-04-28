/**
 * Integration tests for CORS and JWT auth middleware.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/middleware.test.ts
 */
import { assertEquals } from "@std/assert";
import { createMockContext } from "../../test_app.ts";
import { createWalletJwt } from "../../test_jwt.ts";

import { corsMiddleware } from "@/http/middleware/cors.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";

// ---------------------------------------------------------------------------
// CORS middleware
// ---------------------------------------------------------------------------

Deno.test("CORS - allows origins from ALLOWED_ORIGINS env var", async () => {
  // ALLOWED_ORIGINS is read at module load time, so this test relies on
  // the env var being set before the module is imported. The test runner
  // sets MODE=development which adds localhost origins. For production
  // origins, ALLOWED_ORIGINS must be set in the environment.
  // This test verifies that dev origins work (since MODE=development in tests).
  const { ctx, getResponse } = createMockContext({
    method: "GET",
    headers: { "Origin": "http://localhost:3030" },
  });

  // deno-lint-ignore require-await -- mock satisfies oak Next() => Promise<unknown>
  const next = async () => {
    ctx.response.status = 200;
    ctx.response.body = "ok";
  };
  await corsMiddleware(ctx, next);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(
    res.headers.get("Access-Control-Allow-Origin"),
    "http://localhost:3030",
  );
});

Deno.test("CORS - allows dev origins in development mode", async () => {
  const { ctx, getResponse } = createMockContext({
    method: "GET",
    headers: { "Origin": "http://localhost:3000" },
  });

  // deno-lint-ignore require-await -- mock satisfies oak Next() => Promise<unknown>
  const next = async () => {
    ctx.response.status = 200;
    ctx.response.body = "ok";
  };
  await corsMiddleware(ctx, next);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(
    res.headers.get("Access-Control-Allow-Origin"),
    "http://localhost:3000",
  );
});

Deno.test("CORS - blocks unknown origins", async () => {
  const { ctx, getResponse } = createMockContext({
    method: "GET",
    headers: { "Origin": "https://evil.com" },
  });

  // deno-lint-ignore require-await -- mock satisfies oak Next() => Promise<unknown>
  const next = async () => {
    ctx.response.status = 200;
    ctx.response.body = "ok";
  };
  await corsMiddleware(ctx, next);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), undefined);
});

Deno.test("CORS - OPTIONS preflight returns 204 for allowed origin", async () => {
  const { ctx, getResponse } = createMockContext({
    method: "OPTIONS",
    headers: { "Origin": "http://localhost:3000" },
  });

  // deno-lint-ignore require-await -- mock satisfies oak Next() => Promise<unknown>
  const next = async () => {
    ctx.response.status = 200;
    ctx.response.body = "should not reach here";
  };
  await corsMiddleware(ctx, next);

  const res = getResponse();
  assertEquals(res.status, 204);
  assertEquals(
    res.headers.get("Access-Control-Allow-Origin"),
    "http://localhost:3000",
  );
  assertEquals(
    res.headers.get("Access-Control-Allow-Methods"),
    "GET, POST, PUT, DELETE, OPTIONS",
  );
});

Deno.test("CORS - allows localhost:3030 in development mode", async () => {
  const { ctx, getResponse } = createMockContext({
    method: "GET",
    headers: { "Origin": "http://localhost:3030" },
  });

  // deno-lint-ignore require-await -- mock satisfies oak Next() => Promise<unknown>
  const next = async () => {
    ctx.response.status = 200;
    ctx.response.body = "ok";
  };
  await corsMiddleware(ctx, next);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(
    res.headers.get("Access-Control-Allow-Origin"),
    "http://localhost:3030",
  );
});

Deno.test("CORS - allows arbitrary localhost port in development mode", async () => {
  const { ctx, getResponse } = createMockContext({
    method: "GET",
    headers: { "Origin": "http://localhost:9999" },
  });

  // deno-lint-ignore require-await -- mock satisfies oak Next() => Promise<unknown>
  const next = async () => {
    ctx.response.status = 200;
    ctx.response.body = "ok";
  };
  await corsMiddleware(ctx, next);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(
    res.headers.get("Access-Control-Allow-Origin"),
    "http://localhost:9999",
  );
});

// ---------------------------------------------------------------------------
// JWT middleware
// ---------------------------------------------------------------------------

Deno.test("jwtMiddleware - rejects missing Authorization header", async () => {
  const { ctx, getResponse } = createMockContext({ method: "GET" });
  let nextCalled = false;
  // deno-lint-ignore require-await -- mock satisfies oak Next() => Promise<unknown>
  await jwtMiddleware(ctx, async () => {
    nextCalled = true;
  });

  assertEquals(nextCalled, false);
  const res = getResponse();
  assertEquals(res.status, 401);
  assertEquals(res.body.message, "Missing authorization header");
});

Deno.test("jwtMiddleware - rejects invalid Authorization format", async () => {
  const { ctx, getResponse } = createMockContext({
    method: "GET",
    headers: { "Authorization": "Basic abc123" },
  });
  let nextCalled = false;
  // deno-lint-ignore require-await -- mock satisfies oak Next() => Promise<unknown>
  await jwtMiddleware(ctx, async () => {
    nextCalled = true;
  });

  assertEquals(nextCalled, false);
  const res = getResponse();
  assertEquals(res.status, 401);
  assertEquals(res.body.message, "Invalid authorization header");
});

Deno.test("jwtMiddleware - rejects invalid JWT token", async () => {
  const { ctx, getResponse } = createMockContext({
    method: "GET",
    headers: { "Authorization": "Bearer not.a.valid.jwt" },
  });
  let nextCalled = false;
  // deno-lint-ignore require-await -- mock satisfies oak Next() => Promise<unknown>
  await jwtMiddleware(ctx, async () => {
    nextCalled = true;
  });

  assertEquals(nextCalled, false);
  const res = getResponse();
  assertEquals(res.status, 401);
  assertEquals(res.body.message, "JWT verification failed");
});

Deno.test("jwtMiddleware - accepts valid wallet JWT and sets session", async () => {
  const token = await createWalletJwt("GPUBLICKEYTEST1234");
  const { ctx } = createMockContext({
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` },
  });
  let nextCalled = false;
  // deno-lint-ignore require-await -- mock satisfies oak Next() => Promise<unknown>
  await jwtMiddleware(ctx, async () => {
    nextCalled = true;
  });

  assertEquals(nextCalled, true);
  assertEquals(ctx.state.session.sub, "GPUBLICKEYTEST1234");
});
