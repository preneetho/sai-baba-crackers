CREATE TABLE "telemetry_events" (
	"id" uuid PRIMARY KEY,
	"session" uuid NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "telemetry_time_idx" ON "telemetry_events" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telemetry_session_type_idx" ON "telemetry_events" ("session","type");