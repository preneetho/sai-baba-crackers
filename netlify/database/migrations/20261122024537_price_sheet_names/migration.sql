ALTER TABLE "catalogue_years" ADD COLUMN "name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "catalogue_sheet_name_unique" ON "catalogue_years" (lower(coalesce("name", "year"::text)));--> statement-breakpoint
ALTER TABLE "catalogue_years" ADD CONSTRAINT "catalogue_sheet_name" CHECK ("name" is null or (length("name") between 1 and 120
    and "name" = btrim("name") and "name" !~ '[[:cntrl:]]'));