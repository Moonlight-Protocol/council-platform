-- Add provider_url column to track the provider-platform base URL.
-- Sent by provider-platform during join request relay, used by pay-platform
-- to submit payment bundles.
ALTER TABLE provider_join_requests ADD COLUMN IF NOT EXISTS provider_url TEXT;
ALTER TABLE council_providers ADD COLUMN IF NOT EXISTS provider_url TEXT;
