CREATE TABLE "customer_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"firebase_project" text NOT NULL,
	"firebase_uid" text NOT NULL,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"is_test" boolean NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_requests" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "order_requests" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_accounts_identity_idx" ON "customer_accounts" ("firebase_project","firebase_uid","is_test");--> statement-breakpoint
CREATE INDEX "order_requests_customer_time_idx" ON "order_requests" ("customer_id","created_at" DESC NULLS LAST,"order_id");--> statement-breakpoint
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_customer_id_customer_accounts_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_accounts"("id");