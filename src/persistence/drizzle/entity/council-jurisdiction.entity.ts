import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

export const councilJurisdiction = pgTable("council_jurisdictions", {
  id: text("id").primaryKey(),
  councilId: text("council_id").notNull(),
  countryCode: text("country_code").notNull(), // ISO 3166-1 alpha-2
  label: text("label"), // human-readable, e.g. "Uruguay"
  ...createBaseColumns(),
}, (table) => [
  uniqueIndex("idx_jurisdiction_council_country").on(
    table.councilId,
    table.countryCode,
  ),
]);

export type CouncilJurisdiction = typeof councilJurisdiction.$inferSelect;
export type NewCouncilJurisdiction = typeof councilJurisdiction.$inferInsert;
