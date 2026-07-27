CREATE TYPE "public"."speaker_role" AS ENUM('interviewee', 'moderator');--> statement-breakpoint
CREATE TABLE "respondents" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_file" text NOT NULL,
	"speaker_id" text NOT NULL,
	"display_name" text,
	"group_code" text,
	"background" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_segments" ADD COLUMN "speaker_id" text;--> statement-breakpoint
ALTER TABLE "source_segments" ADD COLUMN "speaker_role" "speaker_role" DEFAULT 'interviewee' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_segments" ADD COLUMN "preceding_question" text;--> statement-breakpoint
ALTER TABLE "source_segments" ADD COLUMN "char_count" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "resp_source_speaker_idx" ON "respondents" USING btree ("source_file","speaker_id");--> statement-breakpoint
CREATE INDEX "ss_speaker_id_idx" ON "source_segments" USING btree ("speaker_id");