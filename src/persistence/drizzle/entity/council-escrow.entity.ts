import { pgTable, text, pgEnum, bigint, index } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

export enum EscrowStatus {
  HELD = "HELD",
  RELEASED = "RELEASED",
  EXPIRED = "EXPIRED",
}

export const escrowStatusEnum = pgEnum("escrow_status", [
  EscrowStatus.HELD,
  EscrowStatus.RELEASED,
  EscrowStatus.EXPIRED,
]);

export const councilEscrow = pgTable("council_escrows", {
  id: text("id").primaryKey(),
  senderAddress: text("sender_address").notNull(),
  recipientAddress: text("recipient_address").notNull(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  assetCode: text("asset_code").notNull(),
  channelContractId: text("channel_contract_id").notNull(),
  status: escrowStatusEnum("status").notNull(),
  submittedByProvider: text("submitted_by_provider").notNull(), // PP public key
  releaseTxHash: text("release_tx_hash"), // set on release
  feeCharged: bigint("fee_charged", { mode: "bigint" }), // set on release
  ...createBaseColumns(),
}, (table) => [
  index("idx_escrow_recipient").on(table.recipientAddress),
  index("idx_escrow_status").on(table.status),
]);

export type CouncilEscrow = typeof councilEscrow.$inferSelect;
export type NewCouncilEscrow = typeof councilEscrow.$inferInsert;
