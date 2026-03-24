import { NETWORK_RPC_SERVER } from "@/config/env.ts";
import { LOG } from "@/config/logger.ts";

export interface ChannelOnChainState {
  totalDeposited: bigint | null;
  totalWithdrawn: bigint | null;
  utxoCount: bigint | null;
  ledgerSequence: number;
}

/**
 * Queries on-chain state for a Privacy Channel contract via Stellar RPC.
 *
 * Uses getLatestLedger to confirm connectivity and returns basic channel
 * state. Full state queries (total deposited, UTXO count) will be expanded
 * when the SDK exposes channel read methods.
 */
export async function queryChannelState(
  _channelContractId: string,
): Promise<ChannelOnChainState> {
  try {
    const ledger = await NETWORK_RPC_SERVER.getLatestLedger();

    // TODO: Use SDK ChannelReadMethods to query actual channel state
    // (total deposited, withdrawn, UTXO count) once available.
    // For now, return ledger sequence to confirm RPC connectivity.
    return {
      totalDeposited: null,
      totalWithdrawn: null,
      utxoCount: null,
      ledgerSequence: ledger.sequence,
    };
  } catch (error) {
    LOG.error("Failed to query channel state from RPC", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error("Failed to query channel on-chain state");
  }
}
