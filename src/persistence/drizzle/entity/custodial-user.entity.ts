import { pgTable, text, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

export enum CustodialUserStatus {
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
}

export const custodialUserStatusEnum = pgEnum("custodial_user_status", [
  CustodialUserStatus.ACTIVE,
  CustodialUserStatus.SUSPENDED,
]);

/**
 * Non-custodial users whose UTXO keys are managed by the council.
 *
 * Each user is identified by an external identifier (e.g. Stellar address
 * from PP onboarding, or a username from custodial flow). The council
 * derives P256 keys for the user per channel using a deterministic
 * derivation from the council's root key + user ID + channel contract ID.
 */
export const custodialUser = pgTable("custodial_users", {
  id: text("id").primaryKey(),
  councilId: text("council_id").notNull(),
  externalId: text("external_id").notNull(), // identifier from PP (e.g. Stellar address or UUID)
  channelContractId: text("channel_contract_id").notNull(),
  // The derived P256 root public key for this user+channel (hex-encoded)
  p256PublicKeyHex: text("p256_public_key_hex").notNull(),
  status: custodialUserStatusEnum("status").notNull(),
  registeredByProvider: text("registered_by_provider"), // PP public key that onboarded this user
  ...createBaseColumns(),
}, (table) => [
  uniqueIndex("idx_custodial_user_external_channel").on(
    table.externalId,
    table.channelContractId,
  ),
]);

export type CustodialUser = typeof custodialUser.$inferSelect;
export type NewCustodialUser = typeof custodialUser.$inferInsert;
