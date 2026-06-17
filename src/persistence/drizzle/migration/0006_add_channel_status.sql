-- UC6 asset-lifecycle: channels carry an explicit on-chain status instead of
-- being hidden via deletedAt when disabled. `status` is the sole authoritative
-- field written by the event-watcher from the channel-auth ChannelStateChanged
-- event; `pending_action` is an optimistic UX-only marker set by the endpoint
-- and cleared on confirmation. Existing (non-deleted) channels are enabled;
-- any previously soft-deleted channels migrate to disabled-but-visible.
ALTER TABLE council_channels ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'enabled';
ALTER TABLE council_channels ADD COLUMN IF NOT EXISTS pending_action TEXT;
UPDATE council_channels SET status = 'disabled', deleted_at = NULL WHERE deleted_at IS NOT NULL;
