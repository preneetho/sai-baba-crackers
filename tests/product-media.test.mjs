import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { handleVendorMedia } from "../netlify/functions/vendor-media.mjs";
import { vendorSettings, createSession, unseal } from "../netlify/lib/vendor-auth.mjs";
import { cloudinarySettings, uploadSignature, mediaProof, verifiedMedia } from "../netlify/lib/product-media.mjs";
import { validMedia, validProductMedia, mediaUrl, MEDIA_LIMITS, youtubeVideoId, copyMedia } from "../vendor-app/media-model.mjs";
import { inspectMediaFile, transferMedia } from "../vendor-app/media-upload.mjs";
import { products } from "../vendor-app/catalog.mjs";
import { catalogueProducts } from "../vendor-app/catalogue-model.mjs";
import { cartLines } from "../vendor-app/order.mjs";

const now = Date.parse("2026-11-09T12:00:00Z");
const env = {
  ORDER_BACKEND: "netlify-db", ORDER_PDF_SECRET: "synthetic-pdf-".repeat(4),
  VENDOR_APP_ORIGIN: "https://vendor.example", VENDOR_ALLOWED_EMAILS: "owner@example.com",
  VENDOR_GOOGLE_CLIENT_ID: "synthetic-client", VENDOR_GOOGLE_CLIENT_SECRET: "synthetic-secret",
  VENDOR_SESSION_SECRET: "synthetic-session-".repeat(4),
  CLOUDINARY_CLOUD_NAME: "synthetic-cloud", CLOUDINARY_API_KEY: "123456789012345",
  CLOUDINARY_API_SECRET: "synthetic-cloud-secret-only", CLOUDINARY_UPLOAD_PRESET: "sai_baba_products",
};
const settings = vendorSettings(env);
const cloud = cloudinarySettings(env);
const cookie = createSession({ sub: "synthetic-owner", email: "owner@example.com" }, settings, now);
const csrf = unseal(cookie, "session", settings, now).csrf;
const asset = { cloudName: cloud.cloudName, publicId: "sai-baba-crackers/products/00000000-0000-4000-8000-000000000001",
  resourceType: "image", version: 1234567890, format: "jpg", bytes: 1000, width: 640, height: 480,
  duration: 0, alt: "Synthetic product photo", credit: "Synthetic test credit" };
const signInput = { action: "sign", year: 2026, revision: 1, productId: 1, resourceType: "image", bytes: 1000 };
const request = (body, headers = {}) => new Request(`${env.VENDOR_APP_ORIGIN}/api/vendor-media`, {
  method: "POST", headers: { Origin: env.VENDOR_APP_ORIGIN, "Content-Type": "application/json",
    Cookie: `${settings.sessionCookie}=${cookie}`, "X-Vendor-CSRF": csrf, ...headers }, body: JSON.stringify(body),
});
const database = { priceLists: async () => ({ catalogue: { year: 2026, revision: 1, products: [products[0]] } }) };
const options = { env, now: () => now, databaseFactory: async () => database };
const sign = async () => (await (await handleVendorMedia(request(signInput), options)).json());
function resource(authorization, overrides = {}) {
  return { public_id: authorization.params.public_id, resource_type: authorization.resourceType,
    type: "upload", version: 1234567890, format: "jpg", bytes: 1000, width: 640, height: 480, ...overrides };
}

