import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { vendor } from "../vendor-app/catalog.mjs";

const origin = "https://saibabacrackers.netlify.app";
const read = async path => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replaceAll("\r\n", "\n");

test("the homepage has crawlable services, honest fulfilment information and working local links", async () => {
  const html = await read("vendor-app/index.html");
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
  assert.deepEqual(
    [...html.matchAll(/<a class="button[^"]*" href="\/order\/">([^<]+)<\/a>/g)].map(([, label]) => label),
    ["Shop crackers", "Shop crackers", "Shop crackers", "Shop crackers"],
  );
  for (const id of ["main-content", "celebrations", "delivery", "event-enquiries", "faq", "contact"]) {
    assert.ok(html.includes(`id="${id}"`));
  }
  assert.match(html, /Weddings &amp; family functions/);
  assert.match(html, /Diwali &amp; festivals/);
  assert.match(html, /Bulk requirements/);
  assert.match(html, /We deliver across Hyderabad and aim for same-day delivery, subject to availability and shop confirmation/);
  assert.match(html, /Outside the festival season, call first/);
  assert.match(html, /not a professional fireworks-display or event-operation service/);
  assert.match(html, /A submitted request is not a confirmed sale/);
  assert.doesNotMatch(html, /<form\b|<video\b|autoplay|<script[^>]+src="[^"]*app\.mjs"/);
  for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
    if (href.startsWith("#")) {
      assert.ok(html.includes(`id="${href.slice(1)}"`), `Missing anchor target: ${href}`);
    } else if (href.startsWith("/") && href !== "/") {
      assert.equal(href, "/order/");
    }
  }
  assert.ok(html.includes(`href="tel:+${vendor.whatsapp}"`));
  assert.ok(html.includes(vendor.alternatePhone));
  const maps = html.match(/href="(https:\/\/www\.google\.com\/maps\/search\/[^"]+)"/)?.[1];
  assert.ok(maps);
  assert.match(new URL(maps.replaceAll("&amp;", "&")).searchParams.get("query"), /Industrial Estate, Main Road, Sanath Nagar, Hyderabad/);
});

test("the homepage waits for video settings, preserves player privacy and keeps a direct YouTube fallback", async () => {
  const html = await read("vendor-app/index.html");
  const frames = [...html.matchAll(/<iframe\b[^>]*>/g)].map(([frame]) => frame);
  assert.equal(frames.length, 1);
  const frame = frames[0];
  assert.doesNotMatch(frame, /\bsrc=/, "Do not load a stale/default player before the saved setting is known");
  assert.match(frame, /title="Sai Baba Crackers Centre - YouTube video"/);
  assert.match(frame, /loading="lazy"/);
  assert.match(frame, /width="360" height="640"/);
  assert.match(frame, /referrerpolicy="strict-origin-when-cross-origin"/);
  assert.match(frame, /\ballowfullscreen\b/);
  assert.doesNotMatch(frame, /autoplay/);
  assert.match(html, /id="home-video-link" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /id="shop-video"[^>]*aria-labelledby="shop-video-title" hidden/);
  assert.match(html, /id="retry-home-video"/);
  assert.match(html, /<noscript>.*Enable JavaScript.*current video/);
  assert.match(await read("vendor-app/home.mjs"), /import "\.\/homepage-video\.mjs"/);
  assert.match(await read("vendor-app/home.css"), /\.home-video-player\s*\{[^}]*aspect-ratio: 9 \/ 16;/);
  assert.match(await read("netlify.toml"), /frame-src https:\/\/www\.youtube-nocookie\.com;/);
});

test("both public pages have distinct canonical/social URLs and the homepage has accurate business data", async () => {
  const home = await read("vendor-app/index.html");
  const catalogue = await read("vendor-app/order/index.html");
  for (const [html, path] of [[home, "/"], [catalogue, "/order/"]]) {
    assert.ok(html.includes(`<link rel="canonical" href="${origin}${path}">`));
    assert.ok(html.includes(`<meta property="og:url" content="${origin}${path}">`));
    assert.match(html, /<meta name="description" content="[^"]+">/);
    assert.match(html, /<meta name="twitter:card" content="summary">/);
    assert.doesNotMatch(html, /name="robots" content="noindex/);
  }
  const data = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data["@type"], "Store");
  assert.equal(data.name, vendor.name);
  assert.equal(data.url, `${origin}/`);
  assert.equal(data.telephone, vendor.phone);
  assert.equal(data.address.streetAddress, "Industrial Estate, Main Road, Sanath Nagar");
  assert.ok(home.includes(data.address.streetAddress));
  for (const field of ["openingHours", "openingHoursSpecification", "aggregateRating", "review", "geo", "foundingDate"]) {
    assert.equal(data[field], undefined, `Do not invent ${field}`);
  }
});

test("the sitemap contains only public canonical pages and private pages remain non-indexable", async () => {
  const sitemap = await read("vendor-app/sitemap.xml");
  assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(([, url]) => url), [`${origin}/`, `${origin}/order/`]);
  const robots = await read("vendor-app/robots.txt");
  assert.match(robots, /User-agent: \*\nAllow: \//);
  assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
  assert.match(await read("vendor-app/vendor/index.html"), /name="robots" content="noindex, nofollow, noarchive"/);
  assert.match(await read("vendor-app/telemetry.html"), /name="robots" content="noindex,nofollow"/);
  assert.match(await read("netlify/functions/order-share.mjs"), /name="robots" content="noindex, nofollow, noarchive"/);
});

