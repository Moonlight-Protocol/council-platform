import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Append-only log of aggregate, network-wide events surfaced to the public
 * network-dashboard. Rolling 24h retention — older rows are purged by the
 * retention process. Not for operator audit; not authoritative for any
 * business logic. Display layer only.
 */
export const networkEvent = pgTable("network_events", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  councilId: text("council_id").notNull(),
  ledger: bigint("ledger", { mode: "number" }),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(
    {},
  ),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
}, (table) => [
  index("idx_network_events_occurred_at").on(table.occurredAt),
]);

export type NetworkEvent = typeof networkEvent.$inferSelect;
export type NewNetworkEvent = typeof networkEvent.$inferInsert;

/**
 * The six aggregate event kinds the network-dashboard renders. Validated
 * app-side rather than via a Postgres enum so adding a kind doesn't need a
 * schema migration. Keep this union and the design sketch in sync.
 */
export type NetworkEventKind =
  | "council_formed"
  | "provider_added"
  | "provider_removed"
  | "asset_registered"
  | "channel_deposit"
  | "channel_settlement";

export const NETWORK_EVENT_KINDS: readonly NetworkEventKind[] = [
  "council_formed",
  "provider_added",
  "provider_removed",
  "asset_registered",
  "channel_deposit",
  "channel_settlement",
] as const;
