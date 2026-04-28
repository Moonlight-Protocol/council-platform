import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";
import {
  type CouncilChannel,
  councilChannel,
  type NewCouncilChannel,
} from "@/persistence/drizzle/entity/council-channel.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class CouncilChannelRepository extends BaseRepository<
  typeof councilChannel,
  CouncilChannel,
  NewCouncilChannel
> {
  constructor(db: DrizzleClient) {
    super(db, councilChannel);
  }

  async findByContractId(
    councilId: string,
    contractId: string,
  ): Promise<CouncilChannel | undefined> {
    const [result] = await this.db
      .select()
      .from(councilChannel)
      .where(
        and(
          eq(councilChannel.councilId, councilId),
          eq(councilChannel.channelContractId, contractId),
          isNull(councilChannel.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }

  async listAll(councilId: string): Promise<CouncilChannel[]> {
    return await this.db
      .select()
      .from(councilChannel)
      .where(
        and(
          eq(councilChannel.councilId, councilId),
          isNull(councilChannel.deletedAt),
        ),
      )
      .orderBy(councilChannel.createdAt);
  }

  async listDisabled(councilId: string): Promise<CouncilChannel[]> {
    return await this.db
      .select()
      .from(councilChannel)
      .where(
        and(
          eq(councilChannel.councilId, councilId),
          isNotNull(councilChannel.deletedAt),
        ),
      )
      .orderBy(councilChannel.createdAt);
  }

  async findByContractIdIncludeDeleted(
    contractId: string,
  ): Promise<CouncilChannel | undefined> {
    const [result] = await this.db
      .select()
      .from(councilChannel)
      .where(eq(councilChannel.channelContractId, contractId))
      .limit(1);
    return result;
  }

  async findByIdIncludeDeleted(
    id: string,
  ): Promise<CouncilChannel | undefined> {
    const [result] = await this.db
      .select()
      .from(councilChannel)
      .where(eq(councilChannel.id, id))
      .limit(1);
    return result;
  }

  async restore(id: string): Promise<CouncilChannel> {
    const [result] = await this.db
      .update(councilChannel)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(councilChannel.id, id))
      .returning();
    return result;
  }
}
