/**
 * Mock env module for API integration tests.
 *
 * Replaces @/config/env.ts to avoid requiring a .env file
 * or live Stellar network access.
 */
import { Keypair } from "stellar-sdk";
import { Buffer } from "buffer";

// Fixed test keypairs — deterministic so key derivation produces
// the same outputs across runs and crypto edge cases are reproducible.
const councilKeypair = Keypair.fromSecret("SBPCP2AQ63VWALVCJTV63UYBFWDTQWCURW2PG74XWXGK4CFMQZIBRYK5");
const opexKeypair = Keypair.fromSecret("SC77QXITG5XR2GQLDAZLCI5XTZSNBOIC6CUUZYCD5C7GRKUSZZX3OQA2");

export const DATABASE_URL = "mock://not-used-pglite-replaces-this";
export const PORT = "0"; // random port
export const MODE = "development";
export const SERVICE_DOMAIN = "test.council.local";
export const SERVICE_AUTH_SECRET = "test-secret-for-tests";

export const CHALLENGE_TTL = 300;
export const SESSION_TTL = 3600;

export const CHANNEL_AUTH_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4";

export const COUNCIL_SK = councilKeypair.secret();

export const OPEX_SK = opexKeypair.secret();

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

// Mock signers with a publicKey() method
export const COUNCIL_SIGNER = {
  publicKey: () => councilKeypair.publicKey(),
  sign: (data: Uint8Array) => councilKeypair.sign(Buffer.from(data)),
  secret: () => councilKeypair.secret(),
};

export const OPEX_SIGNER = {
  publicKey: () => opexKeypair.publicKey(),
  sign: (data: Uint8Array) => opexKeypair.sign(Buffer.from(data)),
  secret: () => opexKeypair.secret(),
};

export const TX_CONFIG = {
  source: opexKeypair.publicKey(),
  fee: "100",
  timeout: 30,
  signers: [OPEX_SIGNER],
};

// Export the keypairs for test use
export const _TEST_COUNCIL_KEYPAIR = councilKeypair;
export const _TEST_OPEX_KEYPAIR = opexKeypair;
