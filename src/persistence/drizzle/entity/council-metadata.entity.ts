import { pgTable, text } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

export const councilMetadata = pgTable("council_metadata", {
  id: text("id").primaryKey(), // singleton: "default"
  name: text("name").notNull(),
  description: text("description"),
  contactEmail: text("contact_email"),
  channelAuthId: text("channel_auth_id").notNull(),
  councilPublicKey: text("council_public_key").notNull(),
  opexPublicKey: text("opex_public_key"),
  ...createBaseColumns(),
});

export type CouncilMetadata = typeof councilMetadata.$inferSelect;
export type NewCouncilMetadata = typeof councilMetadata.$inferInsert;
