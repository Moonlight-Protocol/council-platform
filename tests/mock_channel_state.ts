/**
 * Mock channel state service for tests.
 *
 * Replaces @/core/service/channel/channel-state.service.ts to avoid
 * importing env.ts and making real Stellar RPC calls.
 */

export interface ChannelOnChainState {
  totalDeposited: bigint | null;
  totalWithdrawn: bigint | null;
  utxoCount: bigint | null;
  ledgerSequence: number;
}

// deno-lint-ignore require-await -- mock satisfies async queryChannelState contract
export async function queryChannelState(
  _channelContractId: string,
): Promise<ChannelOnChainState> {
  return {
    totalDeposited: null,
    totalWithdrawn: null,
    utxoCount: null,
    ledgerSequence: 100,
  };
}