test("media model bounds, canonical delivery URLs and allowlisting exclude arbitrary URLs and order snapshots", () => {
  assert.equal(validMedia(asset), true);
  assert.equal(validMedia({ ...asset, publicId: "https://untrusted.example/tracker" }), false);
  assert.equal(validMedia({ ...asset, format: "svg" }), false);
  assert.equal(validMedia({ ...asset, bytes: MEDIA_LIMITS.imageBytes + 1 }), false);
  assert.equal(validMedia({ ...asset, bytes: MEDIA_LIMITS.imageBytes }), true);
  const video = { ...asset, resourceType: "video", format: "mp4", bytes: MEDIA_LIMITS.videoBytes, duration: 30 };
  assert.equal(validMedia(video), true);
  assert.equal(validMedia({ ...video, duration: 30.001 }), false);
  assert.equal(validMedia({ ...video, duration: Number.NaN }), false);
  assert.equal(validProductMedia([asset, asset]), false);
  assert.equal(validProductMedia(Array.from({ length: 4 }, (_, i) => ({ ...asset, publicId: asset.publicId.slice(0, -1) + i }))), false);
  const proof = mediaProof(asset, settings.secret);
  assert.equal(verifiedMedia({ ...asset, proof }, cloud, settings.secret), true);
  assert.equal(verifiedMedia({ ...asset, proof, bytes: 1001 }, cloud, settings.secret), false);
  assert.equal(verifiedMedia({ ...asset, proof, alt: "Updated caption", credit: "Updated attribution" }, cloud, settings.secret), true);
  assert.equal(verifiedMedia({ ...asset, proof, cloudName: "another-cloud" }, cloud, settings.secret), false);
  assert.match(mediaUrl(asset), /^https:\/\/res\.cloudinary\.com\/synthetic-cloud\/image\/upload\/c_limit,w_640,h_400,q_auto,f_auto\/v1234567890\//);
  assert.match(mediaUrl(video), /so_0.*f_jpg.*\.jpg$/);
  assert.match(mediaUrl(video, "play"), /f_mp4.*\.mp4$/);
  const rows = catalogueProducts([{ ...products[0], media: [{ ...asset, proof, untrustedUrl: "private" }] }], true);
  assert.equal(rows[0].media[0].proof, undefined);
  assert.equal(rows[0].media[0].untrustedUrl, undefined);
  assert.deepEqual(cartLines({ 1: 2 }, rows), cartLines({ 1: 2 }, [products[0]]));
});

test("signed upload authorization fixes namespace, formats, overwrite and preset without exposing a secret", async () => {
  const authorization = await sign();
  assert.equal(authorization.params.upload_preset, env.CLOUDINARY_UPLOAD_PRESET);
  assert.equal(authorization.params.overwrite, "false");
  assert.equal(authorization.params.allowed_formats, "jpg,jpeg,png,webp");
  assert.match(authorization.params.public_id, /^sai-baba-crackers\/products\/[a-f0-9-]{36}$/);
  const params = authorization.params;
  const expected = `allowed_formats=${params.allowed_formats}&overwrite=false&public_id=${params.public_id}&timestamp=${Math.floor(now / 1000)}&type=upload&upload_preset=sai_baba_products`;
  assert.equal(authorization.signature, createHash("sha256").update(expected + env.CLOUDINARY_API_SECRET).digest("hex"));
  assert.equal(authorization.signature, uploadSignature(params, env.CLOUDINARY_API_SECRET));
  assert.equal(JSON.stringify(authorization).includes(env.CLOUDINARY_API_SECRET), false);
  assert.equal(JSON.stringify(authorization).includes(env.VENDOR_SESSION_SECRET), false);
  assert.equal(authorization.params.public_id === (await sign()).params.public_id, false);
});

test("YouTube URLs accept known video forms and discard tracking, timestamps and playlist parameters", () => {
  const id = "M7lc1UVf-VE";
  for (const url of [
    `https://www.youtube.com/watch?v=${id}&list=ignored&t=30&si=ignored`,
    ` https://youtube.com/watch?v=${id} `,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=ignored`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
  ]) assert.equal(youtubeVideoId(url), id, url);
  for (const url of [null, 123, "", id, "javascript:alert(1)", `http://youtube.com/watch?v=${id}`,
    `https://youtube.com.evil.example/watch?v=${id}`, `https://evil.example/?v=${id}`,
    `https://youtube.com@evil.example/watch?v=${id}`, `https://user:password@youtube.com/watch?v=${id}`,
    `https://youtube.com:444/watch?v=${id}`, `https://youtu.be/${id}/extra`,
    `https://youtube.com/playlist?list=${id}`, `https://youtube.com/watch?v=${id}&v=${id}`,
    "https://youtube.com/watch?v=short", `https://youtube.com/watch?v=${id}%0A`,
    `https://youtube.com/watch?v=${id}\n`, `https://youtu.be/${id}?x=${"x".repeat(2048)}`]) {
    assert.equal(youtubeVideoId(url), null, String(url));
  }
});

test("YouTube descriptors share the one-video limit without accepting Cloudinary proofs or arbitrary URLs", () => {
  const youtube = { provider: "youtube", resourceType: "video", videoId: "M7lc1UVf-VE",
    alt: "Illustrative YouTube demo", credit: "Synthetic credit" };
  assert.equal(validMedia(youtube), true);
  assert.equal(validProductMedia([asset, youtube]), true);
  const video = { ...asset, resourceType: "video", format: "mp4", duration: 30 };
  assert.equal(validProductMedia([youtube, video]), false);
  assert.equal(validProductMedia([youtube, youtube]), false);
  for (const change of [{ videoId: "M7lc1UVf-VE\n" }, { videoId: "../anything" },
    { resourceType: "image" }, { alt: "" }, { provider: "vimeo" }, { proof: "p".repeat(43) },
    { cloudName: asset.cloudName }, { publicId: asset.publicId }, { url: "https://evil.example" }]) {
    assert.equal(validMedia({ ...youtube, ...change }), false);
  }
  assert.equal(validMedia({ ...asset, provider: "unknown" }), false);
  assert.equal(verifiedMedia(youtube, cloud, settings.secret), false);
  assert.deepEqual(copyMedia(youtube, true), youtube);
  assert.equal(mediaUrl(youtube), "https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg");
  assert.equal(mediaUrl(youtube, "play"), "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?autoplay=0&playsinline=1");
  assert.equal(mediaUrl(youtube, "watch"), "https://www.youtube.com/watch?v=M7lc1UVf-VE");
  assert.throws(() => mediaUrl({ ...youtube, videoId: "../anything" }), /Invalid product media/);
  const rows = catalogueProducts([{ ...products[0], media: [youtube] }], true);
  assert.deepEqual(cartLines({ 1: 2 }, rows), cartLines({ 1: 2 }, [products[0]]));
});

test("upload authorization denies missing login, CSRF, configuration, changed revisions and unsaved products", async () => {
  let opened = 0;
  const guarded = { ...options, databaseFactory: async () => { opened++; return database; } };
  assert.equal((await handleVendorMedia(request(signInput, { Cookie: "" }), guarded)).status, 401);
  assert.equal((await handleVendorMedia(request(signInput, { "X-Vendor-CSRF": "wrong" }), guarded)).status, 403);
  assert.equal((await handleVendorMedia(request(signInput, { Origin: "https://another.example" }), guarded)).status, 403);
  assert.equal(opened, 0);
  assert.equal((await handleVendorMedia(request(signInput), { ...options, env: { ...env, CLOUDINARY_API_SECRET: "" } })).status, 503);
  for (const placeholder of ["CLOUDINARY_CLOUD_NAME", "cloudinary_cloud_name"]) {
    const invalidEnv = { ...env, CLOUDINARY_CLOUD_NAME: placeholder };
    assert.equal(cloudinarySettings(invalidEnv), null);
    const response = await handleVendorMedia(request(signInput), { ...guarded, env: invalidEnv });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /actual Cloudinary cloud name, not the variable label/);
  }
  assert.equal(opened, 0);
  for (const change of [{ revision: 2 }, { productId: 99 }]) {
    assert.equal((await handleVendorMedia(request({ ...signInput, ...change }), options)).status, 409);
  }
  for (const change of [{ bytes: MEDIA_LIMITS.imageBytes + 1 }, { resourceType: "raw" }, { year: 1999 }]) {
    assert.equal((await handleVendorMedia(request({ ...signInput, ...change }), options)).status, 400);
  }
  assert.equal((await handleVendorMedia(request({ action: "sign", text: "x".repeat(8193) }), options)).status, 413);
});

