import {
  bigint,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

export const councilChannel = pgTable("council_channels", {
  id: text("id").primaryKey(),
  councilId: text("council_id").notNull(),
  channelContractId: text("channel_contract_id").notNull(),
  assetCode: text("asset_code").notNull(),
  assetContractId: text("asset_contract_id"),
  label: text("label"),
  // Lifecycle status reflecting CONFIRMED on-chain state. Written ONLY by the
  // event-watcher (sole authoritative writer) from the channel-auth
  // ChannelStateChanged event — never by the HTTP endpoints. "disabled" means
  // withdraw-only; providers converge on this via the public channel query.
  status: text("status").notNull().default("enabled"),
  // UX-only optimistic marker: which lifecycle action the council requested but
  // that has not yet been confirmed on-chain ("enable" | "disable" | null). Set
  // by the endpoint, cleared by the watcher on confirmation. NOT authoritative.
  pendingAction: text("pending_action"),
  // Cached on-chain state (refreshed on demand)
  totalDeposited: bigint("total_deposited", { mode: "bigint" }),
  totalWithdrawn: bigint("total_withdrawn", { mode: "bigint" }),
  utxoCount: bigint("utxo_count", { mode: "bigint" }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  ...createBaseColumns(),
}, (table) => [
  uniqueIndex("idx_channel_council_contract").on(
    table.councilId,
    table.channelContractId,
  ),
]);

/** Confirmed on-chain lifecycle status of a channel. */
export const ChannelStatus = {
  ENABLED: "enabled",
  DISABLED: "disabled",
} as const;
export type ChannelStatusValue =
  (typeof ChannelStatus)[keyof typeof ChannelStatus];

/** Optimistic, UX-only marker for an unconfirmed lifecycle request. */
export const ChannelPendingAction = {
  ENABLE: "enable",
  DISABLE: "disable",
} as const;
export type ChannelPendingActionValue =
  (typeof ChannelPendingAction)[keyof typeof ChannelPendingAction];

export type CouncilChannel = typeof councilChannel.$inferSelect;
export type NewCouncilChannel = typeof councilChannel.$inferInsert;
