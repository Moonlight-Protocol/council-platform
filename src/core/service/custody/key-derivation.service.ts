import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha256";
import { hkdf } from "@noble/hashes/hkdf";
import { mapHashToField } from "@noble/curves/abstract/modular";
import { NETWORK, SERVICE_AUTH_SECRET } from "@/config/env.ts";
import { decryptSecret } from "@/core/crypto/encrypt-secret.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import { withSpan } from "@/core/tracing.ts";
import type { Logger } from "@/utils/logger/index.ts";

const metadataRepo = new CouncilMetadataRepository(drizzleClient);

/** Loads and decrypts a council's derivation root. Throws if the council doesn't exist. */
async function loadDerivationRoot(
  councilId: string,
  deps: { log: Logger },
): Promise<Uint8Array> {
  const log = deps.log.scope("loadDerivationRoot");
  log.info("loadDerivationRoot");
  log.debug("councilId", councilId);

  log.event("looking up council metadata");
  const council = await metadataRepo.getById(councilId);
  if (!council) {
    throw new Error(`Council not found: ${councilId}`);
  }
  log.event("decrypting derivation root");
  return decryptSecret(council.encryptedDerivationRoot, SERVICE_AUTH_SECRET);
}

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
 * The root is per-council: each council has its own random 32-byte root stored
 * encrypted in council_metadata. Custodial users are locked to the council.
 *
 * @param councilId - The council's unique ID (channel auth contract ID)
 * @param channelContractId - The Privacy Channel contract ID
 * @param userExternalId - User identifier (e.g. Stellar address or UUID)
 * @param utxoIndex - UTXO slot index (0-299)
 */
export function deriveP256Keypair(
  councilId: string,
  channelContractId: string,
  userExternalId: string,
  utxoIndex: number,
  deps: { log: Logger },
): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
  return withSpan("KeyDerivation.deriveP256Keypair", async (span) => {
    const log = deps.log.scope("deriveP256Keypair");
    log.info("deriveP256Keypair");
    log.debug("councilId", councilId);
    log.debug("channelContractId", channelContractId);
    log.debug("utxoIndex", utxoIndex);

    span.setAttribute("council.id", councilId);
    span.setAttribute("channel.contract_id", channelContractId);
    span.setAttribute("utxo.index", utxoIndex);

    const context = `${NETWORK}${channelContractId}`;
    log.event("loading derivation root");
    const rootBytes = await loadDerivationRoot(councilId, deps);
    const root = btoa(String.fromCharCode(...rootBytes));
    // Index = user external ID + ":" + UTXO index
    const index = `${userExternalId}:${utxoIndex}`;

    // Assemble plaintext seed (same as SDK's generatePlainTextSeed)
    const plainTextSeed = `${context}${root}${index}`;
    rootBytes.fill(0); // Best-effort zeroization

    // Hash seed with SHA-256 (same as SDK's hashSeed)
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(plainTextSeed),
    );
    const hashedSeed = new Uint8Array(hashBuffer);

    log.event("deriving P256 keypair from seed");
    const expanded = hkdf(sha256, hashedSeed, undefined, "application", 48);
    const privateScalarBytes = mapHashToField(expanded, p256.CURVE.n);
    const privateScalar = bytesToBigIntBE(privateScalarBytes);
    const rawPrivateKey = numberToBytesBE(privateScalar, 32);
    const publicKey = p256.getPublicKey(rawPrivateKey, false);

    hashedSeed.fill(0);
    expanded.fill(0);
    privateScalarBytes.fill(0);

    log.event("keypair derived");
    return { publicKey, privateKey: rawPrivateKey };
  });
}

/**
 * Derives just the P256 public key (no private key material exposed).
 * Used for registration — stores only the public key.
 */
export async function deriveP256PublicKey(
  councilId: string,
  channelContractId: string,
  userExternalId: string,
  utxoIndex: number,
  deps: { log: Logger },
): Promise<Uint8Array> {
  const { publicKey } = await deriveP256Keypair(
    councilId,
    channelContractId,
    userExternalId,
    utxoIndex,
    deps,
  );
  return publicKey;
}

/**
 * Signs a message with the derived P256 private key.
 * Used by the signing API when PPs request UTXO spend signatures.
 * Best-effort zeroization of private key material after use.
 */
export function signWithDerivedKey(
  councilId: string,
  channelContractId: string,
  userExternalId: string,
  utxoIndex: number,
  message: Uint8Array,
  deps: { log: Logger },
): Promise<Uint8Array> {
  return withSpan("KeyDerivation.signWithDerivedKey", async (span) => {
    const log = deps.log.scope("signWithDerivedKey");
    log.info("signWithDerivedKey");
    log.debug("councilId", councilId);
    log.debug("utxoIndex", utxoIndex);

    span.setAttribute("council.id", councilId);
    span.setAttribute("channel.contract_id", channelContractId);
    span.setAttribute("utxo.index", utxoIndex);

    const { privateKey } = await deriveP256Keypair(
      councilId,
      channelContractId,
      userExternalId,
      utxoIndex,
      deps,
    );
    try {
      log.event("signing message");
      const signature = p256.sign(message, privateKey);
      return signature.toDERRawBytes();
    } finally {
      privateKey.fill(0);
    }
  });
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
