// No cookies, customer fields, URLs, IP addresses or persistent visitor identifiers.
let session;
const sent = new Set();
export function track(type) {
  try {
    if (navigator.globalPrivacyControl || navigator.doNotTrack === '1') return;
    let stored = JSON.parse(sessionStorage.getItem('sbc-telemetry') || 'null');
    if (!stored || Date.now() - stored.started > 30 * 60 * 1000) {
      stored = { id: crypto.randomUUID(), started: Date.now() };
      sessionStorage.setItem('sbc-telemetry', JSON.stringify(stored));
      sent.clear();
    }
    if (sent.has(type)) return;
    session = stored.id;
    sent.add(type);
    const post = stage => fetch('/api/telemetry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), session, type: stage }), keepalive: true }).catch(() => {});
    if (type !== 'visit') void post('visit');
    void post(type);
  } catch { /* Analytics must never interrupt shopping. */ }
}
track('visit');
