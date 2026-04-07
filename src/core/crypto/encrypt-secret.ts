/**
 * Symmetric encryption for storing secrets at rest.
 * Uses AES-256-GCM with a key derived from SERVICE_AUTH_SECRET via PBKDF2.
 *
 * Encrypted output format: base64(salt[16] + iv[12] + ciphertext)
 *
 * Used for per-council derivation roots (random 32 bytes used as the HKDF
 * root for custodial user key derivation).
 */

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const ITERATIONS = 100000;

async function deriveKey(secret: string, salt: BufferSource): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypts a binary secret with the given password and returns a base64 ciphertext. */
export async function encryptSecret(plaintext: Uint8Array, secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await deriveKey(secret, salt);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  // Copy into a fresh ArrayBuffer-backed Uint8Array to satisfy strict BufferSource typing.
  const plaintextBuf = new Uint8Array(plaintext.byteLength);
  plaintextBuf.set(plaintext);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintextBuf),
  );
  const combined = new Uint8Array(salt.length + iv.length + encrypted.length);
  combined.set(salt);
  combined.set(iv, salt.length);
  combined.set(encrypted, salt.length + iv.length);
  return btoa(String.fromCharCode(...combined));
}

/** Decrypts a base64 ciphertext (produced by encryptSecret) back to its original bytes. */
export async function decryptSecret(ciphertext: string, secret: string): Promise<Uint8Array> {
  const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const encrypted = combined.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(secret, salt);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
  return new Uint8Array(decrypted);
}
