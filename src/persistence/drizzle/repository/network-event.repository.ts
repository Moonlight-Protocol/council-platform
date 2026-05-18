import { desc, gte, lt, sql } from "drizzle-orm";
import {
  type NetworkEvent,
  networkEvent,
  type NewNetworkEvent,
} from "@/persistence/drizzle/entity/network-event.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class NetworkEventRepository {
  constructor(private db: DrizzleClient) {}

  async insertOne(input: NewNetworkEvent): Promise<NetworkEvent> {
    const [row] = await this.db.insert(networkEvent).values(input).returning();
    return row;
  }

  /** Recent events ordered newest-first. Used to build the WS hello-frame. */
  async listRecent(
    options: { since?: Date; limit?: number } = {},
  ): Promise<NetworkEvent[]> {
    const { since, limit = 50 } = options;
    if (since) {
      return await this.db.select().from(networkEvent)
        .where(gte(networkEvent.occurredAt, since))
        .orderBy(desc(networkEvent.occurredAt))
        .limit(limit);
    }
    return await this.db.select().from(networkEvent)
      .orderBy(desc(networkEvent.occurredAt))
      .limit(limit);
  }

  /** Count of rows since `since`. Backs the EVENTS/24H counter. */
  async countSince(since: Date): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(networkEvent)
      .where(gte(networkEvent.occurredAt, since));
    return result[0]?.count ?? 0;
  }

  /** Delete rows older than `cutoff`. Returns the number of rows deleted. */
  async purgeOlderThan(cutoff: Date): Promise<number> {
    const deleted = await this.db.delete(networkEvent)
      .where(lt(networkEvent.occurredAt, cutoff))
      .returning({ id: networkEvent.id });
    return deleted.length;
  }
}
