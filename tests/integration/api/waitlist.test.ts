import { assertEquals } from "@std/assert";
import { createMockContext } from "../../test_app.ts";
import { ensureInitialized, resetDb, drizzleClient } from "../../test_helpers.ts";
import { waitlistRequest } from "@/persistence/drizzle/entity/waitlist-request.entity.ts";
import { WaitlistRequestRepository } from "@/persistence/drizzle/repository/waitlist-request.repository.ts";

const { default: waitlistRouter, setWaitlistRepoForTests } = await import(
  "@/http/v1/waitlist/routes.ts"
);

const routes = [...waitlistRouter];
const waitlistRoute = routes.find(
  (r) => r.path === "/waitlist" && r.methods.includes("POST"),
);

// deno-lint-ignore no-explicit-any
let handler: any;

async function setup() {
  await ensureInitialized();
  await resetDb();
  const repo = new WaitlistRequestRepository(drizzleClient);
  setWaitlistRepoForTests(repo);
  handler = waitlistRoute!.middleware[0];
}

// ── Validation ──────────────────────────────────────────────────────────

Deno.test("waitlist - returns 400 for missing email", async () => {
  await setup();
  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: "/waitlist",
    body: { walletPublicKey: "GABC" },
  });
  await handler(ctx);
  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "Invalid email");
});

Deno.test("waitlist - returns 400 for invalid email", async () => {
  await setup();
  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: "/waitlist",
    body: { email: "not-an-email" },
  });
  await handler(ctx);
  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "Invalid email");
});

Deno.test("waitlist - returns 400 for email over 254 chars", async () => {
  await setup();
  const longEmail = "a".repeat(250) + "@b.co";
  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: "/waitlist",
    body: { email: longEmail },
  });
  await handler(ctx);
  const res = getResponse();
  assertEquals(res.status, 400);
});

// ── Success ─────────────────────────────────────────────────────────────

Deno.test("waitlist - returns 201 and persists new request", async () => {
  await setup();
  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: "/waitlist",
    body: { email: "alice@example.com", walletPublicKey: "GABCDEF" },
  });
  await handler(ctx);
  const res = getResponse();
  assertEquals(res.status, 201);
  assertEquals(res.body.message, "Added to waitlist");

  const rows = await drizzleClient.select().from(waitlistRequest);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].email, "alice@example.com");
  assertEquals(rows[0].walletPublicKey, "GABCDEF");
  assertEquals(rows[0].source, "council-console");
});

Deno.test("waitlist - returns 201 without walletPublicKey", async () => {
  await setup();
  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: "/waitlist",
    body: { email: "bob@example.com" },
  });
  await handler(ctx);
  const res = getResponse();
  assertEquals(res.status, 201);

  const rows = await drizzleClient.select().from(waitlistRequest);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].walletPublicKey, null);
});

// ── Dedup ───────────────────────────────────────────────────────────────

Deno.test("waitlist - returns 200 on duplicate wallet and updates email", async () => {
  await setup();

  const { ctx: ctx1, getResponse: getRes1 } = createMockContext({
    method: "POST",
    path: "/waitlist",
    body: { email: "first@example.com", walletPublicKey: "GDUP" },
  });
  await handler(ctx1);
  assertEquals(getRes1().status, 201);

  const { ctx: ctx2, getResponse: getRes2 } = createMockContext({
    method: "POST",
    path: "/waitlist",
    body: { email: "updated@example.com", walletPublicKey: "GDUP" },
  });
  await handler(ctx2);
  assertEquals(getRes2().status, 200);

  const rows = await drizzleClient.select().from(waitlistRequest);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].email, "updated@example.com");
});
