-- Multi-council schema migration
-- Adds council_id to all per-council tables, OpEx fields to metadata,
-- new columns to join requests, and updates unique indexes.

-- New enums
DO $$ BEGIN
  CREATE TYPE custodial_user_status AS ENUM ('ACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE escrow_status AS ENUM ('HELD', 'RELEASED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- council_metadata: remove channel_auth_id (id now serves as channelAuthId), add OpEx fields
ALTER TABLE council_metadata ADD COLUMN IF NOT EXISTS opex_public_key TEXT;
ALTER TABLE council_metadata DROP COLUMN IF EXISTS channel_auth_id;

-- council_channels: add council_id
ALTER TABLE council_channels ADD COLUMN IF NOT EXISTS council_id TEXT;
UPDATE council_channels SET council_id = (SELECT id FROM council_metadata LIMIT 1) WHERE council_id IS NULL;
ALTER TABLE council_channels ALTER COLUMN council_id SET NOT NULL;

-- council_jurisdictions: add council_id, update unique index
ALTER TABLE council_jurisdictions ADD COLUMN IF NOT EXISTS council_id TEXT;
UPDATE council_jurisdictions SET council_id = (SELECT id FROM council_metadata LIMIT 1) WHERE council_id IS NULL;
ALTER TABLE council_jurisdictions ALTER COLUMN council_id SET NOT NULL;
DROP INDEX IF EXISTS idx_jurisdiction_country_code;
CREATE UNIQUE INDEX IF NOT EXISTS idx_jurisdiction_council_country ON council_jurisdictions(council_id, country_code);

-- council_providers: add council_id, update unique index
ALTER TABLE council_providers ADD COLUMN IF NOT EXISTS council_id TEXT;
UPDATE council_providers SET council_id = (SELECT id FROM council_metadata LIMIT 1) WHERE council_id IS NULL;
ALTER TABLE council_providers ALTER COLUMN council_id SET NOT NULL;
DROP INDEX IF EXISTS idx_provider_public_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_council_pk ON council_providers(council_id, public_key);

-- custodial_users: add council_id, add registered_by_provider
ALTER TABLE custodial_users ADD COLUMN IF NOT EXISTS council_id TEXT;
UPDATE custodial_users SET council_id = (SELECT id FROM council_metadata LIMIT 1) WHERE council_id IS NULL;
ALTER TABLE custodial_users ALTER COLUMN council_id SET NOT NULL;
ALTER TABLE custodial_users ADD COLUMN IF NOT EXISTS registered_by_provider TEXT;

-- council_escrows: add council_id, add missing columns
ALTER TABLE council_escrows ADD COLUMN IF NOT EXISTS council_id TEXT;
UPDATE council_escrows SET council_id = (SELECT id FROM council_metadata LIMIT 1) WHERE council_id IS NULL;
ALTER TABLE council_escrows ALTER COLUMN council_id SET NOT NULL;
ALTER TABLE council_escrows ADD COLUMN IF NOT EXISTS channel_contract_id TEXT;
ALTER TABLE council_escrows ADD COLUMN IF NOT EXISTS submitted_by_provider TEXT;
ALTER TABLE council_escrows ADD COLUMN IF NOT EXISTS release_tx_hash TEXT;
ALTER TABLE council_escrows ADD COLUMN IF NOT EXISTS fee_charged BIGINT;
-- Create indexes if not present
CREATE INDEX IF NOT EXISTS idx_escrow_recipient ON council_escrows(recipient_address);
CREATE INDEX IF NOT EXISTS idx_escrow_status ON council_escrows(status);

-- provider_join_requests: add council_id, jurisdictions, callback_endpoint, signature
ALTER TABLE provider_join_requests ADD COLUMN IF NOT EXISTS council_id TEXT;
UPDATE provider_join_requests SET council_id = (SELECT id FROM council_metadata LIMIT 1) WHERE council_id IS NULL;
ALTER TABLE provider_join_requests ALTER COLUMN council_id SET NOT NULL;
ALTER TABLE provider_join_requests ADD COLUMN IF NOT EXISTS jurisdictions TEXT;
ALTER TABLE provider_join_requests ADD COLUMN IF NOT EXISTS callback_endpoint TEXT;
ALTER TABLE provider_join_requests ADD COLUMN IF NOT EXISTS signature TEXT;

-- custodial_users unique index update
DROP INDEX IF EXISTS idx_custodial_user_external;
CREATE UNIQUE INDEX IF NOT EXISTS idx_custodial_user_external_channel ON custodial_users(external_id, channel_contract_id);

-- Wallet users table (created on first sign-in)
CREATE TABLE IF NOT EXISTS wallet_users (
  public_key TEXT PRIMARY KEY NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for ownership queries
CREATE INDEX IF NOT EXISTS idx_council_metadata_owner ON council_metadata(council_public_key);
