-- Add provider_url column to track the provider-platform base URL.
-- Sent by provider-platform during join request relay, used by pay-platform
-- to submit payment bundles.
ALTER TABLE provider_join_requests ADD COLUMN IF NOT EXISTS provider_url TEXT;
ALTER TABLE council_providers ADD COLUMN IF NOT EXISTS provider_url TEXT;

-- Fix council_escrows column types: 0000_init created amount as TEXT and status
-- as TEXT, but the entity expects BIGINT and escrow_status enum. Production
-- Postgres handles the implicit cast; PGlite does not. Safe to run on both.
ALTER TABLE council_escrows ALTER COLUMN amount TYPE BIGINT USING amount::bigint;
ALTER TABLE council_escrows ALTER COLUMN status DROP DEFAULT;
ALTER TABLE council_escrows ALTER COLUMN status TYPE escrow_status USING status::escrow_status;
ALTER TABLE council_escrows ALTER COLUMN status SET DEFAULT 'HELD';
