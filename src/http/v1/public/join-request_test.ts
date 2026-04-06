import { assertEquals } from "jsr:@std/assert";
import { Keypair } from "stellar-sdk";
import { createPostJoinRequestHandler } from "./join-request.ts";

const TEST_COUNCIL_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

// Mock repo — validation tests never reach the DB calls
// deno-lint-ignore no-explicit-any
const mockRepo = {} as any;
const handler = createPostJoinRequestHandler(mockRepo);

// deno-lint-ignore no-explicit-any
function createMockContext(body: unknown): any {
  return {
    request: {
      body: { json: () => Promise.resolve(body) },
      url: new URL("http://localhost:3015/api/v1/public/provider/join-request"),
    },
    response: {
      status: 0,
      body: {} as Record<string, unknown>,
    },
  };
}

Deno.test("join-request: rejects missing councilId", async () => {
  const kp = Keypair.random();
  const ctx = createMockContext({ publicKey: kp.publicKey() });
  await handler(ctx);
  assertEquals(ctx.response.status, 400);
  assertEquals(ctx.response.body.message, "councilId is required");
});

Deno.test("join-request: rejects missing publicKey", async () => {
  const ctx = createMockContext({ councilId: TEST_COUNCIL_ID });
  await handler(ctx);
  assertEquals(ctx.response.status, 400);
  assertEquals(ctx.response.body.message, "publicKey is required");
});

Deno.test("join-request: rejects invalid Stellar key format", async () => {
  const ctx = createMockContext({ councilId: TEST_COUNCIL_ID, publicKey: "not-a-key" });
  await handler(ctx);
  assertEquals(ctx.response.status, 400);
  assertEquals(ctx.response.body.message, "Invalid Stellar public key format");
});

Deno.test("join-request: rejects label over 200 chars", async () => {
  const kp = Keypair.random();
  const ctx = createMockContext({
    councilId: TEST_COUNCIL_ID,
    publicKey: kp.publicKey(),
    label: "x".repeat(201),
  });
  await handler(ctx);
  assertEquals(ctx.response.status, 400);
  assertEquals(ctx.response.body.message, "label must be at most 200 characters");
});

Deno.test("join-request: rejects jurisdictions over 50 entries", async () => {
  const kp = Keypair.random();
  const ctx = createMockContext({
    councilId: TEST_COUNCIL_ID,
    publicKey: kp.publicKey(),
    jurisdictions: Array(51).fill("XX"),
  });
  await handler(ctx);
  assertEquals(ctx.response.status, 400);
  assertEquals(ctx.response.body.message, "jurisdictions must have at most 50 entries");
});

Deno.test("join-request: rejects non-HTTP callbackEndpoint", async () => {
  const kp = Keypair.random();
  const ctx = createMockContext({
    councilId: TEST_COUNCIL_ID,
    publicKey: kp.publicKey(),
    callbackEndpoint: "file:///etc/passwd",
  });
  await handler(ctx);
  assertEquals(ctx.response.status, 400);
  assertEquals(ctx.response.body.message, "callbackEndpoint must be a valid HTTP(S) URL");
});

Deno.test("join-request: rejects callbackEndpoint over 500 chars", async () => {
  const kp = Keypair.random();
  const ctx = createMockContext({
    councilId: TEST_COUNCIL_ID,
    publicKey: kp.publicKey(),
    callbackEndpoint: "https://example.com/" + "a".repeat(500),
  });
  await handler(ctx);
  assertEquals(ctx.response.status, 400);
  assertEquals(ctx.response.body.message, "callbackEndpoint must be at most 500 characters");
});
