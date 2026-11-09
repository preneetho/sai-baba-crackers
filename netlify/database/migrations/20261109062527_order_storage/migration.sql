CREATE TABLE "order_items" (
	"order_id" text,
	"position" integer,
	"product_id" integer NOT NULL,
	"name" text NOT NULL,
	"brand" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"amount_paise" integer NOT NULL,
	CONSTRAINT "order_items_pkey" PRIMARY KEY("order_id","position"),
	CONSTRAINT "order_items_values_check" CHECK ("position" >= 0 and "product_id" > 0
    and "quantity" between 1 and 99 and "unit_price_paise" >= 0
    and "amount_paise" = "unit_price_paise" * "quantity")
);
--> statement-breakpoint
CREATE TABLE "order_requests" (
	"order_id" text PRIMARY KEY,
	"fingerprint" text NOT NULL,
	"season" integer NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"status" text DEFAULT 'New' NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"address" text NOT NULL,
	"fulfilment" text NOT NULL,
	"preferred_date" text NOT NULL,
	"notes" text NOT NULL,
	"subtotal_paise" integer NOT NULL,
	"discount_percent" integer NOT NULL,
	"discount_paise" integer NOT NULL,
	"delivery_charge_paise" integer NOT NULL,
	"total_paise" integer NOT NULL,
	CONSTRAINT "order_requests_status_check" CHECK ("status" in ('New', 'Contacted', 'Confirmed', 'Preparing', 'Out for delivery', 'Ready for pickup', 'Completed', 'Cancelled')),
	CONSTRAINT "order_requests_fulfilment_check" CHECK ("fulfilment" in ('delivery', 'pickup')),
	CONSTRAINT "order_requests_season_check" CHECK ("season" between 2000 and 9999),
	CONSTRAINT "order_requests_money_check" CHECK ("subtotal_paise" >= 0 and "discount_paise" >= 0
    and "delivery_charge_paise" >= 0 and "total_paise" >= 0
    and "discount_percent" between 0 and 100
    and "total_paise" = "subtotal_paise" - "discount_paise" + "delivery_charge_paise")
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"order_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor" text NOT NULL,
	"changed_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_status_history_status_check" CHECK ("to_status" in ('New', 'Contacted', 'Confirmed', 'Preparing', 'Out for delivery', 'Ready for pickup', 'Completed', 'Cancelled')
    and ("from_status" is null or "from_status" in ('New', 'Contacted', 'Confirmed', 'Preparing', 'Out for delivery', 'Ready for pickup', 'Completed', 'Cancelled')))
);
--> statement-breakpoint
CREATE INDEX "order_requests_time_idx" ON "order_requests" ("created_at" DESC NULLS LAST,"order_id");--> statement-breakpoint
CREATE INDEX "order_requests_status_time_idx" ON "order_requests" ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "order_requests_season_idx" ON "order_requests" ("season");--> statement-breakpoint
CREATE INDEX "order_status_history_order_idx" ON "order_status_history" ("order_id","changed_at");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_order_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order_requests"("order_id");--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_order_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order_requests"("order_id");