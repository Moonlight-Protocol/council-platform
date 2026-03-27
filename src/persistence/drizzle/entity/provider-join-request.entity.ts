import { pgTable, text, pgEnum, timestamp } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

export enum JoinRequestStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}

export const joinRequestStatusEnum = pgEnum("join_request_status", [
  JoinRequestStatus.PENDING,
  JoinRequestStatus.APPROVED,
  JoinRequestStatus.REJECTED,
]);

export const providerJoinRequest = pgTable("provider_join_requests", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  label: text("label"),
  contactEmail: text("contact_email"),
  status: joinRequestStatusEnum("status").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: text("reviewed_by"),
  ...createBaseColumns(),
});

export type ProviderJoinRequest = typeof providerJoinRequest.$inferSelect;
export type NewProviderJoinRequest = typeof providerJoinRequest.$inferInsert;
