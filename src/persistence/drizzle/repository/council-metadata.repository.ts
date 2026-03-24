import { eq } from "drizzle-orm";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";
import {
  councilMetadata,
  type CouncilMetadata,
  type NewCouncilMetadata,
} from "@/persistence/drizzle/entity/council-metadata.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

const SINGLETON_ID = "default";

export class CouncilMetadataRepository extends BaseRepository<
  typeof councilMetadata,
  CouncilMetadata,
  NewCouncilMetadata
> {
  constructor(db: DrizzleClient) {
    super(db, councilMetadata);
  }

  async getConfig(): Promise<CouncilMetadata | undefined> {
    const [result] = await this.db
      .select()
      .from(councilMetadata)
      .where(eq(councilMetadata.id, SINGLETON_ID))
      .limit(1);
    return result;
  }

  async upsert(data: Omit<NewCouncilMetadata, "id">): Promise<CouncilMetadata> {
    const existing = await this.getConfig();
    if (existing) {
      const [updated] = await this.db
        .update(councilMetadata)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(councilMetadata.id, SINGLETON_ID))
        .returning();
      return updated;
    }
    const [created] = await this.db
      .insert(councilMetadata)
      .values({ id: SINGLETON_ID, ...data })
      .returning();
    return created;
  }
}
