/**
 * Integration tests for the health route.
 *
 * The health handler is defined inline on the healthRouter in
 * src/http/v1/health/routes.ts and is not exported separately.
 * We verify the router has the expected route registered with the
 * correct method.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/health.test.ts
 */
import { assertEquals } from "@std/assert";

import healthRouter from "@/http/v1/health/routes.ts";

Deno.test("healthRouter registers GET /health", () => {
  const routes = [...healthRouter];
  const healthRoute = routes.find(
    (r) => r.path === "/health" && r.methods.includes("GET"),
  );
  assertEquals(
    healthRoute !== undefined,
    true,
    "GET /health should be registered on the router",
  );
});

Deno.test("healthRouter has exactly one route", () => {
  const routes = [...healthRouter];
  assertEquals(routes.length, 1, "healthRouter should have exactly 1 route");
});
