/**
 * Integration tests for CORS, rate limit, JWT auth, and requireAdmin middleware.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/middleware.test.ts
 */
import { assertEquals } from "@std/assert";
import { createMockContext } from "../../test_app.ts";
import { createAdminJwt, createProviderJwt } from "../../test_jwt.ts";

import { corsMiddleware } from "@/http/middleware/cors.ts";
import { createRateLimitMiddleware } from "@/http/middleware/rate-limit/index.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";
import { requireAdminMiddleware } from "@/http/middleware/auth/require-admin.ts";

// ---------------------------------------------------------------------------
// CORS middleware
// ---------------------------------------------------------------------------

Deno.test("CORS - allows production origins", async () => {
  const { ctx, getResponse } = createMockContext({
    method: "GET",
    headers: { "Origin": "https://moonlight-council-console.fly.storage.tigris.dev" },
  });

  const next = async () => {
    ctx.response.status = 200;
    ctx.response.body = "ok";
  };
  await corsMiddleware(ctx, next);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(
    res.headers.get("Access-Control-Allow-Origin"),
    "https://moonlight-council-console.fly.storage.tigris.dev",
  );
});

Deno.test("CORS - allows dev origins in development mode", async () => {
  const { ctx, getResponse } = createMockContext({
    method: "GET",
    headers: { "Origin": "http://localhost:3000" },
  });

  const next = async () => {
    ctx.response.status = 200;
    ctx.response.body = "ok";
  };
  await corsMiddleware(ctx, next);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000");
});

Deno.test("CORS - blocks unknown origins", async () => {
  const { ctx, getResponse } = createMockContext({
    method: "GET",
    headers: { "Origin": "https://evil.com" },
  });

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

  const next = async () => {
    ctx.response.status = 200;
    ctx.response.body = "should not reach here";
  };
  await corsMiddleware(ctx, next);

  const res = getResponse();
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000");
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "GET, POST, PUT, DELETE, OPTIONS");
});

// ---------------------------------------------------------------------------
// Rate limit middleware
// ---------------------------------------------------------------------------

Deno.test("rate limit - allows requests under limit", async () => {
  const middleware = createRateLimitMiddleware(5, 60_000);

  const { ctx, getResponse } = createMockContext({ method: "GET" });
  let nextCalled = false;
  const next = async () => {
    nextCalled = true;
    ctx.response.status = 200;
    ctx.response.body = "ok";
  };

  await middleware(ctx, next);

  assertEquals(nextCalled, true);
  assertEquals(getResponse().status, 200);
});

Deno.test("rate limit - blocks requests over limit", async () => {
  const middleware = createRateLimitMiddleware(3, 60_000);

  // Make 3 requests (all under limit)
  for (let i = 0; i < 3; i++) {
    const { ctx } = createMockContext({ method: "GET" });
    const next = async () => {
      ctx.response.status = 200;
    };
    await middleware(ctx, next);
  }

  // 4th request should be rate limited
  const { ctx, getResponse } = createMockContext({ method: "GET" });
  let nextCalled = false;
  const next = async () => {
    nextCalled = true;
    ctx.response.status = 200;
  };
  await middleware(ctx, next);

  assertEquals(nextCalled, false);
  const res = getResponse();
  assertEquals(res.status, 429);
});

// ---------------------------------------------------------------------------
// JWT middleware
// ---------------------------------------------------------------------------

Deno.test("jwtMiddleware - rejects missing Authorization header", async () => {
  const { ctx, getResponse } = createMockContext({ method: "GET" });
  let nextCalled = false;
  await jwtMiddleware(ctx, async () => { nextCalled = true; });

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
  await jwtMiddleware(ctx, async () => { nextCalled = true; });

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
  await jwtMiddleware(ctx, async () => { nextCalled = true; });

  assertEquals(nextCalled, false);
  const res = getResponse();
  assertEquals(res.status, 401);
  assertEquals(res.body.message, "JWT verification failed");
});

Deno.test("jwtMiddleware - accepts valid admin JWT and sets session", async () => {
  const token = await createAdminJwt("GPUBLICKEYTEST1234");
  const { ctx } = createMockContext({
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` },
  });
  let nextCalled = false;
  await jwtMiddleware(ctx, async () => { nextCalled = true; });

  assertEquals(nextCalled, true);
  assertEquals(ctx.state.session.type, "admin");
  assertEquals(ctx.state.session.sub, "GPUBLICKEYTEST1234");
});

Deno.test("jwtMiddleware - accepts valid provider JWT and sets session", async () => {
  const token = await createProviderJwt("GPROVIDERPUBKEY5678");
  const { ctx } = createMockContext({
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` },
  });
  let nextCalled = false;
  await jwtMiddleware(ctx, async () => { nextCalled = true; });

  assertEquals(nextCalled, true);
  assertEquals(ctx.state.session.type, "provider");
  assertEquals(ctx.state.session.sub, "GPROVIDERPUBKEY5678");
});

// ---------------------------------------------------------------------------
// requireAdminMiddleware
// ---------------------------------------------------------------------------

Deno.test("requireAdminMiddleware - allows admin session", async () => {
  const { ctx } = createMockContext({
    state: { session: { type: "admin" } },
  });
  let nextCalled = false;
  await requireAdminMiddleware(ctx, async () => { nextCalled = true; });

  assertEquals(nextCalled, true);
});

Deno.test("requireAdminMiddleware - rejects provider session", async () => {
  const { ctx, getResponse } = createMockContext({
    state: { session: { type: "provider" } },
  });
  let nextCalled = false;
  await requireAdminMiddleware(ctx, async () => { nextCalled = true; });

  assertEquals(nextCalled, false);
  const res = getResponse();
  assertEquals(res.status, 403);
  assertEquals(res.body.message, "Admin access required");
});

Deno.test("requireAdminMiddleware - rejects missing session", async () => {
  const { ctx, getResponse } = createMockContext({});
  let nextCalled = false;
  await requireAdminMiddleware(ctx, async () => { nextCalled = true; });

  assertEquals(nextCalled, false);
  const res = getResponse();
  assertEquals(res.status, 403);
  assertEquals(res.body.message, "Admin access required");
});
