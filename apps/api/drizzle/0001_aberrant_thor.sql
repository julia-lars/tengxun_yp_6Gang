CREATE TABLE "chat_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"persona_id" integer NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"tag_spec" jsonb NOT NULL,
	"motivation_chain" jsonb,
	"evidence_ids" integer[],
	"cluster_id" text,
	"sample_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_file" text NOT NULL,
	"segment_index" integer DEFAULT 0 NOT NULL,
	"original_text" text NOT NULL,
	"cleaned_text" text,
	"annotation" jsonb,
	"embedding" text,
	"persona_ids" integer[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_persona_idx" ON "chat_sessions" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "personas_cluster_idx" ON "personas" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "ss_source_file_idx" ON "source_segments" USING btree ("source_file");