test("catalogue assets stay root-relative after the move, with a homepage return link", async () => {
  const html = await read("vendor-app/order/index.html");
  assert.match(html, /class="wordmark" href="\/" aria-label="Sai Baba Crackers Centre home"/);
  for (const [, path] of html.matchAll(/(?:src|href)="([^"]+\.(?:png|svg|css|mjs))"/g)) {
    if (path.startsWith("https:")) continue;
    assert.ok(path.startsWith("/"), `Nested catalogue asset must be root-relative: ${path}`);
    await readFile(new URL(`../vendor-app${path}`, import.meta.url));
  }
  assert.match(html, /id="customer-form"/);
  assert.match(html, /id="requirement"/);
});

test("old catalogue/cart fragments preserve query strings while home and auth fragments stay put", async () => {
  const source = (await read("vendor-app/home.mjs")).replace(/^import .*;\r?\n/gm, "");
  for (const pathname of ["/", "/index.html"]) {
    for (const hash of ["#catalogue", "#requirement", "#products", "#search", "#checkout"]) {
      const redirects = [];
      const location = { pathname, search: "?source=bookmark", hash, replace: path => redirects.push(path) };
      vm.runInNewContext(source, { location, window: { addEventListener() {} } });
      assert.deepEqual(redirects, [`/order/?source=bookmark${hash}`]);
    }
  }
  for (const hash of ["", "#contact", "#faq", "#delivery", "#celebrations", "#event-enquiries", "#invite_token=synthetic", "#unknown"]) {
    const redirects = [];
    const events = new Map();
    const location = { pathname: "/", search: "", hash, replace: path => redirects.push(path) };
    vm.runInNewContext(source, { location, window: { addEventListener: (name, callback) => events.set(name, callback) } });
    assert.deepEqual(redirects, []);
    location.hash = "#requirement";
    events.get("hashchange")();
    assert.deepEqual(redirects, ["/order/#requirement"]);
  }
  assert.match(await read("vendor-app/home.mjs"), /import "\.\/auth-callback\.mjs"/);
  const redirects = [];
  const location = { hash: "#invite_token=synthetic", replace: path => redirects.push(path) };
  vm.runInNewContext(await read("vendor-app/auth-callback.mjs"), { URLSearchParams, location });
  assert.deepEqual(redirects, ["/telemetry#invite_token=synthetic"]);
});

test("Netlify redirects are explicit, preserve private function routes and do not use a catch-all rewrite", async () => {
  const config = await read("netlify.toml");
  for (const [from, to] of [["/index.html", "/"], ["/order/index.html", "/order/"]]) {
    assert.ok(config.includes(`from = "${from}"\n  to = "${to}"\n  status = 301`));
  }
  assert.doesNotMatch(config, /from = "\/order\/?"/, "Netlify Pretty URLs handle trailing slashes; slash-only redirect rules can loop");
  assert.doesNotMatch(config, /from = "\/\*"/);
  assert.match(config, /for = "\/vendor\/\*"[\s\S]*X-Robots-Tag = "noindex, nofollow, noarchive"/);
});

test("local preview serves the public routes, assets, redirects and vendor page", { timeout: 20000 }, async t => {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/serve-vendor.mjs", import.meta.url))], {
    env: { ...process.env, VENDOR_PORT: String(port), ORDER_BACKEND: "sheets",
      GOOGLE_SHEETS_WEBHOOK_URL: "", ORDER_TRACKING_SECRET: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  });
  let diagnostics = "";
  child.stderr.on("data", chunk => { diagnostics += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Preview startup timed out: ${diagnostics}`)), 10000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Preview exited (${code}): ${diagnostics}`)); });
    child.stdout.on("data", chunk => {
      if (String(chunk).includes("Vendor catalogue:")) { clearTimeout(timer); resolve(); }
    });
  });
  const base = `http://127.0.0.1:${port}`;
  for (const [path, contentType, marker] of [
    ["/", "text/html", 'id="home-title"'],
    ["/order/", "text/html", 'id="customer-form"'],
    ["/vendor/", "text/html", 'name="robots"'],
    ["/robots.txt", "text/plain", "Sitemap:"],
    ["/sitemap.xml", "application/xml", "<urlset"],
    ["/home.css", "text/css", ".home-hero"],
    ["/home.mjs", "text/javascript", "restoreCatalogueBookmark"],
    ["/homepage-model.mjs", "text/javascript", "validHomepageVideo"],
    ["/homepage-video.mjs", "text/javascript", "/api/homepage"],
    ["/offer-widgets.mjs", "text/javascript", "initializeOfferCarousel"],
    ["/modern.css", "text/css", ".modern"],
    ["/modern-ui.mjs", "text/javascript", "restoreCartBookmark"],
    ["/canvas-fireworks.mjs", "text/javascript", "prefers-reduced-motion"],
    ["/modern-fireworks.svg", "image/svg+xml", "<svg"],
    ["/auth-callback.mjs", "text/javascript", "invite_token"],
    ["/app.mjs", "text/javascript", 'fetch("/api/catalogue"'],
  ]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get("content-type").includes(contentType), path);
    assert.ok((await response.text()).includes(marker), path);
  }
  for (const [path, destination] of [["/index.html", "/"], ["/order", "/order/"], ["/order/index.html", "/order/"]]) {
    const response = await fetch(`${base}${path}?source=legacy`, { redirect: "manual" });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get("location"), `${destination}?source=legacy`);
  }
  const head = await fetch(`${base}/order/`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.ok(Number(head.headers.get("content-length")) > 0);
  const vendorPage = await fetch(`${base}/vendor/`);
  assert.match(vendorPage.headers.get("x-robots-tag"), /noindex/);
  const missing = await fetch(`${base}/unrelated-page`);
  assert.equal(missing.status, 404);
  const unavailable = await fetch(`${base}/api/catalogue`);
  assert.equal(unavailable.status, 503, "Preview must not use a production backend");
});
