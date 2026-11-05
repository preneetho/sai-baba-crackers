import { getUser } from '@netlify/identity';
import { sql } from 'drizzle-orm';
import { getTelemetryDb } from '../../db/index.js';
import { telemetryEvents } from '../../db/schema.js';
const TYPES = ['visit', 'cart', 'checkout', 'saved'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' } });
export default async (req: Request) => {
  if (req.method === 'POST') {
    if (req.headers.get('origin') !== new URL(req.url).origin) return reply({ error: 'Forbidden' }, 403);
    if (!req.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'JSON required' }, 415);
    const body = await req.text();
    if (body.length > 512) return reply({ error: 'Payload too large' }, 413);
    let event;
    try { event = JSON.parse(body); } catch { return reply({ error: 'Invalid JSON' }, 400); }
    if (!event || !UUID.test(event.id) || !UUID.test(event.session) || !TYPES.includes(event.type)) return reply({ error: 'Invalid event' }, 400);
    try {
      await getTelemetryDb().insert(telemetryEvents).values({ id: event.id, session: event.session, type: event.type }).onConflictDoNothing();
      return new Response(null, { status: 204 });
    } catch { return reply({ error: 'Telemetry temporarily unavailable' }, 503); }
  }
  if (req.method !== 'GET') return reply({ error: 'Method not allowed' }, 405);
  const user = await getUser();
  if (!user) return reply({ error: 'Sign in to view telemetry.' }, 401);
  if (!user.roles?.includes('telemetry-owner')) return reply({ error: 'This account does not have owner access.' }, 403);
  const days = Number(new URL(req.url).searchParams.get('days') || 7);
  if (![7, 30, 90].includes(days)) return reply({ error: 'Invalid date range' }, 400);
  try {
    // Cohort funnel: sessions that first visited in the selected UTC window.
    const rows = await getTelemetryDb().execute(sql`
      WITH sessions AS (
        SELECT session, min(created_at) FILTER (WHERE type = 'visit') AS visited,
          bool_or(type = 'cart') AS cart, bool_or(type = 'checkout') AS checkout,
          bool_or(type = 'saved') AS saved
        FROM telemetry_events GROUP BY session
      )
      SELECT to_char(visited AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
        count(*)::int AS visits, count(*) FILTER (WHERE cart)::int AS cart,
        count(*) FILTER (WHERE cart AND checkout)::int AS checkout,
        count(*) FILTER (WHERE cart AND checkout AND saved)::int AS saved
      FROM sessions WHERE visited >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - (${days - 1} * interval '1 day')
      GROUP BY day ORDER BY day
    `);
    return reply({ days, daily: (rows as any).rows, updatedAt: new Date().toISOString() });
  } catch { return reply({ error: 'Telemetry is unavailable. Please retry shortly.' }, 503); }
};
export const config = { path: '/api/telemetry', rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
