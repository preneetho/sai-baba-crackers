ALTER TABLE "order_requests" ADD COLUMN "packing_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_requests" ADD COLUMN "packing_items" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_packing_check" CHECK ("packing_version" >= 0 and
    jsonb_typeof("packing_items") = 'array' and jsonb_array_length("packing_items") <= 200);