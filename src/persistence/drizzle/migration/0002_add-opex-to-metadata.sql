-- Add OpEx public key to council metadata
ALTER TABLE council_metadata ADD COLUMN IF NOT EXISTS opex_public_key TEXT;
