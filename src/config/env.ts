import { selectNetwork } from "@/config/network.ts";
import { loadOptionalEnv, requireEnv } from "@/utils/env/loadEnv.ts";
import { Server } from "stellar-sdk/rpc";

export const DATABASE_URL = requireEnv("DATABASE_URL");
export const PORT = requireEnv("PORT");
export const MODE = requireEnv("MODE");
export const SERVICE_DOMAIN = requireEnv("SERVICE_DOMAIN");
export const SERVICE_AUTH_SECRET = requireEnv("SERVICE_AUTH_SECRET");

export const CHALLENGE_TTL = Number(requireEnv("CHALLENGE_TTL"));
export const SESSION_TTL = Number(requireEnv("SESSION_TTL"));

// Network
export const { NETWORK_CONFIG, NETWORK } = selectNetwork(requireEnv("NETWORK"));

export const NETWORK_RPC_SERVER = new Server(
  NETWORK_CONFIG.rpcUrl as string,
  { allowHttp: NETWORK_CONFIG.allowHttp },
);

// Where a watcher with NO persisted Postgres cursor begins polling. Unset →
// SYNC ALL AVAILABLE: start from the oldest ledger the RPC still retains, so no
// in-window event is skipped on a cold boot. Set → start at exactly that ledger.
// Never defaults to "latest".
const _rawBootSyncStart = loadOptionalEnv("BOOT_SYNC_START_LEDGER_BLOCK");
let _bootSyncStart: number | null = null;
if (_rawBootSyncStart !== undefined && _rawBootSyncStart !== "") {
  const n = Number(_rawBootSyncStart);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `BOOT_SYNC_START_LEDGER_BLOCK must be a non-negative integer, got: "${_rawBootSyncStart}"`,
    );
  }
  _bootSyncStart = n;
}
export const BOOT_SYNC_START_LEDGER_BLOCK = _bootSyncStart;
