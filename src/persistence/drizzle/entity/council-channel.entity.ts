import { pgTable, text, bigint, timestamp } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

export const councilChannel = pgTable("council_channels", {
  id: text("id").primaryKey(),
  channelContractId: text("channel_contract_id").notNull().unique(),
  assetCode: text("asset_code").notNull(),
  assetContractId: text("asset_contract_id"),
  label: text("label"),
  // Cached on-chain state (refreshed on demand)
  totalDeposited: bigint("total_deposited", { mode: "bigint" }),
  totalWithdrawn: bigint("total_withdrawn", { mode: "bigint" }),
  utxoCount: bigint("utxo_count", { mode: "bigint" }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  ...createBaseColumns(),
});

export type CouncilChannel = typeof councilChannel.$inferSelect;
export type NewCouncilChannel = typeof councilChannel.$inferInsert;
