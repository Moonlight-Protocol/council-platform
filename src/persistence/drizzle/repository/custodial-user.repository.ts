import { and, eq, isNull } from "drizzle-orm";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";
import {
  type CustodialUser,
  custodialUser,
  type NewCustodialUser,
} from "@/persistence/drizzle/entity/custodial-user.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class CustodialUserRepository extends BaseRepository<
  typeof custodialUser,
  CustodialUser,
  NewCustodialUser
> {
  constructor(db: DrizzleClient) {
    super(db, custodialUser);
  }

  async findByExternalIdAndChannel(
    externalId: string,
    channelContractId: string,
  ): Promise<CustodialUser | undefined> {
    const [result] = await this.db
      .select()
      .from(custodialUser)
      .where(
        and(
          eq(custodialUser.externalId, externalId),
          eq(custodialUser.channelContractId, channelContractId),
          isNull(custodialUser.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }

  async listByChannel(channelContractId: string): Promise<CustodialUser[]> {
    return await this.db
      .select()
      .from(custodialUser)
      .where(
        and(
          eq(custodialUser.channelContractId, channelContractId),
          isNull(custodialUser.deletedAt),
        ),
      )
      .orderBy(custodialUser.createdAt);
  }
}
