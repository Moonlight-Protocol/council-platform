/**
 * Integration tests for admin auth API routes.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/admin-auth.test.ts
 */
import { assertEquals, assertExists } from "@std/assert";
import { createMockContext } from "../../test_app.ts";
import { ensureInitialized } from "../../test_helpers.ts";
import { Keypair } from "stellar-sdk";
import { Buffer } from "buffer";

// Import the actual route handlers
import { postChallengeHandler } from "@/http/v1/admin/auth/challenge.ts";
import { postVerifyHandler } from "@/http/v1/admin/auth/verify.ts";
import { _TEST_COUNCIL_KEYPAIR } from "../../mock_env.ts";

// ---------------------------------------------------------------------------
// POST /admin/auth/challenge
// ---------------------------------------------------------------------------

Deno.test("POST /admin/auth/challenge - returns a nonce", async () => {
  await ensureInitialized();

  const pk = _TEST_COUNCIL_KEYPAIR.publicKey();
  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { publicKey: pk },
  });

  await postChallengeHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.message, "Challenge created");
  assertExists(res.body.data.nonce);
  assertEquals(typeof res.body.data.nonce, "string");
});

Deno.test("POST /admin/auth/challenge - rejects missing publicKey", async () => {
  await ensureInitialized();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {},
  });

  await postChallengeHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "publicKey is required");
});

Deno.test("POST /admin/auth/challenge - rejects invalid Stellar key format", async () => {
  await ensureInitialized();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { publicKey: "not-a-stellar-key" },
  });

  await postChallengeHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "Invalid Stellar public key format");
});

// ---------------------------------------------------------------------------
// POST /admin/auth/verify
// ---------------------------------------------------------------------------

Deno.test("POST /admin/auth/verify - valid signature returns JWT", async () => {
  await ensureInitialized();

  // Step 1: get a challenge
  const pk = _TEST_COUNCIL_KEYPAIR.publicKey();
  const challengeCtx = createMockContext({
    method: "POST",
    body: { publicKey: pk },
  });
  await postChallengeHandler(challengeCtx.ctx);
  const nonce = challengeCtx.getResponse().body.data.nonce;

  // Step 2: sign the nonce (raw format)
  const nonceBuffer = Buffer.from(nonce, "base64");
  const sigBuffer = _TEST_COUNCIL_KEYPAIR.sign(nonceBuffer);
  const signature = Buffer.from(sigBuffer).toString("base64");

  // Step 3: verify
  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { nonce, signature, publicKey: pk },
  });

  await postVerifyHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.message, "Authentication successful");
  assertExists(res.body.data.token);
  // Token should be a mock JWT (from mock_jwt.ts)
  assertEquals(typeof res.body.data.token, "string");
});

Deno.test("POST /admin/auth/verify - invalid signature returns 401", async () => {
  await ensureInitialized();

  const pk = _TEST_COUNCIL_KEYPAIR.publicKey();
  const challengeCtx = createMockContext({
    method: "POST",
    body: { publicKey: pk },
  });
  await postChallengeHandler(challengeCtx.ctx);
  const nonce = challengeCtx.getResponse().body.data.nonce;

  // Sign with a different key
  const wrongKey = Keypair.random();
  const nonceBuffer = Buffer.from(nonce, "base64");
  const sigBuffer = wrongKey.sign(nonceBuffer);
  const signature = Buffer.from(sigBuffer).toString("base64");

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { nonce, signature, publicKey: pk },
  });

  await postVerifyHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 401);
  assertEquals(res.body.message, "Authentication failed");
});

Deno.test("POST /admin/auth/verify - rejects missing fields", async () => {
  await ensureInitialized();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { nonce: "some-nonce" },
  });

  await postVerifyHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(
    res.body.message,
    "nonce, signature, and publicKey are required",
  );
});
