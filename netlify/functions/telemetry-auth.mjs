import { login, logout, getUser, acceptInvite, recoverPassword, updateUser, requestPasswordRecovery, refreshSession } from '@netlify/identity';
export default async req => {
  const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (req.headers.get('origin') !== new URL(req.url).origin) return reply({ error: 'Forbidden' }, 403);
  const text = await req.text();
  if (text.length > 4096) return reply({ error: 'Request too large' }, 413);
  try {
    const { action, email, password, token } = JSON.parse(text);
    if (action === 'logout') { await logout(); return reply({ ok: true }); }
    if (action === 'recover') { await requestPasswordRecovery(email); return reply({ ok: true }); }
    if (action === 'invite') await acceptInvite(token, password);
    else if (action === 'reset') { await recoverPassword(token); await updateUser({ password }); }
    else if (action === 'login') await login(email, password);
    else if (action === 'refresh') await refreshSession();
    else return reply({ error: 'Invalid action' }, 400);
    const user = await getUser();
    if (!user?.roles?.includes('telemetry-owner')) {
      await logout();
      return reply({ error: 'This account does not have owner access.' }, 403);
    }
    return reply({ ok: true });
  } catch { return reply({ error: 'Unable to complete sign-in. Check your details or request a new invitation or reset link.' }, 401); }
};
export const config = { path: '/api/telemetry-auth', rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