test("verification reads actual authenticated Cloudinary metadata, not client-supplied size or duration", async () => {
  const authorization = await sign();
  let lookedUp = 0;
  const response = await handleVendorMedia(request({ action: "verify", ticket: authorization.ticket, bytes: 1 }), {
    ...options, fetchImpl: async (url, init) => {
      lookedUp++;
      assert.equal(url, `https://api.cloudinary.com/v1_1/${cloud.cloudName}/resources/image/upload/${encodeURIComponent(authorization.params.public_id)}`);
      assert.equal(init.redirect, "error");
      assert.equal(init.headers.Authorization, `Basic ${Buffer.from(`${cloud.apiKey}:${cloud.apiSecret}`).toString("base64")}`);
      return Response.json(resource(authorization));
    },
  });
  assert.equal(response.status, 200);
  assert.equal(lookedUp, 1);
  const result = await response.json();
  assert.equal(result.media.bytes, 1000);
  assert.equal(verifiedMedia(result.media, cloud, settings.secret), true);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  for (const invalid of [{ bytes: MEDIA_LIMITS.imageBytes + 1 }, { public_id: asset.publicId },
    { resource_type: "raw" }, { type: "authenticated" }, { format: "svg" }, { width: 0 }]) {
    const failure = await handleVendorMedia(request({ action: "verify", ticket: authorization.ticket }), {
      ...options, fetchImpl: async () => Response.json(resource(authorization, invalid)),
    });
    assert.equal(failure.status, 400);
    assert.equal((await failure.json()).media, undefined);
  }
  const videoAuthorization = await (await handleVendorMedia(request({ ...signInput, resourceType: "video" }), options)).json();
  for (const duration of [30, 30.01]) {
    const videoResponse = await handleVendorMedia(request({ action: "verify", ticket: videoAuthorization.ticket }), {
      ...options, fetchImpl: async () => Response.json(resource(videoAuthorization, { format: "mp4", duration })),
    });
    assert.equal(videoResponse.status, duration === 30 ? 200 : 400);
  }
});

