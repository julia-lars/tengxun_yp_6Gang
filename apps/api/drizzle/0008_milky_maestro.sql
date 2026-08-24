ALTER TABLE "source_segments" ADD COLUMN "embedding_version" text;--> statement-breakpoint
ALTER TABLE "source_segments" ADD COLUMN "embedded_at" timestamp with time zone;