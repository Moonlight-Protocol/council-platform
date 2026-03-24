import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha256";
import { hkdf } from "@noble/hashes/hkdf";
import { mapHashToField } from "@noble/curves/abstract/modular";
import { COUNCIL_SK, NETWORK } from "@/config/env.ts";
import { LOG } from "@/config/logger.ts";

/**
 * Deterministically derives a P256 keypair for a user+channel combination.
 *
 * Replicates the SDK's StellarDerivator pipeline:
 *   seed = context + root + index
 *   hashedSeed = SHA-256(seed)
 *   expanded = HKDF-SHA256(hashedSeed, "application", 48 bytes)
 *   privateScalar = mapHashToField(expanded, p256.CURVE.n)
 *   publicKey = p256.getPublicKey(rawPrivateKey, false)
 *
 * The council uses its COUNCIL_SK as the root (instead of the user's secret key).
 * This means users are locked to the council, not to any individual PP.
 *
 * @param channelContractId - The Privacy Channel contract ID
 * @param userExternalId - User identifier (e.g. Stellar address or UUID)
 * @param utxoIndex - UTXO slot index (0-299)
 */
export async function deriveP256Keypair(
  channelContractId: string,
  userExternalId: string,
  utxoIndex: number,
): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
  // Context = network passphrase + channel contract ID (same as SDK's assembleNetworkContext)
  const context = `${NETWORK}${channelContractId}`;
  // Root = council's Ed25519 secret key
  const root = COUNCIL_SK;
  // Index = user external ID + ":" + UTXO index
  const index = `${userExternalId}:${utxoIndex}`;

  // Assemble plaintext seed (same as SDK's generatePlainTextSeed)
  const plainTextSeed = `${context}${root}${index}`;

  // Hash seed with SHA-256 (same as SDK's hashSeed)
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(plainTextSeed));
  const hashedSeed = new Uint8Array(hashBuffer);

  // Derive P256 keypair from seed (same as SDK's deriveP256KeyPairFromSeed)
  const expanded = hkdf(sha256, hashedSeed, undefined, "application", 48);
  const privateScalarBytes = mapHashToField(expanded, p256.CURVE.n);
  const privateScalar = bytesToBigIntBE(privateScalarBytes);
  const rawPrivateKey = numberToBytesBE(privateScalar, 32);
  const publicKey = p256.getPublicKey(rawPrivateKey, false);

  // Best-effort zeroization of intermediate key material
  hashedSeed.fill(0);
  expanded.fill(0);
  privateScalarBytes.fill(0);

  return { publicKey, privateKey: rawPrivateKey };
}

/**
 * Derives just the P256 public key (no private key material exposed).
 * Used for registration — stores only the public key.
 */
export async function deriveP256PublicKey(
  channelContractId: string,
  userExternalId: string,
  utxoIndex: number,
): Promise<Uint8Array> {
  const { publicKey } = await deriveP256Keypair(channelContractId, userExternalId, utxoIndex);
  return publicKey;
}

/**
 * Signs a message with the derived P256 private key.
 * Used by the signing API when PPs request UTXO spend signatures.
 */
/**
 * Signs a message with the derived P256 private key.
 * Used by the signing API when PPs request UTXO spend signatures.
 * Best-effort zeroization of private key material after use.
 */
export async function signWithDerivedKey(
  channelContractId: string,
  userExternalId: string,
  utxoIndex: number,
  message: Uint8Array,
): Promise<Uint8Array> {
  const { privateKey } = await deriveP256Keypair(channelContractId, userExternalId, utxoIndex);
  try {
    const signature = p256.sign(message, privateKey);
    return signature.toDERRawBytes();
  } finally {
    // Best-effort zeroization — clears the Uint8Array holding private key material.
    // Note: intermediate values in deriveP256Keypair (expanded, privateScalarBytes)
    // are stack-local and will be GC'd, but cannot be explicitly zeroed from here.
    privateKey.fill(0);
  }
}

/** Convert big-endian bytes to bigint */
function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

/** Convert bigint to fixed-length big-endian bytes */
function numberToBytesBE(num: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(num & 0xffn);
    num >>= 8n;
  }
  return bytes;
}
