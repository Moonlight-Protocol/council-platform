import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const knownAsset = pgTable("known_assets", {
  id: text("id").primaryKey(),
  assetCode: text("asset_code").notNull(),
  issuerAddress: text("issuer_address").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KnownAsset = typeof knownAsset.$inferSelect;
export type NewKnownAsset = typeof knownAsset.$inferInsert;
