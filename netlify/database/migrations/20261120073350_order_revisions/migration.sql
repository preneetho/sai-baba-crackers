CREATE TABLE "order_revisions" (
	"order_id" text,
	"revision" integer,
	"changed_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"reason" text NOT NULL,
	"items" jsonb NOT NULL,
	"subtotal_paise" integer NOT NULL,
	"discount_percent" integer NOT NULL,
	"discount_paise" integer NOT NULL,
	"delivery_charge_paise" integer NOT NULL,
	"total_paise" integer NOT NULL,
	CONSTRAINT "order_revisions_pkey" PRIMARY KEY("order_id","revision"),
	CONSTRAINT "order_revisions_values_check" CHECK ("revision" >= 0 and length(trim("reason")) between 1 and 500
    and jsonb_typeof("items") = 'array' and jsonb_array_length("items") between 1 and 200),
	CONSTRAINT "order_revisions_money_check" CHECK ("subtotal_paise" >= 0 and "discount_paise" >= 0
    and "delivery_charge_paise" >= 0 and "discount_percent" between 0 and 100
    and "total_paise" >= 0
    and "total_paise" = "subtotal_paise" - "discount_paise" + "delivery_charge_paise")
);
--> statement-breakpoint
ALTER TABLE "order_requests" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_revisions" ADD CONSTRAINT "order_revisions_order_id_order_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order_requests"("order_id");--> statement-breakpoint
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_revision_check" CHECK ("revision" >= 0);