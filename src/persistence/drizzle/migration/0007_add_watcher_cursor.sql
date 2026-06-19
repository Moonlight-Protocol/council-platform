-- Relocate the event-watcher cursor from the Deno.KV file into Postgres. One
-- row per council (council_id = channel-auth contract id) holds the last-synced
-- ledger. The watcher advances this in the SAME transaction as the
-- council_channels.status writes a poll produces, so the DB and the cursor can
-- never diverge, and a Postgres wipe resets the watcher along with everything
-- else (no surviving state file).
CREATE TABLE IF NOT EXISTS "watcher_cursor" (
	"council_id" text PRIMARY KEY NOT NULL,
	"last_ledger" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
