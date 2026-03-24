import { eq, and, isNull } from "drizzle-orm";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";
import {
  councilProvider,
  type CouncilProvider,
  type NewCouncilProvider,
  ProviderStatus,
} from "@/persistence/drizzle/entity/council-provider.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class CouncilProviderRepository extends BaseRepository<
  typeof councilProvider,
  CouncilProvider,
  NewCouncilProvider
> {
  constructor(db: DrizzleClient) {
    super(db, councilProvider);
  }

  async findByPublicKey(publicKey: string): Promise<CouncilProvider | undefined> {
    const [result] = await this.db
      .select()
      .from(councilProvider)
      .where(
        and(
          eq(councilProvider.publicKey, publicKey),
          isNull(councilProvider.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }

  async listActive(): Promise<CouncilProvider[]> {
    return await this.db
      .select()
      .from(councilProvider)
      .where(
        and(
          eq(councilProvider.status, ProviderStatus.ACTIVE),
          isNull(councilProvider.deletedAt),
        ),
      )
      .orderBy(councilProvider.createdAt);
  }

  async listAll(): Promise<CouncilProvider[]> {
    return await this.db
      .select()
      .from(councilProvider)
      .where(isNull(councilProvider.deletedAt))
      .orderBy(councilProvider.createdAt);
  }
}
