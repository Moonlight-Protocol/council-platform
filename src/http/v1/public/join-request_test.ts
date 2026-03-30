import { assertEquals } from "jsr:@std/assert";
import { Keypair } from "stellar-sdk";

const API = "http://localhost:3015/api/v1";

async function post(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

Deno.test("join-request: rejects missing publicKey", async () => {
  const { status, body } = await post("/public/provider/join-request", {});
  assertEquals(status, 400);
  assertEquals(body.message, "publicKey is required");
});

Deno.test("join-request: rejects invalid Stellar key format", async () => {
  const { status, body } = await post("/public/provider/join-request", { publicKey: "not-a-key" });
  assertEquals(status, 400);
  assertEquals(body.message, "Invalid Stellar public key format");
});

Deno.test("join-request: rejects label over 200 chars", async () => {
  const kp = Keypair.random();
  const { status, body } = await post("/public/provider/join-request", {
    publicKey: kp.publicKey(),
    label: "x".repeat(201),
  });
  assertEquals(status, 400);
  assertEquals(body.message, "label must be at most 200 characters");
});

Deno.test("join-request: rejects jurisdictions over 50 entries", async () => {
  const kp = Keypair.random();
  const { status, body } = await post("/public/provider/join-request", {
    publicKey: kp.publicKey(),
    jurisdictions: Array(51).fill("XX"),
  });
  assertEquals(status, 400);
  assertEquals(body.message, "jurisdictions must have at most 50 entries");
});

Deno.test("join-request: rejects non-HTTP callbackEndpoint", async () => {
  const kp = Keypair.random();
  const { status, body } = await post("/public/provider/join-request", {
    publicKey: kp.publicKey(),
    callbackEndpoint: "file:///etc/passwd",
  });
  assertEquals(status, 400);
  assertEquals(body.message, "callbackEndpoint must be a valid HTTP(S) URL");
});

Deno.test("join-request: rejects callbackEndpoint over 500 chars", async () => {
  const kp = Keypair.random();
  const { status, body } = await post("/public/provider/join-request", {
    publicKey: kp.publicKey(),
    callbackEndpoint: "https://example.com/" + "a".repeat(500),
  });
  assertEquals(status, 400);
  assertEquals(body.message, "callbackEndpoint must be at most 500 characters");
});

Deno.test("join-request: accepts valid minimal request", async () => {
  const kp = Keypair.random();
  const { status, body } = await post("/public/provider/join-request", {
    publicKey: kp.publicKey(),
  });
  assertEquals(status, 200);
  assertEquals(body.message, "Join request submitted");
});

Deno.test("join-request: rejects duplicate pending request", async () => {
  const kp = Keypair.random();
  await post("/public/provider/join-request", { publicKey: kp.publicKey() });
  const { status } = await post("/public/provider/join-request", { publicKey: kp.publicKey() });
  assertEquals(status, 409);
});
