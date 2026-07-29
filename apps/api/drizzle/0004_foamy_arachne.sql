CREATE TABLE "kol_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bilibili_uid" text,
	"persona_card" jsonb NOT NULL,
	"style_profile" jsonb NOT NULL,
	"source_texts" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kol_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"kol_id" integer NOT NULL,
	"bvid" text NOT NULL,
	"title" text NOT NULL,
	"original_text" text NOT NULL,
	"source_url" text,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kol_segments" ADD CONSTRAINT "kol_segments_kol_id_kol_profiles_id_fk" FOREIGN KEY ("kol_id") REFERENCES "public"."kol_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kol_uid_idx" ON "kol_profiles" USING btree ("bilibili_uid");--> statement-breakpoint
CREATE INDEX "ks_kol_id_idx" ON "kol_segments" USING btree ("kol_id");--> statement-breakpoint
CREATE INDEX "ks_bvid_idx" ON "kol_segments" USING btree ("bvid");