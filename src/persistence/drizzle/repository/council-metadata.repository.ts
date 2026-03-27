import { eq, sql } from "drizzle-orm";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";
import {
  councilMetadata,
  type CouncilMetadata,
  type NewCouncilMetadata,
} from "@/persistence/drizzle/entity/council-metadata.entity.ts";
import { councilChannel } from "@/persistence/drizzle/entity/council-channel.entity.ts";
import { councilJurisdiction } from "@/persistence/drizzle/entity/council-jurisdiction.entity.ts";
import { councilProvider } from "@/persistence/drizzle/entity/council-provider.entity.ts";
import { providerJoinRequest } from "@/persistence/drizzle/entity/provider-join-request.entity.ts";
import { councilEscrow } from "@/persistence/drizzle/entity/council-escrow.entity.ts";
import { custodialUser } from "@/persistence/drizzle/entity/custodial-user.entity.ts";
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

  async upsert(data: Partial<Omit<NewCouncilMetadata, "id">> | Record<string, unknown>): Promise<CouncilMetadata> {
    const existing = await this.getConfig();
    if (existing) {
      // Only update fields that are explicitly provided (not undefined)
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) updates[key] = value;
      }
      const [updated] = await this.db
        .update(councilMetadata)
        .set(updates)
        .where(eq(councilMetadata.id, SINGLETON_ID))
        .returning();
      return updated;
    }
    const [created] = await this.db
      .insert(councilMetadata)
      .values({ id: SINGLETON_ID, ...data } as NewCouncilMetadata)
      .returning();
    return created;
  }

  async deleteAll(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(councilEscrow);
      await tx.delete(custodialUser);
      await tx.delete(providerJoinRequest);
      await tx.delete(councilProvider);
      await tx.delete(councilChannel);
      await tx.delete(councilJurisdiction);
      await tx.delete(councilMetadata);
    });
  }
}
