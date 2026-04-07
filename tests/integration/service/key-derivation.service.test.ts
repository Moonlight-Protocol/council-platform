/**
 * Integration tests for the key derivation service.
 *
 * These tests load the per-council derivation root from the DB, so they
 * require PGlite + a seeded council.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/service/key-derivation.service.test.ts
 */
import { assertEquals, assert } from "@std/assert";
import { p256 } from "@noble/curves/p256";
import {
  deriveP256Keypair,
  deriveP256PublicKey,
  signWithDerivedKey,
} from "@/core/service/custody/key-derivation.service.ts";
import {
  ensureInitialized,
  resetDb,
  seedCouncilWithRoot,
} from "../../test_helpers.ts";

const COUNCIL_ID = "default";
const CHANNEL = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4";
const USER = "test-user-123";

async function seedDefaultCouncil() {
  await ensureInitialized();
  await resetDb();
  await seedCouncilWithRoot({ id: COUNCIL_ID });
}

// ── deriveP256PublicKey ──────────────────────────────────────────────────

Deno.test("deriveP256PublicKey - returns consistent key for same inputs", async () => {
  await seedDefaultCouncil();

  const first = await deriveP256PublicKey(COUNCIL_ID, CHANNEL, USER, 0);
  const second = await deriveP256PublicKey(COUNCIL_ID, CHANNEL, USER, 0);

  assertEquals(first, second);
});

Deno.test("deriveP256PublicKey - returns different keys for different indices", async () => {
  await seedDefaultCouncil();

  const key0 = await deriveP256PublicKey(COUNCIL_ID, CHANNEL, USER, 0);
  const key1 = await deriveP256PublicKey(COUNCIL_ID, CHANNEL, USER, 1);

  assert(
    !uint8ArrayEquals(key0, key1),
    "Keys at different indices must differ",
  );
});

Deno.test("deriveP256PublicKey - returns different keys for different channels", async () => {
  await seedDefaultCouncil();

  const channelA = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4";
  const channelB = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBKJN6";

  const keyA = await deriveP256PublicKey(COUNCIL_ID, channelA, USER, 0);
  const keyB = await deriveP256PublicKey(COUNCIL_ID, channelB, USER, 0);

  assert(
    !uint8ArrayEquals(keyA, keyB),
    "Keys for different channels must differ",
  );
});

Deno.test("deriveP256PublicKey - returns different keys for different users", async () => {
  await seedDefaultCouncil();

  const keyAlice = await deriveP256PublicKey(COUNCIL_ID, CHANNEL, "alice", 0);
  const keyBob = await deriveP256PublicKey(COUNCIL_ID, CHANNEL, "bob", 0);

  assert(
    !uint8ArrayEquals(keyAlice, keyBob),
    "Keys for different users must differ",
  );
});

Deno.test("deriveP256PublicKey - returns different keys for different councils", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilWithRoot({ id: "council-a" });
  await seedCouncilWithRoot({ id: "council-b" });

  const keyA = await deriveP256PublicKey("council-a", CHANNEL, USER, 0);
  const keyB = await deriveP256PublicKey("council-b", CHANNEL, USER, 0);

  assert(
    !uint8ArrayEquals(keyA, keyB),
    "Keys for different councils must differ",
  );
});

Deno.test("deriveP256PublicKey - returns uncompressed P256 key (65 bytes, starts with 0x04)", async () => {
  await seedDefaultCouncil();

  const key = await deriveP256PublicKey(COUNCIL_ID, CHANNEL, USER, 42);

  assertEquals(key.length, 65, "Uncompressed P256 public key must be 65 bytes");
  assertEquals(key[0], 0x04, "Uncompressed key must start with 0x04 prefix");
});

// ── signWithDerivedKey ──────────────────────────────────────────────────

Deno.test("signWithDerivedKey - produces a DER-encoded signature", async () => {
  await seedDefaultCouncil();

  const message = new Uint8Array([1, 2, 3, 4]);
  const sig = await signWithDerivedKey(COUNCIL_ID, CHANNEL, USER, 0, message);

  // DER signatures start with 0x30 (SEQUENCE tag)
  assertEquals(sig[0], 0x30, "DER signature must start with SEQUENCE tag 0x30");
  // Second byte is the length of the remaining data
  assertEquals(sig.length, sig[1] + 2, "DER length must match actual signature length");
});

Deno.test("signWithDerivedKey - signature is verifiable with the derived public key", async () => {
  await seedDefaultCouncil();

  const pubKey = await deriveP256PublicKey(COUNCIL_ID, CHANNEL, USER, 0);
  const message = new Uint8Array([1, 2, 3, 4]);
  const sig = await signWithDerivedKey(COUNCIL_ID, CHANNEL, USER, 0, message);

  const valid = p256.verify(sig, message, pubKey);
  assert(valid, "Signature must verify against the derived public key");
});

// ── deriveP256Keypair ───────────────────────────────────────────────────

Deno.test("deriveP256Keypair - returns 32-byte private key and 65-byte public key", async () => {
  await seedDefaultCouncil();

  const { privateKey, publicKey } = await deriveP256Keypair(COUNCIL_ID, CHANNEL, USER, 0);

  assertEquals(privateKey.length, 32, "Private key must be 32 bytes");
  assertEquals(publicKey.length, 65, "Public key must be 65 bytes (uncompressed)");
  assertEquals(publicKey[0], 0x04, "Public key must start with 0x04 prefix");
});

// ── helpers ─────────────────────────────────────────────────────────────

function uint8ArrayEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
