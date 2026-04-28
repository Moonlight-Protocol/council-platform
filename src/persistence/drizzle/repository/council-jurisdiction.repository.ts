import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";
import {
  type CouncilJurisdiction,
  councilJurisdiction,
  type NewCouncilJurisdiction,
} from "@/persistence/drizzle/entity/council-jurisdiction.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class CouncilJurisdictionRepository extends BaseRepository<
  typeof councilJurisdiction,
  CouncilJurisdiction,
  NewCouncilJurisdiction
> {
  constructor(db: DrizzleClient) {
    super(db, councilJurisdiction);
  }

  async findByCountryCode(
    councilId: string,
    code: string,
  ): Promise<CouncilJurisdiction | undefined> {
    const [result] = await this.db
      .select()
      .from(councilJurisdiction)
      .where(
        and(
          eq(councilJurisdiction.councilId, councilId),
          eq(councilJurisdiction.countryCode, code.toUpperCase()),
          isNull(councilJurisdiction.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }

  async findDeletedByCountryCode(
    councilId: string,
    code: string,
  ): Promise<CouncilJurisdiction | undefined> {
    const [result] = await this.db
      .select()
      .from(councilJurisdiction)
      .where(
        and(
          eq(councilJurisdiction.councilId, councilId),
          eq(councilJurisdiction.countryCode, code.toUpperCase()),
          isNotNull(councilJurisdiction.deletedAt),
        ),
      )
      .limit(1);
    return result;
  }

  async listAll(councilId: string): Promise<CouncilJurisdiction[]> {
    return await this.db
      .select()
      .from(councilJurisdiction)
      .where(
        and(
          eq(councilJurisdiction.councilId, councilId),
          isNull(councilJurisdiction.deletedAt),
        ),
      )
      .orderBy(councilJurisdiction.countryCode);
  }
}
