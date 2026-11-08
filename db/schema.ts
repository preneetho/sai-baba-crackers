import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
export const telemetryEvents = pgTable('telemetry_events', {
  id: uuid('id').primaryKey(),
  session: uuid('session').notNull(),
  type: text('type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('telemetry_time_idx').on(table.createdAt), uniqueIndex('telemetry_session_type_idx').on(table.session, table.type)]);
