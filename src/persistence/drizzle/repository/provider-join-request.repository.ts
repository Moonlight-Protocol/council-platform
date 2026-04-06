import { eq, and, isNull, desc } from "drizzle-orm";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";
import {
  providerJoinRequest,
  type ProviderJoinRequest,
  type NewProviderJoinRequest,
  JoinRequestStatus,
} from "@/persistence/drizzle/entity/provider-join-request.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class ProviderJoinRequestRepository extends BaseRepository<
  typeof providerJoinRequest,
  ProviderJoinRequest,
  NewProviderJoinRequest
> {
  constructor(db: DrizzleClient) {
    super(db, providerJoinRequest);
  }

  async findPendingByPublicKey(councilId: string, publicKey: string): Promise<ProviderJoinRequest | undefined> {
    const [result] = await this.db
      .select()
      .from(providerJoinRequest)
      .where(
        and(
          eq(providerJoinRequest.councilId, councilId),
          eq(providerJoinRequest.publicKey, publicKey),
          eq(providerJoinRequest.status, JoinRequestStatus.PENDING),
          isNull(providerJoinRequest.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }

  async findLatestByPublicKey(councilId: string, publicKey: string): Promise<ProviderJoinRequest | undefined> {
    const [result] = await this.db
      .select()
      .from(providerJoinRequest)
      .where(
        and(
          eq(providerJoinRequest.councilId, councilId),
          eq(providerJoinRequest.publicKey, publicKey),
          isNull(providerJoinRequest.deletedAt),
        ),
      )
      .orderBy(desc(providerJoinRequest.createdAt))
      .limit(1);
    return result;
  }

  async listPending(councilId: string, limit = 100): Promise<ProviderJoinRequest[]> {
    return await this.db
      .select()
      .from(providerJoinRequest)
      .where(
        and(
          eq(providerJoinRequest.councilId, councilId),
          eq(providerJoinRequest.status, JoinRequestStatus.PENDING),
          isNull(providerJoinRequest.deletedAt),
        ),
      )
      .orderBy(providerJoinRequest.createdAt)
      .limit(limit);
  }

  async listAll(councilId: string, limit = 100): Promise<ProviderJoinRequest[]> {
    return await this.db
      .select()
      .from(providerJoinRequest)
      .where(
        and(
          eq(providerJoinRequest.councilId, councilId),
          isNull(providerJoinRequest.deletedAt),
        ),
      )
      .orderBy(providerJoinRequest.createdAt)
      .limit(limit);
  }
}
