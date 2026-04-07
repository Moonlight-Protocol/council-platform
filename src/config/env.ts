import { selectNetwork } from "@/config/network.ts";
import { requireEnv } from "@/utils/env/loadEnv.ts";
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
