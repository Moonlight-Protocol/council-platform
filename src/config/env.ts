import { selectNetwork } from "@/config/network.ts";
import { loadOptionalEnv, requireEnv } from "@/utils/env/loadEnv.ts";
import { parseBootSyncStartLedger } from "@/utils/env/parseBootSyncStartLedger.ts";
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

// Where a watcher with NO persisted Postgres cursor begins polling.
//   "all" (case-insensitive) → SYNC ALL AVAILABLE: start from the oldest ledger
//     the RPC still retains, so no in-window event is skipped on a cold boot.
//   empty / unset → SYNC ALL AVAILABLE (same as "all"; the explicit synonym is
//     kept so iac can carry a real placeholder and flip it to a ledger at reset
//     time without an empty value changing behavior).
//   non-negative integer → start at exactly that ledger.
//   anything else ("latest", negative, other junk) → throws at boot.
// Never defaults to "latest". See parseBootSyncStartLedger for the parse rules.
export const BOOT_SYNC_START_LEDGER_BLOCK = parseBootSyncStartLedger(
  loadOptionalEnv("BOOT_SYNC_START_LEDGER_BLOCK"),
);
