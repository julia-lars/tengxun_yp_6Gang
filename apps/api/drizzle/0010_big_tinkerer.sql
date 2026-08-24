CREATE TABLE "batch_interview_jobs" (
	"job_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0,
	"estimated_total_ms" integer,
	"estimated_remaining_ms" integer,
	"completed_personas" integer[] DEFAULT '{}',
	"total_personas" integer,
	"total_rounds" integer DEFAULT 0,
	"progress_by_persona" jsonb,
	"started_at" timestamp with time zone,
	"estimated_completion_at" timestamp with time zone,
	"error" text,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_interview_reports" (
	"job_id" text PRIMARY KEY NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_outlines" (
	"id" text PRIMARY KEY NOT NULL,
	"theme" text NOT NULL,
	"target_persona" text,
	"description" text,
	"sections" jsonb NOT NULL,
	"total_duration_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outline_jobs" (
	"job_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0,
	"estimated_total_ms" integer,
	"estimated_remaining_ms" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"result_outline_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "batch_jobs_status_idx" ON "batch_interview_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "batch_jobs_started_idx" ON "batch_interview_jobs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "outline_jobs_status_idx" ON "outline_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "outline_jobs_started_idx" ON "outline_jobs" USING btree ("started_at");