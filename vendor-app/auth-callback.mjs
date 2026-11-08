// Identity emails can land at the site root. Keep their fragment off the server.
const callback = new URLSearchParams(location.hash.slice(1));
if (callback.has('invite_token') || callback.has('recovery_token')) location.replace(`/telemetry${location.hash}`);
