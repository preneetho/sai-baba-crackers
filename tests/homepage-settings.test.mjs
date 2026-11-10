import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { handleHomepage } from "../netlify/functions/homepage.mjs";
import { handleVendorHomepage } from "../netlify/functions/vendor-homepage.mjs";
import { readHomepageVideo, saveHomepageVideo } from "../netlify/lib/homepage-settings.mjs";
import { createSession, unseal, vendorSettings } from "../netlify/lib/vendor-auth.mjs";
import { DEFAULT_HOMEPAGE_VIDEO, validHomepageVideo, validHomepageVersion,
  homepageVideoFromUrl, homepageVideoUrl } from "../vendor-app/homepage-model.mjs";

const origin = "https://vendor.example";
const now = Date.parse("2026-11-09T06:30:00Z");
const env = {
  VENDOR_APP_ORIGIN: origin, VENDOR_ALLOWED_EMAILS: "owner@example.com",
  VENDOR_GOOGLE_CLIENT_ID: "synthetic.apps.googleusercontent.com",
  VENDOR_GOOGLE_CLIENT_SECRET: "synthetic-secret",
  VENDOR_SESSION_SECRET: "synthetic-session-secret-".repeat(3),
};
const settings = vendorSettings(env);
const cookie = createSession({ sub: "synthetic-owner", email: "owner@example.com" }, settings, now);
const csrf = unseal(cookie, "session", settings, now).csrf;
const request = (body, { path = "/api/vendor-homepage", method = body === undefined ? "GET" : "POST", headers = {}, auth = true } = {}) =>
  new Request(origin + path, { method,
    headers: { Origin: origin, "Content-Type": "application/json",
      ...(auth ? { Cookie: `${settings.sessionCookie}=${cookie}`, "X-Vendor-CSRF": csrf } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const update = (videoUrl = "https://youtu.be/abcdefghijk", expectedVersion = null) => ({ videoUrl, expectedVersion });
const publicRequest = () => request(undefined, { path: "/api/homepage", auth: false });

function memoryStore() {
  let entry = null;
  let version = 0;
  return {
    async getWithMetadata(key, options) {
      assert.equal(key, "homepage-video");
      assert.deepEqual(options, { type: "json", consistency: "strong" });
      return structuredClone(entry);
    },
    async setJSON(key, data, options) {
      assert.equal(key, "homepage-video");
      if (options.onlyIfNew ? entry !== null : entry?.etag !== options.onlyIfMatch) return { modified: false };
      entry = { data: structuredClone(data), etag: `version-${++version}`, metadata: {} };
      return { modified: true, etag: entry.etag };
    },
  };
}
const vendor = (body, options = {}, requestOptions) =>
  handleVendorHomepage(request(body, requestOptions), { env, now: () => now, ...options });

test("homepage defaults only for an absent record, persists changes and explicitly persists a hidden video", async () => {
  const store = memoryStore();
  assert.deepEqual(await readHomepageVideo({ store }), { video: DEFAULT_HOMEPAGE_VIDEO, version: null });
  let response = await vendor(update("https://www.youtube.com/shorts/abcdefghijk?feature=share"), { store });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const saved = await response.json();
  assert.deepEqual(saved, { video: { videoId: "abcdefghijk" }, version: "version-1" });
  assert.deepEqual(await readHomepageVideo({ store }), saved);
  response = await handleHomepage(publicRequest(), { store });
  assert.deepEqual(await response.json(), { video: saved.video });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await vendor(update(" ", saved.version), { store })).status, 200);
  assert.deepEqual(await (await handleHomepage(publicRequest(), { store })).json(), { video: { videoId: null } });
  assert.deepEqual((await (await vendor(undefined, { store })).json()).video, { videoId: null });
});

test("supported YouTube links normalize to IDs; arbitrary hosts, protocols and malformed records are rejected", async () => {
  for (const url of ["https://www.youtube.com/watch?v=abcdefghijk&t=20&list=discard",
    "https://youtu.be/abcdefghijk?si=discard", "https://m.youtube.com/shorts/abcdefghijk"]) {
    assert.deepEqual(homepageVideoFromUrl(url), { videoId: "abcdefghijk" });
  }
  for (const url of ["javascript:alert(1)", "http://youtu.be/abcdefghijk", "https://youtube.com.evil.example/watch?v=abcdefghijk",
    "https://user:pass@youtube.com/watch?v=abcdefghijk", "https://youtube.com/watch?v=abcdefghijk&v=zyxwvutsrqp",
    "https://example.com/abcdefghijk", "https://youtu.be/too-short", "\nhttps://youtu.be/abcdefghijk",
    "a".repeat(2049), null, 123]) {
    assert.throws(() => homepageVideoFromUrl(url));
    assert.equal((await vendor(update(url), { store: memoryStore() })).status, 400);
  }
  for (const value of [null, [], {}, { videoId: "abcdefghijk/evil" }, { videoId: "abcdefghijk", url: "untrusted" }]) {
    assert.equal(validHomepageVideo(value), false);
  }
  assert.equal(validHomepageVersion(undefined), false);
  assert.equal(validHomepageVersion("bad\nversion"), false);
  assert.equal(validHomepageVersion("x".repeat(257)), false);
});

test("vendor homepage reads/writes require approved sessions and writes enforce origin, CSRF, JSON and payload limits", async () => {
  const store = { getWithMetadata() { throw new Error("Unauthorized read"); }, setJSON() { throw new Error("Unauthorized write"); } };
  assert.equal((await vendor(undefined, { store }, { auth: false })).status, 401);
  assert.equal((await vendor(update(), { store }, { auth: false })).status, 401);
  assert.equal((await vendor(update(), { store }, { headers: { "X-Vendor-CSRF": "incorrect" } })).status, 403);
  assert.equal((await vendor(update(), { store }, { headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await vendor(update(), { store }, { headers: { "Content-Type": "text/plain" } })).status, 415);
  assert.equal((await vendor(update("x".repeat(5000)), { store })).status, 413);
  assert.equal((await vendor(update(), { store }, { headers: { "Content-Length": "5000" } })).status, 413);
  assert.equal((await vendor({ ...update(), extra: true }, { store })).status, 400);
  assert.equal((await vendor({ videoUrl: "https://youtu.be/abcdefghijk" }, { store })).status, 400);
  assert.equal((await vendor(undefined, { store }, { path: "/api/vendor-homepage?year=2026" })).status, 400);
  assert.equal((await vendor(undefined, { store }, { method: "DELETE" })).status, 405);
  assert.equal((await vendor(undefined, { store, now: () => now + 9 * 3600000 })).status, 401);
  assert.equal((await vendor(undefined, { env: {}, store })).status, 503);
  const malformed = new Request(origin + "/api/vendor-homepage", { method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", Cookie: `${settings.sessionCookie}=${cookie}`, "X-Vendor-CSRF": csrf },
    body: "{" });
  assert.equal((await handleVendorHomepage(malformed, { env, store, now: () => now })).status, 400);
});

test("conditional homepage writes reject first-write races and stale tabs without changing the saved video", async () => {
  const store = memoryStore();
  const results = await Promise.all([vendor(update(), { store }), vendor(update("https://youtu.be/zyxwvutsrqp"), { store })]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const first = await readHomepageVideo({ store });
  assert.equal((await vendor(update("https://youtu.be/zyxwvutsrqp", first.version), { store })).status, 200);
  assert.equal((await vendor(update("", first.version), { store })).status, 409);
  assert.equal((await readHomepageVideo({ store })).video.videoId, "zyxwvutsrqp");
});

test("storage failures, corrupt values and missing write acknowledgements fail explicitly instead of returning a default/success", async () => {
  const broken = { async getWithMetadata() { throw new Error("Synthetic storage failure"); },
    async setJSON() { throw new Error("Synthetic storage failure"); } };
  assert.equal((await vendor(undefined, { store: broken })).status, 503);
  assert.equal((await vendor(update(), { store: broken })).status, 503);
  const publicFailure = await handleHomepage(publicRequest(), { store: broken });
  assert.equal(publicFailure.status, 503);
  assert.equal((await publicFailure.json()).video, undefined);
  for (const entry of [{ data: { videoId: "unsafe" }, etag: "version-1" },
    { data: DEFAULT_HOMEPAGE_VIDEO }, { data: DEFAULT_HOMEPAGE_VIDEO, etag: null }]) {
    const store = { async getWithMetadata() { return entry; } };
    assert.equal((await handleHomepage(publicRequest(), { store })).status, 503);
  }
  await assert.rejects(saveHomepageVideo(DEFAULT_HOMEPAGE_VIDEO, null, {
    store: { async setJSON() { return { modified: true }; } },
  }), /not acknowledged/);
  assert.equal((await handleHomepage(request(undefined, { path: "/api/homepage?year=2026" }), { store: memoryStore() })).status, 400);
  assert.equal((await handleHomepage(request(update(), { path: "/api/homepage" }), { store: memoryStore() })).status, 405);
});

async function publicUi(respond) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, events: new Map(),
      addEventListener(name, callback) { this.events.set(name, callback); },
      removeAttribute(name) { delete this[name]; } });
    return nodes.get(id);
  };
  const source = (await readFile(new URL("../vendor-app/homepage-video.mjs", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "");
  const context = vm.createContext({ document: { getElementById: get }, validHomepageVideo, homepageVideoUrl,
    AbortSignal, fetch: async (path, options) => {
      assert.equal(path, "/api/homepage");
      assert.equal(options.cache, "no-store");
      return respond();
    } });
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { get, retry: () => get("retry-home-video").events.get("click")() };
}

test("homepage binds only trusted configured URLs and keeps hidden videos free of external embeds", async () => {
  const ui = await publicUi(() => Response.json({ video: { videoId: "abcdefghijk" } }));
  assert.equal(ui.get("shop-video").hidden, false);
  assert.equal(ui.get("home-video-player").src, "https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0");
  assert.equal(ui.get("home-video-link").href, "https://www.youtube.com/watch?v=abcdefghijk");
  assert.equal(ui.get("home-video-status").hidden, true);
  const hidden = await publicUi(() => Response.json({ video: { videoId: null } }));
  assert.equal(hidden.get("shop-video").hidden, true);
  assert.equal(hidden.get("home-video-status").hidden, true);
  assert.equal(hidden.get("home-video-player").src, undefined);
});

test("homepage load failures and forged URLs expose retry, never a stale default, then recover", async () => {
  for (const failure of [() => Response.json({ error: "Unavailable" }, { status: 503 }),
    () => new Response("unreadable"), () => Response.json({ video: { videoId: "javascript:alert(1)" } })]) {
    let response = failure;
    const ui = await publicUi(() => response());
    assert.equal(ui.get("shop-video").hidden, true);
    assert.equal(ui.get("home-video-status").hidden, false);
    assert.equal(ui.get("home-video-player").src, undefined);
    assert.equal(ui.get("home-video-link").href, undefined);
    assert.equal(ui.get("retry-home-video").hidden, false);
    assert.match(ui.get("home-video-message").textContent, /could not be loaded/);
    response = () => Response.json({ video: DEFAULT_HOMEPAGE_VIDEO });
    await ui.retry();
    assert.equal(ui.get("shop-video").hidden, false);
    assert.match(ui.get("home-video-player").src, /hxVU6MC47zU/);
    assert.equal(ui.get("home-video-status").hidden, true);
  }
});
