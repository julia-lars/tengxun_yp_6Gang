CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"record_id" integer NOT NULL,
	"action" text NOT NULL,
	"changed_by" text DEFAULT 'admin',
	"old_data" jsonb,
	"new_data" jsonb,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"target_table" text NOT NULL,
	"file_name" text,
	"total_rows" integer DEFAULT 0,
	"inserted" integer DEFAULT 0,
	"updated" integer DEFAULT 0,
	"skipped" integer DEFAULT 0,
	"errors" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'pending',
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_table_record_idx" ON "audit_log" USING btree ("table_name","record_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_changed_at_idx" ON "audit_log" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "import_jobs_status_idx" ON "import_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "import_jobs_target_idx" ON "import_jobs" USING btree ("target_table");