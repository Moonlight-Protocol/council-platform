-- Per-council derivation root for custodial key derivation.
-- Each council has its own random root (encrypted at rest with SERVICE_AUTH_SECRET)
-- to derive end-user P256 keypairs. Replaces the old global COUNCIL_SK env var.
ALTER TABLE council_metadata ADD COLUMN IF NOT EXISTS encrypted_derivation_root TEXT;
-- No backwards compat: there are no deployed councils. New rows must populate this.
-- The application is responsible for setting it on insert (see putMetadataHandler).
ALTER TABLE council_metadata ALTER COLUMN encrypted_derivation_root SET NOT NULL;
