CREATE TABLE IF NOT EXISTS "network_events" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"council_id" text NOT NULL,
	"ledger" bigint,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_network_events_occurred_at" ON "network_events" USING btree ("occurred_at");
