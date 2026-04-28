import { and, eq } from "drizzle-orm";
import {
  type KnownAsset,
  knownAsset,
} from "@/persistence/drizzle/entity/known-asset.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class KnownAssetRepository {
  constructor(private db: DrizzleClient) {}

  async listAll(): Promise<KnownAsset[]> {
    return await this.db.select().from(knownAsset).orderBy(
      knownAsset.assetCode,
    );
  }

  async upsert(assetCode: string, issuerAddress: string): Promise<KnownAsset> {
    const [result] = await this.db
      .insert(knownAsset)
      .values({ id: `${assetCode}:${issuerAddress}`, assetCode, issuerAddress })
      .onConflictDoNothing({ target: knownAsset.id })
      .returning();

    if (result) return result;

    // Conflict — row already exists, fetch it
    const [existing] = await this.db
      .select()
      .from(knownAsset)
      .where(
        and(
          eq(knownAsset.assetCode, assetCode),
          eq(knownAsset.issuerAddress, issuerAddress),
        ),
      )
      .limit(1);
    return existing;
  }
}
