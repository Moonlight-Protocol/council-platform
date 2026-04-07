import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilEscrowRepository } from "@/persistence/drizzle/repository/council-escrow.repository.ts";
import { CustodialUserRepository } from "@/persistence/drizzle/repository/custodial-user.repository.ts";
import { EscrowStatus } from "@/persistence/drizzle/entity/council-escrow.entity.ts";
import { CustodialUserStatus } from "@/persistence/drizzle/entity/custodial-user.entity.ts";
import { deriveP256PublicKey } from "@/core/service/custody/key-derivation.service.ts";
import { LOG } from "@/config/logger.ts";

const escrowRepo = new CouncilEscrowRepository(drizzleClient);
const userRepo = new CustodialUserRepository(drizzleClient);

// Default escrow fee: 0.1 XLM (1_000_000 stroops). Configurable per council later.
const DEFAULT_ESCROW_FEE = 1_000_000n;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Check if a recipient has UTXO addresses for a given channel.
 * Returns the P256 public keys if registered, null if not.
 */
export async function getRecipientUtxos(
  councilId: string,
  recipientAddress: string,
  channelContractId: string,
  count: number = 1,
): Promise<{ registered: boolean; publicKeys: string[] }> {
  const user = await userRepo.findByExternalIdAndChannel(
    recipientAddress,
    channelContractId,
  );

  if (!user || user.status !== CustodialUserStatus.ACTIVE) {
    return { registered: false, publicKeys: [] };
  }

  // Derive requested number of public keys
  const publicKeys: string[] = [];
  for (let i = 0; i < Math.min(count, 300); i++) {
    const pk = await deriveP256PublicKey(councilId, channelContractId, recipientAddress, i);
    publicKeys.push(bytesToHex(pk));
  }

  return { registered: true, publicKeys };
}

/**
 * Create an escrow record. Called by PPs when sending to a non-KYC'd recipient.
 */
export async function createEscrow(opts: {
  councilId: string;
  senderAddress: string;
  recipientAddress: string;
  amount: bigint;
  assetCode: string;
  channelContractId: string;
  submittedByProvider: string;
}): Promise<{ escrowId: string }> {
  if (opts.amount <= 0n) {
    throw new Error("Amount must be positive");
  }

  const escrow = await escrowRepo.create({
    id: crypto.randomUUID(),
    councilId: opts.councilId,
    senderAddress: opts.senderAddress,
    recipientAddress: opts.recipientAddress,
    amount: opts.amount,
    assetCode: opts.assetCode,
    channelContractId: opts.channelContractId,
    status: EscrowStatus.HELD,
    submittedByProvider: opts.submittedByProvider,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  LOG.info("Escrow created", {
    escrowId: escrow.id,
    recipient: opts.recipientAddress,
    amount: opts.amount.toString(),
    channel: opts.channelContractId,
  });

  return { escrowId: escrow.id };
}

/**
 * Get escrow summary for a recipient.
 */
export async function getEscrowSummary(recipientAddress: string): Promise<{
  pendingCount: number;
  pendingTotal: bigint;
  escrows: Array<{
    id: string;
    senderAddress: string;
    amount: string;
    assetCode: string;
    createdAt: string;
  }>;
}> {
  const held = await escrowRepo.findHeldForRecipient(recipientAddress);
  const pendingTotal = held.reduce((sum, e) => sum + e.amount, 0n);

  return {
    pendingCount: held.length,
    pendingTotal,
    escrows: held.map((e) => ({
      id: e.id,
      senderAddress: e.senderAddress,
      amount: e.amount.toString(),
      assetCode: e.assetCode,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

/**
 * Release all held escrows for a recipient after KYC completion.
 *
 * The council derives the recipient's P256 keys, and would submit a
 * Moonlight transaction to create UTXOs at those addresses (minus fee).
 *
 * Currently marks escrows as RELEASED and returns the amounts.
 * The actual on-chain UTXO creation is a TODO that requires the SDK's
 * transaction builder integration.
 */
export async function releaseEscrowsForRecipient(
  recipientAddress: string,
  channelContractId: string,
): Promise<{
  released: number;
  totalReleased: bigint;
  totalFees: bigint;
}> {
  const held = await escrowRepo.findHeldForRecipient(recipientAddress);
  if (held.length === 0) {
    return { released: 0, totalReleased: 0n, totalFees: 0n };
  }

  // Ensure user is registered
  const user = await userRepo.findByExternalIdAndChannel(
    recipientAddress,
    channelContractId,
  );
  if (!user || user.status !== CustodialUserStatus.ACTIVE) {
    throw new Error("Recipient is not registered or not active");
  }

  let totalReleased = 0n;
  let totalFees = 0n;

  for (const escrow of held) {
    if (escrow.channelContractId !== channelContractId) continue;

    const fee = DEFAULT_ESCROW_FEE;
    const releaseAmount = escrow.amount > fee ? escrow.amount - fee : 0n;

    // TODO: Build Moonlight transaction to create UTXOs at recipient's
    // derived P256 addresses. The council acts as both key holder and
    // transaction submitter — no PP needed.
    //
    // Steps:
    // 1. Derive P256 keys for recipient at UTXO indices
    // 2. Build CREATE operations for releaseAmount
    // 3. Build DEPOSIT from council OpEx (covers the UTXO funding)
    // 4. Sign P256 spends with council-derived keys
    // 5. Sign bundle with council provider key
    // 6. Submit to Stellar

    await escrowRepo.update(escrow.id, {
      status: EscrowStatus.RELEASED,
      feeCharged: fee,
    });

    totalReleased += releaseAmount;
    totalFees += fee;
  }

  LOG.info("Escrows released for recipient", {
    recipient: recipientAddress,
    released: held.length,
    totalReleased: totalReleased.toString(),
    totalFees: totalFees.toString(),
  });

  return {
    released: held.length,
    totalReleased,
    totalFees,
  };
}
