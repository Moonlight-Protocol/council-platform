-- Carry the PP's claimed jurisdictions from join_request into the
-- approved provider record so /public/council can surface them.
ALTER TABLE council_providers ADD COLUMN IF NOT EXISTS jurisdictions TEXT;
