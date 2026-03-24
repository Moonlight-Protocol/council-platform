import { eq, and, isNull } from "drizzle-orm";
import { BaseRepository } from "@/persistence/drizzle/repository/base.repository.ts";
import {
  councilEscrow,
  type CouncilEscrow,
  type NewCouncilEscrow,
  EscrowStatus,
} from "@/persistence/drizzle/entity/council-escrow.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class CouncilEscrowRepository extends BaseRepository<
  typeof councilEscrow,
  CouncilEscrow,
  NewCouncilEscrow
> {
  constructor(db: DrizzleClient) {
    super(db, councilEscrow);
  }

  async findHeldForRecipient(recipientAddress: string): Promise<CouncilEscrow[]> {
    return await this.db
      .select()
      .from(councilEscrow)
      .where(
        and(
          eq(councilEscrow.recipientAddress, recipientAddress),
          eq(councilEscrow.status, EscrowStatus.HELD),
          isNull(councilEscrow.deletedAt),
        ),
      )
      .orderBy(councilEscrow.createdAt);
  }

  async findByRecipient(recipientAddress: string): Promise<CouncilEscrow[]> {
    return await this.db
      .select()
      .from(councilEscrow)
      .where(
        and(
          eq(councilEscrow.recipientAddress, recipientAddress),
          isNull(councilEscrow.deletedAt),
        ),
      )
      .orderBy(councilEscrow.createdAt);
  }
}
