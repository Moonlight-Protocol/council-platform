-- Council Platform initial schema

-- Enums
DO $$ BEGIN
  CREATE TYPE provider_status AS ENUM ('ACTIVE', 'REMOVED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE join_request_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Council metadata (singleton)
CREATE TABLE IF NOT EXISTS council_metadata (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  contact_email TEXT,
  channel_auth_id TEXT NOT NULL,
  council_public_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ
);

-- Council channels
CREATE TABLE IF NOT EXISTS council_channels (
  id TEXT PRIMARY KEY,
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

-- Council jurisdictions
CREATE TABLE IF NOT EXISTS council_jurisdictions (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jurisdiction_country_code ON council_jurisdictions(country_code);

-- Council providers
CREATE TABLE IF NOT EXISTS council_providers (
  id TEXT PRIMARY KEY,
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_public_key ON council_providers(public_key);

-- Custodial users
CREATE TABLE IF NOT EXISTS custodial_users (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL,
  channel_contract_id TEXT NOT NULL,
  p256_public_key_hex TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ
);

-- Council escrows
CREATE TABLE IF NOT EXISTS council_escrows (
  id TEXT PRIMARY KEY,
  sender_address TEXT NOT NULL,
  recipient_address TEXT NOT NULL,
  amount TEXT NOT NULL,
  asset_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'HELD',
  fee TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ
);

-- Provider join requests
CREATE TABLE IF NOT EXISTS provider_join_requests (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  label TEXT,
  contact_email TEXT,
  status join_request_status NOT NULL,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ
);

-- Known assets (registry of all assets ever enabled via the UI)
CREATE TABLE IF NOT EXISTS known_assets (
  id TEXT PRIMARY KEY,
  asset_code TEXT NOT NULL,
  issuer_address TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_known_asset ON known_assets(asset_code, issuer_address);
