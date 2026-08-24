CREATE TABLE "pipeline_jobs" (
	"job_id" text PRIMARY KEY NOT NULL,
	"stage" text DEFAULT 'uploading' NOT NULL,
	"progress" integer DEFAULT 0,
	"estimated_total_ms" integer,
	"estimated_remaining_ms" integer,
	"stats" jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pipeline_jobs_stage_idx" ON "pipeline_jobs" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "pipeline_jobs_started_idx" ON "pipeline_jobs" USING btree ("started_at");