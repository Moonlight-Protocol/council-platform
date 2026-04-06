// deno-lint-ignore-file no-explicit-any
/**
 * PGlite-backed test database for integration tests.
 *
 * Uses PGlite (in-memory PostgreSQL via WASM) with Drizzle ORM,
 * giving us real SQL, real transactions, and real constraints
 * without needing an external PostgreSQL server.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/persistence/drizzle/entity/index.ts";

const MIGRATION = `
  DO $$ BEGIN
    CREATE TYPE provider_status AS ENUM ('ACTIVE', 'REMOVED');
  EXCEPTION WHEN duplicate_object THEN null;
  END $$;

  DO $$ BEGIN
    CREATE TYPE join_request_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
  EXCEPTION WHEN duplicate_object THEN null;
  END $$;

  DO $$ BEGIN
    CREATE TYPE custodial_user_status AS ENUM ('ACTIVE', 'SUSPENDED');
  EXCEPTION WHEN duplicate_object THEN null;
  END $$;

  DO $$ BEGIN
    CREATE TYPE escrow_status AS ENUM ('HELD', 'RELEASED', 'EXPIRED');
  EXCEPTION WHEN duplicate_object THEN null;
  END $$;

  CREATE TABLE IF NOT EXISTS council_metadata (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    contact_email TEXT,
    council_public_key TEXT NOT NULL,
    opex_public_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    updated_by TEXT,
    deleted_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS council_channels (
    id TEXT PRIMARY KEY,
    council_id TEXT NOT NULL,
    channel_contract_id TEXT NOT NULL UNIQUE,
    asset_code TEXT NOT NULL,
    asset_contract_id TEXT,
    label TEXT,
    total_deposited BIGINT,
    total_withdrawn BIGINT,
    utxo_count BIGINT,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    updated_by TEXT,
    deleted_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS council_jurisdictions (
    id TEXT PRIMARY KEY,
    council_id TEXT NOT NULL,
    country_code TEXT NOT NULL,
    label TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    updated_by TEXT,
    deleted_at TIMESTAMPTZ
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_jurisdiction_council_country ON council_jurisdictions(council_id, country_code);

  CREATE TABLE IF NOT EXISTS council_providers (
    id TEXT PRIMARY KEY,
    council_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    status provider_status NOT NULL,
    label TEXT,
    contact_email TEXT,
    registered_by_event TEXT,
    removed_by_event TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    updated_by TEXT,
    deleted_at TIMESTAMPTZ
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_council_pk ON council_providers(council_id, public_key);

  CREATE TABLE IF NOT EXISTS custodial_users (
    id TEXT PRIMARY KEY,
    council_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
    channel_contract_id TEXT NOT NULL,
    p256_public_key_hex TEXT NOT NULL,
    status custodial_user_status NOT NULL DEFAULT 'ACTIVE',
    registered_by_provider TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    updated_by TEXT,
    deleted_at TIMESTAMPTZ
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_custodial_user_external_channel ON custodial_users(external_id, channel_contract_id);

  CREATE TABLE IF NOT EXISTS council_escrows (
    id TEXT PRIMARY KEY,
    council_id TEXT NOT NULL,
    sender_address TEXT NOT NULL,
    recipient_address TEXT NOT NULL,
    amount BIGINT NOT NULL,
    asset_code TEXT NOT NULL,
    channel_contract_id TEXT NOT NULL,
    status escrow_status NOT NULL DEFAULT 'HELD',
    submitted_by_provider TEXT NOT NULL,
    release_tx_hash TEXT,
    fee_charged BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    updated_by TEXT,
    deleted_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS known_assets (
    id TEXT PRIMARY KEY,
    asset_code TEXT NOT NULL,
    issuer_address TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_known_asset_code_issuer ON known_assets(asset_code, issuer_address);

  CREATE TABLE IF NOT EXISTS provider_join_requests (
    id TEXT PRIMARY KEY,
    council_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    label TEXT,
    contact_email TEXT,
    jurisdictions TEXT,
    callback_endpoint TEXT,
    signature TEXT,
    status join_request_status NOT NULL,
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    updated_by TEXT,
    deleted_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS wallet_users (
    public_key TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

type PGliteDrizzle = ReturnType<typeof drizzle<typeof schema>>;

let pg: PGlite;
let _drizzleClient: PGliteDrizzle;
let _initialized = false;

async function ensureInitialized() {
  if (_initialized) return;

  pg = new PGlite();
  await pg.exec(MIGRATION);

  _drizzleClient = drizzle({ client: pg, schema });
  _initialized = true;
}

// Lazy proxy so modules that import drizzleClient at load time work correctly.
const drizzleClientProxy: PGliteDrizzle = new Proxy({} as PGliteDrizzle, {
  get(_target, prop) {
    if (!_initialized) {
      throw new Error(
        "PGlite not initialized. Call ensureInitialized() before using drizzleClient.",
      );
    }
    const val = (_drizzleClient as any)[prop];
    return typeof val === "function" ? val.bind(_drizzleClient) : val;
  },
});

export const drizzleClient = drizzleClientProxy;
export type DrizzleClient = PGliteDrizzle;

export { ensureInitialized };

/**
 * Truncate all tables. Call between tests for a clean slate.
 */
export async function resetDb(): Promise<void> {
  await ensureInitialized();
  await pg.exec(`
    TRUNCATE TABLE
      council_escrows,
      custodial_users,
      provider_join_requests,
      council_providers,
      council_channels,
      council_jurisdictions,
      council_metadata,
      known_assets,
      wallet_users
    CASCADE;
  `);
}

/**
 * Shut down PGlite. Call after all tests are done.
 */
export async function closeDb(): Promise<void> {
  if (_initialized) {
    await pg.close();
    _initialized = false;
  }
}
