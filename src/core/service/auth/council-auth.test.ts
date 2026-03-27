import { assertEquals, assertRejects } from "jsr:@std/assert";
import { Keypair } from "stellar-sdk";
import {
  createCouncilChallenge,
  verifyCouncilChallenge,
  type CouncilAuthConfig,
} from "./council-auth.ts";
import { Buffer } from "buffer";

const TEST_KEYPAIR = Keypair.random();
const TEST_PUBLIC_KEY = TEST_KEYPAIR.publicKey();

const mockGenerateToken = async (_sub: string, _sid: string) =>
  `mock-jwt-${_sub.slice(0, 8)}`;

const AUTH_CONFIG: CouncilAuthConfig = {
  generateToken: mockGenerateToken,
};

function signNonce(keypair: typeof TEST_KEYPAIR, nonce: string): string {
  const nonceBuffer = Buffer.from(nonce, "base64");
  const sigBuffer = keypair.sign(nonceBuffer);
  return sigBuffer.toString("base64");
}

async function signNonceSep53(
  keypair: typeof TEST_KEYPAIR,
  nonce: string,
): Promise<string> {
  const prefix = "Stellar Signed Message:\n";
  const prefixedMessage = Buffer.concat([
    Buffer.from(prefix, "utf-8"),
    Buffer.from(nonce, "utf-8"),
  ]);
  const hash = Buffer.from(
    await crypto.subtle.digest("SHA-256", prefixedMessage),
  );
  const sigBuffer = keypair.sign(hash);
  return sigBuffer.toString("hex");
}

async function signNonceSep43(
  keypair: typeof TEST_KEYPAIR,
  nonce: string,
): Promise<string> {
  const nonceBytes = Buffer.from(nonce, "utf-8");
  const header = Buffer.alloc(6);
  header[0] = 0x00;
  header[1] = 0x00;
  header.writeUInt32BE(nonceBytes.length, 2);
  const payload = Buffer.concat([header, nonceBytes]);
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", payload));
  const sigBuffer = keypair.sign(hash);
  return sigBuffer.toString("base64");
}

Deno.test("createCouncilChallenge - returns a nonce", () => {
  const { nonce } = createCouncilChallenge(TEST_PUBLIC_KEY);
  assertEquals(typeof nonce, "string");
  assertEquals(nonce.length > 0, true);
});

Deno.test("createCouncilChallenge - returns unique nonces", () => {
  const { nonce: nonce1 } = createCouncilChallenge(TEST_PUBLIC_KEY);
  const { nonce: nonce2 } = createCouncilChallenge(TEST_PUBLIC_KEY);
  assertEquals(nonce1 !== nonce2, true);
});

Deno.test("verifyCouncilChallenge - rejects unknown nonce", async () => {
  await assertRejects(
    () =>
      verifyCouncilChallenge(
        "unknown-nonce",
        "sig",
        TEST_PUBLIC_KEY,
        AUTH_CONFIG,
      ),
    Error,
    "Challenge not found",
  );
});

Deno.test("verifyCouncilChallenge - rejects wrong public key", async () => {
  const { nonce } = createCouncilChallenge(TEST_PUBLIC_KEY);
  const otherKey = Keypair.random().publicKey();

  await assertRejects(
    () =>
      verifyCouncilChallenge(nonce, "sig", otherKey, AUTH_CONFIG),
    Error,
    "Public key mismatch",
  );
});

Deno.test("verifyCouncilChallenge - rejects short invalid signature", async () => {
  const { nonce } = createCouncilChallenge(TEST_PUBLIC_KEY);
  const badSig = btoa("too-short");

  await assertRejects(
    () =>
      verifyCouncilChallenge(
        nonce,
        badSig,
        TEST_PUBLIC_KEY,
        AUTH_CONFIG,
      ),
    Error,
    "Invalid signature",
  );
});

Deno.test("verifyCouncilChallenge - rejects valid-length but wrong signature", async () => {
  const { nonce } = createCouncilChallenge(TEST_PUBLIC_KEY);
  const wrongSig = signNonce(Keypair.random(), nonce);

  await assertRejects(
    () =>
      verifyCouncilChallenge(
        nonce,
        wrongSig,
        TEST_PUBLIC_KEY,
        AUTH_CONFIG,
      ),
    Error,
    "Invalid signature",
  );
});

Deno.test("verifyCouncilChallenge - valid raw signature + self signer = success", async () => {
  const { nonce } = createCouncilChallenge(TEST_PUBLIC_KEY);
  const signature = signNonce(TEST_KEYPAIR, nonce);

  const { token } = await verifyCouncilChallenge(
    nonce,
    signature,
    TEST_PUBLIC_KEY,
    AUTH_CONFIG,
  );

  assertEquals(typeof token, "string");
  assertEquals(token.length > 0, true);
});

Deno.test("verifyCouncilChallenge - valid signature with different keypair pair = success", async () => {
  // Any valid signature succeeds — the signer authorization check was removed.
  // Test with a completely different keypair to confirm.
  const otherKeypair = Keypair.random();
  const otherPk = otherKeypair.publicKey();
  const { nonce } = createCouncilChallenge(otherPk);
  const signature = signNonce(otherKeypair, nonce);

  const { token } = await verifyCouncilChallenge(
    nonce,
    signature,
    otherPk,
    AUTH_CONFIG,
  );

  assertEquals(typeof token, "string");
  assertEquals(token.length > 0, true);
});

Deno.test("verifyCouncilChallenge - SEP-53 hex signature + self signer = success", async () => {
  const { nonce } = createCouncilChallenge(TEST_PUBLIC_KEY);
  const signature = await signNonceSep53(TEST_KEYPAIR, nonce);

  const { token } = await verifyCouncilChallenge(
    nonce,
    signature,
    TEST_PUBLIC_KEY,
    AUTH_CONFIG,
  );

  assertEquals(typeof token, "string");
  assertEquals(token.length > 0, true);
});

Deno.test("verifyCouncilChallenge - SEP-53 wrong key rejected", async () => {
  const { nonce } = createCouncilChallenge(TEST_PUBLIC_KEY);
  const signature = await signNonceSep53(Keypair.random(), nonce);

  await assertRejects(
    () =>
      verifyCouncilChallenge(
        nonce,
        signature,
        TEST_PUBLIC_KEY,
        AUTH_CONFIG,
      ),
    Error,
    "Invalid signature",
  );
});

Deno.test("verifyCouncilChallenge - SEP-43 signature + self signer = success", async () => {
  const { nonce } = createCouncilChallenge(TEST_PUBLIC_KEY);
  const signature = await signNonceSep43(TEST_KEYPAIR, nonce);

  const { token } = await verifyCouncilChallenge(
    nonce,
    signature,
    TEST_PUBLIC_KEY,
    AUTH_CONFIG,
  );

  assertEquals(typeof token, "string");
  assertEquals(token.length > 0, true);
});

Deno.test("verifyCouncilChallenge - nonce is consumed after use", async () => {
  const { nonce } = createCouncilChallenge(TEST_PUBLIC_KEY);
  const signature = signNonce(TEST_KEYPAIR, nonce);

  // First use succeeds
  await verifyCouncilChallenge(
    nonce,
    signature,
    TEST_PUBLIC_KEY,
    AUTH_CONFIG,
  );

  // Second use fails
  await assertRejects(
    () =>
      verifyCouncilChallenge(
        nonce,
        signature,
        TEST_PUBLIC_KEY,
        AUTH_CONFIG,
      ),
    Error,
    "Challenge not found",
  );
});
