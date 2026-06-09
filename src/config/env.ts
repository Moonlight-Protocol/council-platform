import { selectNetwork } from "@/config/network.ts";
import { loadOptionalEnv, requireEnv } from "@/utils/env/loadEnv.ts";
import { Server } from "stellar-sdk/rpc";

export const DATABASE_URL = requireEnv("DATABASE_URL");
/**
 * Max concurrent postgres connections held by `postgres-js`. Default is
 * `postgres-js`'s own 10, which saturated quickly on testnet under the
 * combined load of:
 *   - request handlers (HTTP fan-in)
 *   - the EventWatcher service syncing watchers from the DB every 5 s
 *     (`event-watcher/index.ts:34`) + N per-Channel-Auth pollers, each
 *     writing to council_providers on chain-event dispatch
 *   - n-d-p's `refreshTopology` piggyback on `provider_added` calling
 *     `/api/v1/public/councils`, which itself fans out
 *     `1 + 3*N` parallel queries via `Promise.all` in
 *     `handleListAllCouncils` (`public/routes.ts:106-152`)
 *
 * Once the pool was exhausted, subsequent `acquire` calls waited up to
 * `postgres-js`'s default `connect_timeout` of 30 s and then threw,
 * surfacing as exactly-30-s 401 from `/admin/auth/verify` (Tempo trace
 * `44207a4b4cacf8c1101cc4332076ee2c`: handler dur=30078 ms, response 401)
 * and exactly-30-s 500 from `/public/council` (same trace: dur=30014 ms,
 * response 500). 30 is the new default — comfortable headroom on Fly
 * Postgres, well below the Postgres `max_connections` ceiling (100 by
 * default), and tunable via env.
 */
export const POSTGRES_POOL_MAX = Number(
  loadOptionalEnv("POSTGRES_POOL_MAX") ?? "30",
);
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
