import { pgTable, integer, jsonb, text, timestamp, primaryKey, check, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const catalogueYears = pgTable("catalogue_years", {
  year: integer("year").primaryKey(),
  revision: integer("revision").notNull(),
  name: text("name"),
}, table => [
  check("catalogue_year_values", sql`${table.year} between 2000 and 9999 and ${table.revision} > 0`),
  check("catalogue_sheet_name", sql`${table.name} is null or (length(${table.name}) between 1 and 120
    and ${table.name} = btrim(${table.name}) and ${table.name} !~ '[[:cntrl:]]')`),
  uniqueIndex("catalogue_sheet_name_unique").on(sql`lower(coalesce(${table.name}, ${table.year}::text))`),
]);

export const catalogueRevisions = pgTable("catalogue_revisions", {
  year: integer("year").notNull().references(() => catalogueYears.year),
  revision: integer("revision").notNull(),
  products: jsonb("products").notNull(),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, table => [
  primaryKey({ columns: [table.year, table.revision] }),
  check("catalogue_revision_values", sql`${table.revision} > 0 and jsonb_typeof(${table.products}) = 'array'
    and jsonb_array_length(${table.products}) between 1 and 200`),
]);

export const catalogueSettings = pgTable("catalogue_settings", {
  id: integer("id").primaryKey(),
  activeYear: integer("active_year").notNull().references(() => catalogueYears.year),
}, table => [check("catalogue_singleton", sql`${table.id} = 1`)]);
