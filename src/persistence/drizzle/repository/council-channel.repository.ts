import { and, eq, isNull } from "drizzle-orm";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";
import {
  type ChannelPendingActionValue,
  ChannelStatus,
  type ChannelStatusValue,
  type CouncilChannel,
  councilChannel,
  type NewCouncilChannel,
} from "@/persistence/drizzle/entity/council-channel.entity.ts";
import type { DbOrTx } from "@/persistence/drizzle/config.ts";

export class CouncilChannelRepository extends BaseRepository<
  typeof councilChannel,
  CouncilChannel,
  NewCouncilChannel
> {
  constructor(db: DbOrTx) {
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
          isNull(councilChannel.deletedAt),
          eq(councilChannel.status, ChannelStatus.DISABLED),
        ),
      )
      .orderBy(councilChannel.createdAt);
  }

  /**
   * Authoritative status write — the ONLY path that mutates `status`. Called by
   * the event-watcher when a ChannelStateChanged event is confirmed on-chain.
   * Clears any optimistic `pendingAction` marker. Scoped by council so a
   * channel id reused across councils can't be cross-written. Returns the
   * updated row, or undefined if no matching channel exists.
   */
  async setStatusByContractId(
    councilId: string,
    contractId: string,
    status: ChannelStatusValue,
  ): Promise<CouncilChannel | undefined> {
    const [result] = await this.db
      .update(councilChannel)
      .set({ status, pendingAction: null, updatedAt: new Date() })
      .where(
        and(
          eq(councilChannel.councilId, councilId),
          eq(councilChannel.channelContractId, contractId),
        ),
      )
      .returning();
    return result;
  }

  /**
   * Sets the optimistic UX-only `pendingAction` marker. Never touches `status`
   * (that is the watcher's job). Used by the enable/disable endpoints.
   */
  async setPendingAction(
    id: string,
    action: ChannelPendingActionValue | null,
  ): Promise<CouncilChannel> {
    const [result] = await this.db
      .update(councilChannel)
      .set({ pendingAction: action, updatedAt: new Date() })
      .where(eq(councilChannel.id, id))
      .returning();
    return result;
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
}
