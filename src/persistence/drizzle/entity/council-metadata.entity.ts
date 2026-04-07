import { pgTable, text } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

export const councilMetadata = pgTable("council_metadata", {
  id: text("id").primaryKey(), // channelAuthId — the council's unique on-chain address
  name: text("name").notNull(),
  description: text("description"),
  contactEmail: text("contact_email"),
  councilPublicKey: text("council_public_key").notNull(),
  opexPublicKey: text("opex_public_key"),
  // Per-council derivation root used by custodial key derivation. Random 32 bytes
  // generated on council create, encrypted at rest with SERVICE_AUTH_SECRET.
  encryptedDerivationRoot: text("encrypted_derivation_root").notNull(),
  ...createBaseColumns(),
});

export type CouncilMetadata = typeof councilMetadata.$inferSelect;
export type NewCouncilMetadata = typeof councilMetadata.$inferInsert;
