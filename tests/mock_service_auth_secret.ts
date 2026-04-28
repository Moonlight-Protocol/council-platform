/**
 * Mock service auth secret for tests.
 *
 * Replaces @/core/service/auth/service/service-auth-secret.ts to avoid
 * importing env.ts and requiring SERVICE_AUTH_SECRET.
 */

export const authSecret = "test-secret-for-tests";

const keyData = new TextEncoder().encode(authSecret);

export const SERVICE_AUTH_SECRET_AS_CRYPTO_KEY = await crypto.subtle.importKey(
  "raw",
  keyData,
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["verify"],
);

export const SERVICE_AUTH_SECRET_AS_CRYPTO_KEY_SIGNABLE = await crypto.subtle
  .importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify", "sign"],
  );
