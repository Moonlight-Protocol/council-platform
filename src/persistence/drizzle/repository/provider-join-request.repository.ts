import { eq, and, isNull } from "drizzle-orm";
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

  async findPendingByPublicKey(publicKey: string): Promise<ProviderJoinRequest | undefined> {
    const [result] = await this.db
      .select()
      .from(providerJoinRequest)
      .where(
        and(
          eq(providerJoinRequest.publicKey, publicKey),
          eq(providerJoinRequest.status, JoinRequestStatus.PENDING),
          isNull(providerJoinRequest.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }

  async listPending(): Promise<ProviderJoinRequest[]> {
    return await this.db
      .select()
      .from(providerJoinRequest)
      .where(
        and(
          eq(providerJoinRequest.status, JoinRequestStatus.PENDING),
          isNull(providerJoinRequest.deletedAt),
        ),
      )
      .orderBy(providerJoinRequest.createdAt);
  }

  async listAll(): Promise<ProviderJoinRequest[]> {
    return await this.db
      .select()
      .from(providerJoinRequest)
      .where(isNull(providerJoinRequest.deletedAt))
      .orderBy(providerJoinRequest.createdAt);
  }
}
