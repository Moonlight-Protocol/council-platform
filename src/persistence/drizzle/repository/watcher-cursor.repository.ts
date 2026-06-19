import { eq } from "drizzle-orm";
import {
  watcherCursor,
} from "@/persistence/drizzle/entity/watcher-cursor.entity.ts";
import type { DbOrTx } from "@/persistence/drizzle/config.ts";

/**
 * Reads and advances the event-watcher's Postgres cursor. Not a BaseRepository
 * (no id / soft-delete columns): the table is keyed by councilId.
 *
 * Bind to a transaction (`new WatcherCursorRepository(tx)`) to advance the
 * cursor in the same atomic unit as the status writes a poll produced.
 */
export class WatcherCursorRepository {
  constructor(private readonly db: DbOrTx) {}

  /** Last-synced ledger for a council, or null if no cursor is stored yet. */
  async get(councilId: string): Promise<number | null> {
    const [row] = await this.db
      .select()
      .from(watcherCursor)
      .where(eq(watcherCursor.councilId, councilId))
      .limit(1);
    return row ? row.lastLedger : null;
  }

  /** Insert or advance the cursor for a council. */
  async upsert(councilId: string, lastLedger: number): Promise<void> {
    await this.db
      .insert(watcherCursor)
      .values({ councilId, lastLedger, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: watcherCursor.councilId,
        set: { lastLedger, updatedAt: new Date() },
      });
  }
}