test("expired, tampered, other-session tickets and Cloudinary failures never attach media", async () => {
  const authorization = await sign();
  const otherCookie = createSession({ sub: "synthetic-owner", email: "owner@example.com" }, settings, now);
  const otherCsrf = unseal(otherCookie, "session", settings, now).csrf;
  const noFetch = { ...options, fetchImpl: () => { throw new Error("Verification must not run"); } };
  assert.equal((await handleVendorMedia(request({ action: "verify", ticket: authorization.ticket + "x" }), noFetch)).status, 400);
  assert.equal((await handleVendorMedia(request({ action: "verify", ticket: authorization.ticket }),
    { ...noFetch, now: () => now + 16 * 60000 })).status, 400);
  assert.equal((await handleVendorMedia(request({ action: "verify", ticket: authorization.ticket }, {
    Cookie: `${settings.sessionCookie}=${otherCookie}`, "X-Vendor-CSRF": otherCsrf,
  }), noFetch)).status, 400);
  for (const fetchImpl of [async () => new Response("quota", { status: 429 }),
    async () => { throw new Error("Synthetic timeout"); }, async () => new Response("not JSON")]) {
    const response = await handleVendorMedia(request({ action: "verify", ticket: authorization.ticket }), { ...options, fetchImpl });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).media, undefined);
  }
});

