import { pgTable, integer, jsonb, text, timestamp, primaryKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const catalogueYears = pgTable("catalogue_years", {
  year: integer("year").primaryKey(),
  revision: integer("revision").notNull(),
}, table => [
  check("catalogue_year_values", sql`${table.year} between 2000 and 9999 and ${table.revision} > 0`),
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
