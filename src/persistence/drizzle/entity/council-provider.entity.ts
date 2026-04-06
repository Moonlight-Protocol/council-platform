import { pgTable, text, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

export enum ProviderStatus {
  ACTIVE = "ACTIVE",
  REMOVED = "REMOVED",
}

export const providerStatusEnum = pgEnum("provider_status", [
  ProviderStatus.ACTIVE,
  ProviderStatus.REMOVED,
]);

export const councilProvider = pgTable("council_providers", {
  id: text("id").primaryKey(),
  councilId: text("council_id").notNull(),
  publicKey: text("public_key").notNull(), // Ed25519 Stellar address (G...)
  status: providerStatusEnum("status").notNull(),
  label: text("label"),
  contactEmail: text("contact_email"),
  // Which channel auth event registered this provider
  registeredByEvent: text("registered_by_event"),
  removedByEvent: text("removed_by_event"),
  ...createBaseColumns(),
}, (table) => [
  uniqueIndex("idx_provider_council_pk").on(table.councilId, table.publicKey),
]);

export type CouncilProvider = typeof councilProvider.$inferSelect;
export type NewCouncilProvider = typeof councilProvider.$inferInsert;
