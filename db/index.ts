import { getDatabase } from '@netlify/database';
import { drizzle } from 'drizzle-orm/netlify-db';
import * as schema from './schema.js';
export function getTelemetryDb() {
  return drizzle({ client: getDatabase(), schema });
}
