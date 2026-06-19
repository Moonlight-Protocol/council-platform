import { bigint, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The event-watcher's last-synced ledger, one row per council (the council id
 * IS the channel-auth contract id). This replaces the old Deno.KV cursor file:
 * the cursor lives in Postgres and is advanced in the SAME transaction as the
 * `council_channels.status` writes a poll produces, so the DB and the cursor
 * can never diverge. A Postgres wipe resets it along with everything else.
 */
export const watcherCursor = pgTable("watcher_cursor", {
  councilId: text("council_id").primaryKey(),
  // Stellar ledger sequences are uint32 — comfortably within a JS number, but
  // stored as bigint for headroom and consistency with other ledger columns.
  lastLedger: bigint("last_ledger", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WatcherCursor = typeof watcherCursor.$inferSelect;
export type NewWatcherCursor = typeof watcherCursor.$inferInsert;
