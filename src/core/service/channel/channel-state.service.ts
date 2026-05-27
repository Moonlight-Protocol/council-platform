import { NETWORK_RPC_SERVER } from "@/config/env.ts";
import { withSpan } from "@/core/tracing.ts";
import type { Logger } from "@/utils/logger/index.ts";

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
export function queryChannelState(
  channelContractId: string,
  deps: { log: Logger },
): Promise<ChannelOnChainState> {
  const log = deps.log.scope("queryChannelState");
  log.info("queryChannelState");
  log.debug("channelContractId", channelContractId);

  return withSpan("Channel.queryState", async (span) => {
    span.setAttribute("channel.contract_id", channelContractId);
    try {
      const ledger = await NETWORK_RPC_SERVER.getLatestLedger();
      span.setAttribute("ledger.sequence", ledger.sequence);

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
      log.error(error, "failed to query channel state from RPC");
      throw new Error("Failed to query channel on-chain state");
    }
  });
}
