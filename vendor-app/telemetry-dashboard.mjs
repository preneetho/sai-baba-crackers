const $ = id => document.getElementById(id);
const status = message => { $('status').textContent = message; };
let callback = new URLSearchParams(location.hash.slice(1));
const token = callback.get('invite_token') || callback.get('recovery_token');
const action = callback.has('invite_token') ? 'invite' : callback.has('recovery_token') ? 'reset' : 'login';
history.replaceState(null, '', location.pathname);
if (token) {
  $('login-button').textContent = 'Set password & sign in →';
  $('password').autocomplete = 'new-password';
  $('email').required = false;
  $('email').parentElement.hidden = true;
}
async function auth(payload) {
  const response = await fetch('/api/telemetry-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Authentication unavailable. Please retry.');
}
function conceal() {
  $('dashboard').hidden = true;
  $('daily').replaceChildren();
  $('funnel').replaceChildren();
  $('visits').textContent = $('conversion').textContent = '—';
}
let loading = false;
async function load() {
  if (loading) return;
  loading = true;
  conceal();
  $('refresh').disabled = true;
  $('range').disabled = true;
  status('Loading telemetry…');
  try {
    const days = Number($('range').value);
    let response = await fetch(`/api/telemetry?days=${days}`, { cache: 'no-store' });
    if (response.status === 401 && !token) {
      try { await auth({ action: 'refresh' }); response = await fetch(`/api/telemetry?days=${days}`, { cache: 'no-store' }); } catch { /* Show login below. */ }
    }
    if (response.status === 401 || response.status === 403) {
      $('auth').hidden = false;
      $('logout').hidden = response.status === 401;
      status(response.status === 403 ? 'Owner access is required for this account.' : token ? 'Choose a password to complete your invitation or reset.' : 'Sign in to view your private dashboard.');
      return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load telemetry.');
    $('auth').hidden = true;
    $('dashboard').hidden = false;
    $('logout').hidden = false;
    const sums = data.daily.reduce((a, row) => { for (const key of ['visits', 'cart', 'checkout', 'saved']) a[key] += Number(row[key]); return a; }, { visits: 0, cart: 0, checkout: 0, saved: 0 });
    const percent = value => sums.visits ? `${(value / sums.visits * 100).toFixed(1)}%` : '—';
    $('visits').textContent = sums.visits.toLocaleString();
    $('conversion').textContent = percent(sums.saved);
    for (const [i, [key, label]] of [['visits', 'Visited catalogue'], ['cart', 'Added to cart'], ['checkout', 'Opened checkout'], ['saved', 'Order request saved']].entries()) {
      const item = document.createElement('li');
      const line = document.createElement('div');
      const title = document.createElement('span'); title.textContent = `0${i + 1} / ${label}`;
      const count = document.createElement('strong'); count.textContent = sums[key].toLocaleString();
      line.append(title, count);
      const bar = document.createElement('progress'); bar.max = sums.visits || 1; bar.value = sums[key]; bar.setAttribute('aria-label', label);
      const note = document.createElement('small'); note.textContent = `${percent(sums[key])} of browsing sessions`;
      item.append(line, bar, note); $('funnel').append(item);
    }
    const byDate = new Map(data.daily.map(row => [row.day, row]));
    const now = new Date(data.updatedAt);
    for (let offset = days - 1; offset >= 0; offset--) {
      const date = new Date(now); date.setUTCDate(date.getUTCDate() - offset);
      const day = date.toISOString().slice(0, 10);
      const row = byDate.get(day) || { visits: 0, saved: 0 };
      const tr = document.createElement('tr');
      for (const value of [day, row.visits, row.saved]) { const cell = document.createElement('td'); cell.textContent = String(value); tr.append(cell); }
      $('daily').append(tr);
    }
    $('empty').hidden = sums.visits > 0;
    $('updated').textContent = `Last refreshed ${now.toLocaleString()}. Date boundaries use UTC.`;
    status('Telemetry up to date.');
  } catch (error) { status(error.message || 'Unable to load telemetry. Please retry.'); $('dashboard').hidden = false; }
  finally { loading = false; $('refresh').disabled = false; $('range').disabled = false; }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('login-button').disabled = true;
  try { await auth({ action, email: $('email').value, password: $('password').value, token }); $('password').value = ''; await load(); }
  catch (error) { status(error.message); }
  finally { $('login-button').disabled = false; }
});
$('forgot').addEventListener('click', async () => {
  if (!$('email').reportValidity() || !$('email').value) return;
  $('forgot').disabled = true;
  try { await auth({ action: 'recover', email: $('email').value }); status('If this account exists, a password reset email is on its way.'); }
  catch (error) { status(error.message); }
  finally { $('forgot').disabled = false; }
});
$('logout').addEventListener('click', async () => {
  conceal();
  try { await auth({ action: 'logout' }); $('logout').hidden = true; $('auth').hidden = false; status('Signed out.'); }
  catch (error) { status(error.message); }
});
$('refresh').addEventListener('click', load);
$('range').addEventListener('change', load);
void load();
