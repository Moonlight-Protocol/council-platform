import { eq, and, isNull } from "drizzle-orm";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";
import {
  councilChannel,
  type CouncilChannel,
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

  async findByContractId(contractId: string): Promise<CouncilChannel | undefined> {
    const [result] = await this.db
      .select()
      .from(councilChannel)
      .where(
        and(
          eq(councilChannel.channelContractId, contractId),
          isNull(councilChannel.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }

  async listAll(): Promise<CouncilChannel[]> {
    return await this.db
      .select()
      .from(councilChannel)
      .where(isNull(councilChannel.deletedAt))
      .orderBy(councilChannel.createdAt);
  }
}
