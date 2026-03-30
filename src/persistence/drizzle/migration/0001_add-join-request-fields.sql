-- Add fields for UC2: richer join requests from provider-platform
ALTER TABLE provider_join_requests ADD COLUMN IF NOT EXISTS jurisdictions TEXT;
ALTER TABLE provider_join_requests ADD COLUMN IF NOT EXISTS callback_endpoint TEXT;
ALTER TABLE provider_join_requests ADD COLUMN IF NOT EXISTS signature TEXT;
