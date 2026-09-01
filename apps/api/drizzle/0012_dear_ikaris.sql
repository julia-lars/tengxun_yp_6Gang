CREATE TABLE "evidence_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"evidence_id" integer NOT NULL,
	"chat_session_id" integer,
	"message_index" integer,
	"rating" text NOT NULL,
	"query_text" text,
	"persona_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "respondents" ADD COLUMN "profile" jsonb;--> statement-breakpoint
ALTER TABLE "respondents" ADD COLUMN "gaming_background" jsonb;--> statement-breakpoint
ALTER TABLE "source_segments" ADD COLUMN "cleaning_status" text;--> statement-breakpoint
ALTER TABLE "source_segments" ADD COLUMN "cleaned_embedding" vector(1024);--> statement-breakpoint
CREATE INDEX "ef_evidence_id_idx" ON "evidence_feedback" USING btree ("evidence_id");--> statement-breakpoint
CREATE INDEX "ef_rating_idx" ON "evidence_feedback" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "ef_created_at_idx" ON "evidence_feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ss_cleaning_status_idx" ON "source_segments" USING btree ("cleaning_status");