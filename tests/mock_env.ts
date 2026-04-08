/**
 * Mock env module for API integration tests.
 *
 * Replaces @/config/env.ts (via tests/deno.json import map) so tests don't
 * need a .env file or live Stellar network access.
 *
 * The exports here MUST mirror what the real @/config/env.ts exports.
 * Since the rule is "env vars are infra + operation only", the real env
 * has no contract IDs / council keys / OpEx keys — and neither does this mock.
 *
 * Test fixtures (keypairs used to sign auth challenges, etc.) are kept here
 * with the _TEST_ prefix so it's clear they're test-only and not part of
 * the env-vs-mock surface.
 */
import { Keypair } from "stellar-sdk";

// Fixed test keypair — deterministic so signature outputs are reproducible.
const councilKeypair = Keypair.fromSecret("SBPCP2AQ63VWALVCJTV63UYBFWDTQWCURW2PG74XWXGK4CFMQZIBRYK5");

export const DATABASE_URL = "mock://not-used-pglite-replaces-this";
export const PORT = "0"; // random port
export const MODE = "development";
export const SERVICE_DOMAIN = "test.council.local";
export const SERVICE_AUTH_SECRET = "test-secret-for-tests";

export const CHALLENGE_TTL = 300;
export const SESSION_TTL = 3600;

export const NETWORK = "local";

export const NETWORK_CONFIG = {
  networkPassphrase: "Standalone Network ; February 2017",
  rpcUrl: "http://localhost:8000/soroban/rpc",
  horizonUrl: "http://localhost:8000",
  friendbotUrl: "http://localhost:8000/friendbot",
  allowHttp: true,
};

// Mock RPC server that returns dummy data
export const NETWORK_RPC_SERVER = {
  getEvents: async () => ({ events: [], latestLedger: 100 }),
  getLatestLedger: async () => ({ sequence: 100 }),
  getAccount: async () => ({}),
  simulateTransaction: async () => ({}),
  sendTransaction: async () => ({}),
  getTransaction: async () => ({}),
};

// Test fixture — used by admin-auth.test.ts to sign SEP-43/53 challenges.
// Not part of the env surface; kept here so all test fixtures live in one
// place that gets imported via the mock import map.
export const _TEST_COUNCIL_KEYPAIR = councilKeypair;
