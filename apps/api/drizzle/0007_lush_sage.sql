CREATE TABLE "kol_chat_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"kol_id" integer NOT NULL,
	"title" text,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kol_chat_sessions" ADD CONSTRAINT "kol_chat_sessions_kol_id_kol_profiles_id_fk" FOREIGN KEY ("kol_id") REFERENCES "public"."kol_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kcs_kol_id_idx" ON "kol_chat_sessions" USING btree ("kol_id");--> statement-breakpoint
CREATE INDEX "ss_persona_ids_gin_idx" ON "source_segments" USING gin ("persona_ids");