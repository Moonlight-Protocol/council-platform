import { eq, and, isNull } from "drizzle-orm";
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

export class CouncilMetadataRepository extends BaseRepository<
  typeof councilMetadata,
  CouncilMetadata,
  NewCouncilMetadata
> {
  constructor(db: DrizzleClient) {
    super(db, councilMetadata);
  }

  /** Get an active (non-deleted) council by its ID. */
  async getById(councilId: string): Promise<CouncilMetadata | undefined> {
    const [result] = await this.db
      .select()
      .from(councilMetadata)
      .where(and(eq(councilMetadata.id, councilId), isNull(councilMetadata.deletedAt)))
      .limit(1);
    return result;
  }

  /** Get a council by ID including soft-deleted (for restore). */
  async getByIdIncludingDeleted(councilId: string): Promise<CouncilMetadata | undefined> {
    const [result] = await this.db
      .select()
      .from(councilMetadata)
      .where(eq(councilMetadata.id, councilId))
      .limit(1);
    return result;
  }

  /** List all councils. */
  async listAll(): Promise<CouncilMetadata[]> {
    return await this.db
      .select()
      .from(councilMetadata)
      .where(isNull(councilMetadata.deletedAt))
      .orderBy(councilMetadata.createdAt);
  }

  /** Create or update a council using ON CONFLICT to avoid TOCTOU races. */
  async upsert(councilId: string, data: Partial<Omit<NewCouncilMetadata, "id">> | Record<string, unknown>): Promise<CouncilMetadata> {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) updates[key] = value;
    }
    const [result] = await this.db
      .insert(councilMetadata)
      .values({ id: councilId, ...data, createdAt: new Date(), updatedAt: new Date() } as NewCouncilMetadata)
      .onConflictDoUpdate({
        target: councilMetadata.id,
        set: updates,
      })
      .returning();
    return result;
  }

  /** Hard-delete a council and all related records. */
  async deleteCouncil(councilId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(custodialUser).where(eq(custodialUser.councilId, councilId));
      await tx.delete(councilEscrow).where(eq(councilEscrow.councilId, councilId));
      await tx.delete(providerJoinRequest).where(eq(providerJoinRequest.councilId, councilId));
      await tx.delete(councilProvider).where(eq(councilProvider.councilId, councilId));
      await tx.delete(councilJurisdiction).where(eq(councilJurisdiction.councilId, councilId));
      await tx.delete(councilChannel).where(eq(councilChannel.councilId, councilId));
      await tx.delete(councilMetadata).where(eq(councilMetadata.id, councilId));
    });
  }

  /** List active councils owned by a specific wallet. */
  async listByOwner(ownerPublicKey: string): Promise<CouncilMetadata[]> {
    return await this.db
      .select()
      .from(councilMetadata)
      .where(
        and(
          eq(councilMetadata.councilPublicKey, ownerPublicKey),
          isNull(councilMetadata.deletedAt),
        ),
      )
      .orderBy(councilMetadata.createdAt);
  }

  /** Get a council by ID, scoped to owner. Returns undefined if not owned. */
  async getByIdAndOwner(councilId: string, ownerPublicKey: string): Promise<CouncilMetadata | undefined> {
    const [result] = await this.db
      .select()
      .from(councilMetadata)
      .where(
        and(
          eq(councilMetadata.id, councilId),
          eq(councilMetadata.councilPublicKey, ownerPublicKey),
          isNull(councilMetadata.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }

}
