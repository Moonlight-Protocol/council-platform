import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CustodialUserRepository } from "@/persistence/drizzle/repository/custodial-user.repository.ts";
import { CustodialUserStatus } from "@/persistence/drizzle/entity/custodial-user.entity.ts";
import { deriveP256PublicKey } from "@/core/service/custody/key-derivation.service.ts";
import { withSpan } from "@/core/tracing.ts";
import type { Logger } from "@/utils/logger/index.ts";

const userRepo = new CustodialUserRepository(drizzleClient);

/**
 * Registers a non-custodial user for a specific channel.
 *
 * Derives the P256 root public key (index 0) and stores it in the DB.
 * The council can derive up to 300 UTXO keys per user per channel.
 *
 * @param externalId - User identifier from the PP (e.g. Stellar address or UUID)
 * @param channelContractId - The Privacy Channel contract this user will use
 * @param providerPublicKey - The PP that onboarded this user
 */
export function registerCustodialUser(opts: {
  councilId: string;
  externalId: string;
  channelContractId: string;
  providerPublicKey?: string;
}, deps: { log: Logger }): Promise<{
  userId: string;
  p256PublicKeyHex: string;
}> {
  const { councilId, externalId, channelContractId, providerPublicKey } = opts;
  const log = deps.log.scope("registerCustodialUser");
  log.info("registerCustodialUser");
  log.debug("councilId", councilId);
  log.debug("externalId", externalId);
  log.debug("channelContractId", channelContractId);

  return withSpan("Custody.registerUser", async (span) => {
    span.setAttribute("council.id", councilId);
    span.setAttribute("channel.contract_id", channelContractId);

    // Check if user already registered for this channel
    const existing = await userRepo.findByExternalIdAndChannel(
      externalId,
      channelContractId,
    );
    if (existing) {
      span.setAttribute("user.already_registered", true);
      span.setAttribute("user.id", existing.id);
      return {
        userId: existing.id,
        p256PublicKeyHex: existing.p256PublicKeyHex,
      };
    }

    // Derive root P256 public key (index 0)
    const publicKey = await deriveP256PublicKey(
      councilId,
      channelContractId,
      externalId,
      0,
      deps,
    );
    const p256PublicKeyHex = bytesToHex(publicKey);

    const user = await userRepo.create({
      id: crypto.randomUUID(),
      councilId,
      externalId,
      channelContractId,
      p256PublicKeyHex,
      status: CustodialUserStatus.ACTIVE,
      registeredByProvider: providerPublicKey ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    span.setAttribute("user.id", user.id);
    span.setAttribute("user.already_registered", false);

    log.debug("userId", user.id);
    log.event("custodial user registered");

    return {
      userId: user.id,
      p256PublicKeyHex: user.p256PublicKeyHex,
    };
  });
}

/**
 * Gets the derived P256 public keys for a user at specified UTXO indices.
 *
 * @param councilId - Council ID (used to load the per-council derivation root)
 * @param externalId - User identifier
 * @param channelContractId - Channel contract ID
 * @param indices - Array of UTXO indices (0-299)
 */
export function getUserPublicKeys(
  councilId: string,
  externalId: string,
  channelContractId: string,
  indices: number[],
  deps: { log: Logger },
): Promise<string[]> {
  return withSpan("Custody.getUserPublicKeys", async (span) => {
    const log = deps.log.scope("getUserPublicKeys");
    log.info("getUserPublicKeys");
    log.debug("externalId", externalId);
    log.debug("indexCount", indices.length);

    span.setAttribute("council.id", councilId);
    span.setAttribute("channel.contract_id", channelContractId);
    span.setAttribute("indices.count", indices.length);

    log.event("looking up custodial user");
    const user = await userRepo.findByExternalIdAndChannel(
      externalId,
      channelContractId,
    );
    if (!user) {
      throw new Error("User not registered for this channel");
    }

    if (user.status !== CustodialUserStatus.ACTIVE) {
      throw new Error("User account is suspended");
    }

    log.event("deriving requested public keys");
    const publicKeys: string[] = [];
    for (const index of indices) {
      if (index < 0 || index >= 300) {
        throw new Error(`UTXO index ${index} out of range (0-299)`);
      }
      const pk = await deriveP256PublicKey(
        councilId,
        channelContractId,
        externalId,
        index,
        deps,
      );
      publicKeys.push(bytesToHex(pk));
    }

    return publicKeys;
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