test("browser transfer uses only the signed Cloudinary endpoint and direct multipart bytes without vendor cookies", async () => {
  await assert.rejects(inspectMediaFile({ name: "untrusted.svg", type: "image/svg+xml", size: 10 }), /Choose a JPG/);
  await assert.rejects(inspectMediaFile({ name: "large.jpg", type: "image/jpeg", size: MEDIA_LIMITS.imageBytes + 1 }), /5 MB/);
  assert.equal(await inspectMediaFile({ name: "photo.JPG", type: "", size: MEDIA_LIMITS.imageBytes }), "image");
  const authorization = await sign();
  const file = new File(["synthetic bytes"], "photo.jpg", { type: "image/jpeg" });
  await transferMedia(file, authorization, { fetchImpl: async (url, init) => {
    assert.equal(url, `https://api.cloudinary.com/v1_1/${cloud.cloudName}/image/upload`);
    assert.equal(init.credentials, "omit");
    assert.equal(init.body.get("file").name, "photo.jpg");
    assert.equal(init.body.get("signature"), authorization.signature);
    assert.equal(init.body.has("api_secret"), false);
    return new Response("{}");
  } });
  await assert.rejects(transferMedia(file, { ...authorization, cloudName: "untrusted.example/path" }), /authorization/);
  await assert.rejects(transferMedia(file, authorization, { fetchImpl: async () => new Response("quota", { status: 400 }) }), /rejected/);
});

test("rejected uploads report the provider status and reason without exposing upload credentials", async () => {
  const authorization = await sign();
  const file = new File(["synthetic bytes"], "photo.jpg", { type: "image/jpeg" });
  const message = `Invalid API key ${authorization.apiKey}; signature ${authorization.signature}; ticket ${authorization.ticket}\nCheck the selected product environment.`;
  await assert.rejects(transferMedia(file, authorization, {
    fetchImpl: async () => Response.json({ error: { message } }, { status: 401 }),
  }), error => {
    assert.match(error.message, /Cloudinary rejected the upload \(HTTP 401\): Invalid API key \[redacted\]/);
    assert.match(error.message, /Check the selected product environment/);
    assert.match(error.message, /saved list is unchanged/);
    for (const value of [authorization.apiKey, authorization.signature, authorization.ticket]) {
      assert.equal(error.message.includes(value), false);
    }
    assert.doesNotMatch(error.message, /[\u0000-\u001f\u007f]/);
    return true;
  });
  await assert.rejects(transferMedia(file, authorization, {
    fetchImpl: async () => Response.json({ error: { message: "Upload preset not found" } }, { status: 400 }),
  }), /HTTP 400.*Upload preset not found/);
  for (const payload of [{}, { error: { message: 123 } }, { error: { message: "   " } }]) {
    await assert.rejects(transferMedia(file, authorization, {
      fetchImpl: async () => Response.json(payload, { status: 403 }),
    }), /HTTP 403.*did not provide an error message/);
  }
  await assert.rejects(transferMedia(file, authorization, {
    fetchImpl: async () => new Response("<html>upstream failure</html>", { status: 502 }),
  }), /HTTP 502.*error response could not be read/);
  await assert.rejects(transferMedia(file, authorization, {
    fetchImpl: async () => Response.json({ error: { message: "x".repeat(10000) } }, { status: 400 }),
  }), error => {
    assert.ok(error.message.length < 520);
    return true;
  });
});

test("production CSP permits only the required media providers, local metadata blobs and first-party scripts", async () => {
  const config = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
  const policy = /Content-Security-Policy = "([^"]+)"/.exec(config)?.[1];
  assert.ok(policy);
  const directives = Object.fromEntries(policy.split(";").map(value => value.trim().split(/\s+/)).map(([key, ...sources]) => [key, sources]));
  assert.deepEqual(directives["script-src"], ["'self'"]);
  assert.deepEqual(directives["img-src"], ["'self'", "data:", "https://res.cloudinary.com", "https://i.ytimg.com"]);
  assert.deepEqual(directives["media-src"], ["'self'", "blob:", "https://res.cloudinary.com"]);
  assert.deepEqual(directives["connect-src"], ["'self'", "https://api.cloudinary.com"]);
  assert.deepEqual(directives["frame-src"], ["https://www.youtube-nocookie.com"]);
  assert.deepEqual(directives["frame-ancestors"], ["'none'"]);
});
