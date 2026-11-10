import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { ORDER_STATUSES, PAGE_SIZE, validOrder, validImportSummary } from "../vendor-app/vendor-model.mjs";
import { validCatalogue, validYear, catalogueProducts } from "../vendor-app/catalogue-model.mjs";
import { products } from "../vendor-app/catalog.mjs";
import { validMedia, MEDIA_LIMITS, mediaUrl, isYouTubeMedia, youtubeVideoId } from "../vendor-app/media-model.mjs";
import { inspectMediaFile } from "../vendor-app/media-upload.mjs";

const mediaAsset = { cloudName: "synthetic-cloud", publicId: "sai-baba-crackers/products/00000000-0000-4000-8000-000000000001",
  resourceType: "image", version: 1234567890, format: "jpg", bytes: 1000, width: 640, height: 480,
  duration: 0, alt: "Synthetic product photo", credit: "", proof: "p".repeat(43) };

const result = {
  requests: 1, items: 1, totalPaise: 8500, newRequests: 1, newItems: 1,
  existingRequestsUnchanged: 0, statusDifferencesPreserved: 0,
  statusCounts: { Completed: 1 }, unverifiedSourceHashes: 0,
};
const tick = () => new Promise(resolve => setImmediate(resolve));
async function harness() {
  const nodes = new Map();
  let focused;
  let resizeBar;
  const styles = new Map();
  class Node {
    constructor(tag = "div") {
      Object.assign(this, { tagName: tag.toUpperCase(), value: "", textContent: "", hidden: false,
        disabled: false, checked: false, dataset: {}, files: [], events: new Map(), children: [], attributes: {} });
    }
    addEventListener(type, callback) { this.events.set(type, callback); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key]; }
    removeAttribute(key) { delete this.attributes[key]; }
    setCustomValidity(message) { this.validationMessage = message; }
    checkValidity() {
      if (this.disabled) return true;
      if (this.validationMessage || (this.required && String(this.value) === "")) return false;
      if (this.type !== "number") return true;
      const value = Number(this.value);
      return Number.isFinite(value) && value >= Number(this.min) && value <= Number(this.max) &&
        Math.abs(Math.round(value * 100) - value * 100) < 0.000001;
    }
    reportValidity() { this.reported = true; return this.checkValidity(); }
    matches(selector) {
      return selector === ":invalid" ? ["INPUT", "TEXTAREA"].includes(this.tagName) && !this.checkValidity() :
        selector.startsWith(".") ? this.className?.split(" ").includes(selector.slice(1)) :
          this.tagName === selector.toUpperCase();
    }
    querySelectorAll(selector) {
      const matches = [];
      for (const child of this.children) {
        if (selector.split(",").some(part => child.matches(part.trim()))) matches.push(child);
        matches.push(...child.querySelectorAll(selector));
      }
      return matches;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    focus() { focused = this; }
    scrollIntoView() { this.scrolled = true; }
    getBoundingClientRect() { return { height: this.height ?? 0 }; }
    close() {}
    showModal() {}
    pause() { this.paused = true; }
    load() { this.unloaded = true; }
  }
  const find = (node, id) => node.id === id ? node : node.children.map(child => find(child, id)).find(Boolean);
  const get = id => {
    const found = [...nodes.values()].map(node => find(node, id)).find(Boolean);
    if (found) return found;
    if (!nodes.has(id)) nodes.set(id, new Node());
    return nodes.get(id);
  };
  get("price-panel").append(...["close-prices", "reload-prices", "price-message", "price-controls"].map(get));
  get("price-controls").append(...["price-year", "activate-prices", "new-price-year", "price-form"].map(get));
  get("price-form").append(get("price-save-bar"), get("price-products"));
  get("price-save-bar").append(...["price-save-state", "price-view-message", "save-prices", "add-price-product"].map(get));
  const requests = [];
  let respondImport = async () => new Response(JSON.stringify({
    ...result, previewed: true, rolledBack: true, receipt: "signed.preview",
  }));
  let respondPrice = async () => new Response(JSON.stringify({
    activeYear: 2026, years: [{ year: 2026, revision: 1 }],
    catalogue: { year: 2026, revision: 1, products: catalogueProducts(products.slice(0, 1)) },
  }));
  let confirmed = true;
  let transfer = async () => {};
  let respondMedia = async body => Response.json(body.action === "sign" ?
    { cloudName: mediaAsset.cloudName, resourceType: "image", params: { public_id: mediaAsset.publicId }, ticket: "synthetic.ticket" } :
    { media: { ...mediaAsset } });
  const context = vm.createContext({
    ORDER_STATUSES, PAGE_SIZE, validOrder, validImportSummary, validCatalogue, validYear, catalogueProducts,
    validMedia, MEDIA_LIMITS, mediaUrl, isYouTubeMedia, youtubeVideoId, inspectMediaFile, transferMedia: (...args) => transfer(...args),
    AbortController, AbortSignal, URL, URLSearchParams, Intl, console,
    document: { getElementById: get, createElement: tag => new Node(tag),
      documentElement: { style: { setProperty: (key, value) => styles.set(key, value) } } },
    ResizeObserver: class {
      constructor(callback) { resizeBar = callback; }
      observe() {}
    },
    window: { addEventListener() {}, confirm: () => confirmed }, history: { replaceState() {} },
    location: { href: "https://vendor.example/vendor/" },
    setTimeout: () => 0, clearTimeout() {},
    fetch: async (path, options) => {
      requests.push({ path, ...options });
      if (path === "/api/vendor-auth/session") return new Response(JSON.stringify({
        email: "owner@example.com", csrf: "a".repeat(43), expiresAt: Date.now() + 600000,
      }));
      if (path.startsWith("/api/vendor-orders")) return new Response(JSON.stringify({
        orders: [], total: 0, page: 1,
        stats: { requestValue: 0, ...Object.fromEntries(ORDER_STATUSES.map(status => [status, 0])) },
      }));
      if (path === "/api/vendor-import" && !options.method) return new Response(JSON.stringify({
        enabled: true, maxFileBytes: 512000, message: "Owner-approved file only.",
      }));
      if (path === "/api/vendor-import") return respondImport(JSON.parse(options.body));
      if (path === "/api/vendor-auth/logout") return new Response("{}");
      if (path.startsWith("/api/vendor-catalogue")) return respondPrice(path, options);
      if (path === "/api/vendor-media") return respondMedia(JSON.parse(options.body), options);
      throw new Error("Unexpected test route");
    },
  });
  const source = await readFile(new URL("../vendor-app/vendor.mjs", import.meta.url), "utf8");
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, ""), context);
  await tick();
  const emit = async (id, type = "click") => {
    await get(id).events.get(type)({ preventDefault() {} });
    await tick();
  };
  return {
    get, requests, emit, context, styles, get focused() { return focused; },
    resizeSaveBar(height) {
      get("price-save-bar").height = height;
      resizeBar([{ target: get("price-save-bar") }]);
    },
    respond(callback) { respondImport = callback; },
    respondPrice(callback) { respondPrice = callback; },
    respondMedia(callback) { respondMedia = callback; },
    transfer(callback) { transfer = callback; },
    confirm(value) { confirmed = value; },
    async choose() {
      await emit("open-import");
      get("import-file").files = [{ name: "approved.sql", size: 16, text: async () => "approved-fixture" }];
      await emit("import-file", "change");
    },
  };
}

test("vendor uploads remain drafts, require explicit save and retain descriptions, credits, cover order and removal", async () => {
  const ui = await harness();
  await ui.emit("open-prices");
  ui.context.fileInput = { files: [{ name: "photo.jpg", type: "image/jpeg", size: 1000 }] };
  await vm.runInContext("uploadProductMedia(priceList.products[0], fileInput)", ui.context);
  assert.equal(ui.requests.filter(req => req.path === "/api/vendor-media").length, 2);
  assert.equal(ui.requests.find(req => req.path === "/api/vendor-media").headers["X-Vendor-CSRF"], "a".repeat(43));
  assert.equal(ui.requests.filter(req => req.path === "/api/vendor-catalogue" && req.method === "POST").length, 0);
  assert.match(ui.get("price-message").textContent, /draft.*Save price list/);
  assert.equal(ui.get("save-prices").disabled, false);
  let details = ui.get("media-product-1");
  const firstItem = details.children[2].children[0];
  const credit = firstItem.children[4].children[0];
  credit.value = "Illustrative example - licensed test credit";
  credit.events.get("input")();
  assert.equal(vm.runInContext("priceList.products[0].media[0].credit", ui.context), credit.value);
  vm.runInContext("priceList.products[0].media.push({ ...priceList.products[0].media[0], publicId: priceList.products[0].media[0].publicId.slice(0,-1) + '2' }); renderPriceProducts()", ui.context);
  details = ui.get("media-product-1");
  const secondActions = details.children[2].children[1].children.at(-1);
  secondActions.children.find(button => button.textContent === "Use as cover").events.get("click")();
  assert.match(vm.runInContext("priceList.products[0].media[0].publicId", ui.context), /2$/);
  details = ui.get("media-product-1");
  details.children[2].children[1].children.at(-1).children.find(button => button.textContent === "Remove media").events.get("click")();
  assert.equal(vm.runInContext("priceList.products[0].media.length", ui.context), 1);
  ui.respondPrice(async (_path, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.products[0].media[0].proof, mediaAsset.proof);
    return Response.json({ activeYear: 2026, years: [{ year: 2026, revision: 2 }],
      catalogue: { year: 2026, revision: 2, products: body.products } });
  });
  await ui.emit("price-form", "submit");
  assert.equal(ui.get("save-prices").disabled, true);
});

test("media upload blocks duplicates, enforces product limits and suppresses late replies after session expiry", async () => {
  const ui = await harness();
  await ui.emit("open-prices");
  ui.context.fileInput = { files: [{ name: "photo.jpg", type: "image/jpeg", size: 1000 }] };
  let release;
  ui.transfer(() => new Promise(resolve => { release = resolve; }));
  const pending = vm.runInContext("uploadProductMedia(priceList.products[0], fileInput)", ui.context);
  await tick();
  assert.equal(ui.get("close-prices").disabled, true);
  assert.equal(ui.get("price-toggle-1").disabled, true);
  await vm.runInContext("uploadProductMedia(priceList.products[0], fileInput)", ui.context);
  assert.equal(ui.requests.filter(req => req.path === "/api/vendor-media").length, 1);
  vm.runInContext("clearPrivateView()", ui.context);
  release();
  await pending;
  assert.equal(ui.get("price-products").children.length, 0);
  assert.equal(ui.get("price-message").textContent, "");
  assert.equal(ui.requests.filter(req => req.path === "/api/vendor-media").length, 1);
  const limited = await harness();
  await limited.emit("open-prices");
  limited.context.asset = mediaAsset;
  limited.context.fileInput = ui.context.fileInput;
  vm.runInContext("priceList.products[0].media = [asset, asset, asset]", limited.context);
  await vm.runInContext("uploadProductMedia(priceList.products[0], fileInput)", limited.context);
  assert.match(limited.get("price-message").textContent, /maximum 3 photos/);
  assert.equal(limited.requests.some(req => req.path === "/api/vendor-media"), false);
});

test("vendors add validated YouTube links as drafts without upload calls and save them explicitly", async () => {
  const ui = await harness();
  await ui.emit("open-prices");
  await ui.emit("price-toggle-1");
  const input = ui.get("youtube-url-1");
  const add = ui.get("media-product-1").querySelectorAll("button").find(node => node.textContent === "Add YouTube video");
  input.value = "https://youtube.com.evil.example/watch?v=M7lc1UVf-VE";
  await add.events.get("click")();
  assert.equal(input.reported, true);
  assert.equal(ui.focused, input);
  assert.match(ui.get("price-message").textContent, /valid HTTPS YouTube video URL/);
  assert.equal(vm.runInContext("priceList.products[0].media", ui.context), undefined);
  input.value = "https://youtu.be/M7lc1UVf-VE?si=discard&t=20";
  await add.events.get("click")();
  const media = JSON.parse(vm.runInContext("JSON.stringify(priceList.products[0].media)", ui.context));
  assert.deepEqual(media, [{ provider: "youtube", resourceType: "video", videoId: "M7lc1UVf-VE",
    alt: products[0].name, credit: "" }]);
  assert.equal(ui.requests.some(req => req.path === "/api/vendor-media"), false);
  assert.equal(ui.requests.some(req => req.method === "POST"), false);
  assert.match(ui.get("price-message").textContent, /draft.*Save price list/);
  assert.equal(ui.get("save-prices").disabled, false);
  await add.events.get("click")();
  assert.match(ui.get("price-message").textContent, /maximum 1 video/);
  assert.equal(vm.runInContext("priceList.products[0].media.length", ui.context), 1);
  ui.context.inspectMediaFile = async () => "video";
  ui.context.fileInput = { files: [{ name: "video.mp4", size: 1000 }] };
  await vm.runInContext("uploadProductMedia(priceList.products[0], fileInput)", ui.context);
  assert.match(ui.get("price-message").textContent, /maximum 1 video/);
  assert.equal(ui.requests.some(req => req.path === "/api/vendor-media"), false);
  ui.respondPrice(async (_path, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.products[0].media, media);
    return Response.json({ activeYear: 2026, years: [{ year: 2026, revision: 2 }],
      catalogue: { year: 2026, revision: 2, products: body.products } });
  });
  await ui.emit("price-form", "submit");
  assert.equal(ui.get("save-prices").disabled, true);
});

test("unconfirmed or failed media verification keeps existing draft edits and never appends an asset", async () => {
  for (const response of [new Response(JSON.stringify({ error: "Synthetic Cloudinary outage" }), { status: 503 }),
    Response.json({ media: { ...mediaAsset, proof: undefined } })]) {
    const ui = await harness();
    await ui.emit("open-prices");
    ui.context.fileInput = { files: [{ name: "photo.jpg", type: "image/jpeg", size: 1000 }] };
    vm.runInContext("priceList.products[0].price = 123; priceDirty = true", ui.context);
    ui.respondMedia(async body => body.action === "sign" ? Response.json({
      cloudName: mediaAsset.cloudName, resourceType: "image", params: { public_id: mediaAsset.publicId }, ticket: "synthetic.ticket",
    }) : response);
    await vm.runInContext("uploadProductMedia(priceList.products[0], fileInput)", ui.context);
    assert.equal(vm.runInContext("priceList.products[0].media", ui.context), undefined);
    assert.equal(vm.runInContext("priceList.products[0].price", ui.context), 123);
    assert.match(ui.get("price-message").textContent, /existing edits and saved list are unchanged/);
    assert.equal(ui.get("save-prices").disabled, false);
  }
});

test("stale upload authorization forces a saved-list reload without discarding visible draft edits", async () => {
  const ui = await harness();
  await ui.emit("open-prices");
  ui.context.fileInput = { files: [{ name: "photo.jpg", type: "image/jpeg", size: 1000 }] };
  vm.runInContext("priceList.products[0].price = 123; priceDirty = true", ui.context);
  ui.respondMedia(async () => Response.json({ error: "The saved list changed. Reload it before uploading." }, { status: 409 }));
  await vm.runInContext("uploadProductMedia(priceList.products[0], fileInput)", ui.context);
  assert.equal(vm.runInContext("priceList.products[0].price", ui.context), 123);
  assert.equal(ui.get("save-prices").disabled, true);
  assert.equal(ui.get("reload-prices").disabled, false);
  assert.equal(ui.get("price-toggle-1").disabled, true);
  assert.equal(ui.get("price-view-message").disabled, false);
  assert.match(ui.get("price-message").textContent, /saved list changed.*existing edits/);
});

test("visibility edits remain in drafts across rows and save hidden products without deleting their details or media", async () => {
  const ui = await harness();
  await ui.emit("open-prices");
  vm.runInContext("priceList.products.push({ ...priceList.products[0], id: 2 }); priceList.products[0].media = [asset]",
    Object.assign(ui.context, { asset: mediaAsset }));
  await ui.emit("price-toggle-1");
  assert.equal(ui.get("price-visible-1").checked, true);
  ui.get("price-visible-1").checked = false;
  await ui.emit("price-visible-1", "change");
  assert.equal(vm.runInContext("priceList.products[0].hidden", ui.context), true);
  assert.match(ui.get("price-toggle-1").getAttribute("aria-label"), /Hidden from customers/);
  assert.match(ui.get("price-save-state").textContent, /2 products, 1 hidden.*Unsaved changes/);
  const status = ui.get("price-toggle-1").querySelectorAll("small").find(node => node.textContent === "Hidden from customers");
  assert.equal(status.hidden, false);
  await ui.emit("price-toggle-2");
  await ui.emit("price-toggle-1");
  assert.equal(ui.get("price-visible-1").checked, false);
  assert.equal(ui.get("save-prices").disabled, false);
  let saved;
  ui.respondPrice(async (_path, options) => {
    const body = JSON.parse(options.body);
    saved = body.products;
    return Response.json({ activeYear: 2026, years: [{ year: 2026, revision: 2 }],
      catalogue: { year: 2026, revision: 2, products: body.products } });
  });
  await ui.emit("price-form", "submit");
  assert.equal(saved.length, 2);
  assert.equal(saved[0].hidden, true);
  assert.deepEqual(saved[0].media, [mediaAsset]);
  assert.equal(ui.get("save-prices").disabled, true);
  assert.equal(ui.get("price-visible-1").checked, false);
  ui.get("price-visible-1").checked = true;
  await ui.emit("price-visible-1", "change");
  assert.equal(vm.runInContext("priceList.products[0].hidden", ui.context), false);
  assert.equal(ui.get("price-toggle-1").getAttribute("aria-label").includes("Hidden from customers"), false);
  assert.match(ui.get("price-save-state").textContent, /2 products\. Unsaved changes/);
  vm.runInContext("priceNeedsReload = true; setPriceBusy(false)", ui.context);
  assert.equal(ui.get("price-visible-1").disabled, true);
});

test("import loads on demand, requires rolled-back preview and acknowledgement, then refreshes the register", async () => {
  const ui = await harness();
  assert.equal(ui.requests.some(req => req.path === "/api/vendor-import"), false);
  await ui.choose();
  assert.equal(ui.get("preview-import").disabled, false);
  assert.equal(ui.get("commit-import").disabled, true);
  await ui.emit("import-form", "submit");
  assert.match(ui.get("import-message").textContent, /Preview rolled back; nothing saved/);
  assert.equal(ui.get("commit-import").disabled, true);
  ui.get("import-ack").checked = true;
  await ui.emit("import-ack", "change");
  assert.equal(ui.get("commit-import").disabled, false);
  const listBefore = ui.requests.filter(req => req.path.startsWith("/api/vendor-orders")).length;
  ui.respond(async body => {
    assert.equal(body.action, "import");
    assert.equal(body.receipt, "signed.preview");
    assert.equal(body.acknowledge, true);
    return new Response(JSON.stringify({ ...result, imported: true }));
  });
  await ui.emit("commit-import");
  assert.match(ui.get("import-message").textContent, /Import confirmed/);
  assert.equal(ui.get("preview-import").disabled, true);
  assert.equal(ui.get("commit-import").disabled, true);
  assert.equal(ui.get("import-file").value, "");
  assert.equal(ui.requests.filter(req => req.path.startsWith("/api/vendor-orders")).length, listBefore + 1);
});

  test("yearly prices load on demand, protect dirty edits and send an authenticated optimistic save", async () => {
    const ui = await harness();
    assert.equal(ui.requests.some(req => req.path.startsWith("/api/vendor-catalogue")), false);
    await ui.emit("open-prices");
    assert.equal(ui.get("price-products").children.length, 2);
    assert.equal(ui.get("save-prices").disabled, true);
    await ui.emit("price-toggle-1");
    const price = ui.get("price-price-1");
    price.value = "99.95";
    price.events.get("input")();
    assert.equal(ui.get("save-prices").disabled, false);
    assert.equal(ui.get("activate-prices").disabled, true);
    ui.confirm(false);
    await ui.emit("close-prices");
    assert.equal(ui.get("price-panel").hidden, false);
    const before = ui.requests.length;
    await ui.emit("reload-prices");
    assert.equal(ui.requests.length, before);
    ui.confirm(true);
    ui.respondPrice(async (path, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.action, "save");
      assert.equal(body.year, 2026);
      assert.equal(body.expectedRevision, 1);
      assert.equal(body.products[0].price, 99.95);
      assert.equal(options.headers["X-Vendor-CSRF"], "a".repeat(43));
      return new Response(JSON.stringify({
        activeYear: 2026, years: [{ year: 2026, revision: 2 }],
        catalogue: { year: 2026, revision: 2, products: body.products },
      }));
    });
    await ui.emit("price-form", "submit");
    assert.match(ui.get("price-message").textContent, /Price list saved for 2026/);
    assert.equal(ui.get("save-prices").disabled, true);
  });

  test("price writes block duplicates and late acknowledgements cannot repopulate signed-out private data", async () => {
    const ui = await harness();
    await ui.emit("open-prices");
    let finish;
    ui.respondPrice(() => new Promise(resolve => { finish = resolve; }));
    ui.get("new-price-year").value = "2027";
    await ui.emit("create-price-year", "submit");
    assert.equal(ui.get("sign-out").disabled, true);
    assert.equal(ui.get("close-prices").disabled, true);
    const before = ui.requests.length;
    await ui.emit("create-price-year", "submit");
    await ui.emit("close-prices");
    assert.equal(ui.requests.length, before);
    vm.runInContext("clearPrivateView()", ui.context);
    finish(new Response(JSON.stringify({ activeYear: 2026, years: [{ year: 2026, revision: 1 }, { year: 2027, revision: 1 }],
      catalogue: { year: 2027, revision: 1, products: catalogueProducts(products.slice(0, 1)) } })));
    await tick();
    assert.equal(ui.get("price-panel").hidden, true);
    assert.equal(ui.get("price-products").children.length, 0);
    assert.equal(ui.get("price-message").textContent, "");
  });

  test("uncertain price writes keep visible drafts but require reload instead of blindly repeating", async () => {
    const ui = await harness();
    await ui.emit("open-prices");
    await ui.emit("price-toggle-1");
    const price = ui.get("price-price-1");
    price.value = "125";
    price.events.get("input")();
    ui.respondPrice(async () => { throw new Error("Synthetic network loss"); });
    await ui.emit("price-form", "submit");
    assert.match(ui.get("price-message").textContent, /visible edits have been kept.*whether the change was committed/);
    assert.equal(ui.get("save-prices").disabled, true);
    assert.equal(price.value, "125");
    const before = ui.requests.length;
    await ui.emit("price-form", "submit");
    assert.equal(ui.requests.length, before);
  });

test("price table rows expand accessibly, keep drafts across rows and update their summaries", async () => {
  const ui = await harness();
  ui.respondPrice(async () => Response.json({ activeYear: 2026, years: [{ year: 2026, revision: 1 }],
    catalogue: { year: 2026, revision: 1, products: catalogueProducts(products.slice(0, 2)) } }));
  await ui.emit("open-prices");
  assert.equal(ui.get("price-products").children.length, 4);
  assert.equal(ui.get("price-products").querySelectorAll("input").length, 0);
  assert.equal(ui.get("price-toggle-1").tagName, "BUTTON");
  assert.equal(ui.get("price-toggle-1").getAttribute("aria-expanded"), "false");
  assert.equal(ui.get("price-toggle-1").getAttribute("aria-controls"), "price-details-1");
  await ui.emit("price-toggle-1");
  assert.equal(ui.get("price-details-1").hidden, false);
  assert.equal(ui.focused, ui.get("price-toggle-1"));
  const price = ui.get("price-price-1");
  price.value = "99.95";
  price.events.get("input")();
  assert.equal(ui.get("price-products").children[0].children[4].textContent, "99.95");
  assert.match(ui.get("price-save-state").textContent, /2026 - 2 products.*Unsaved changes/);
  await ui.emit("price-toggle-2");
  assert.equal(ui.get("price-details-1").hidden, true);
  assert.equal(ui.get("price-details-2").hidden, false);
  await ui.emit("price-toggle-1");
  assert.equal(ui.get("price-price-1").value, 99.95);
  const close = ui.get("price-editor-1").querySelectorAll("button").find(button => button.textContent === "Close details");
  close.events.get("click")();
  assert.equal(ui.get("price-details-1").hidden, true);
  assert.equal(ui.get("save-prices").disabled, false);
});

test("saving reveals and focuses invalid collapsed fields and media descriptions before making any request", async () => {
  for (const field of ["brand", "price", "media"]) {
    const ui = await harness();
    await ui.emit("open-prices");
    await ui.emit("price-toggle-1");
    if (field === "media") {
      ui.context.asset = { ...mediaAsset, alt: "   " };
      vm.runInContext("priceList.products[0].media = [asset]; priceDirty = true", ui.context);
    } else {
      const input = ui.get(`price-${field}-1`);
      input.value = field === "price" ? "12.345" : "   ";
      input.events.get("input")();
    }
    await ui.emit("price-toggle-1");
    await ui.emit("price-form", "submit");
    assert.equal(ui.requests.filter(req => req.method === "POST").length, 0);
    assert.equal(ui.get("price-details-1").hidden, false);
    assert.equal(ui.focused.reported, true);
    assert.equal(ui.focused.checkValidity(), false);
    if (field === "media") assert.equal(ui.get("media-product-1").open, true);
    else assert.equal(ui.focused, ui.get(`price-${field}-1`));
    assert.equal(ui.get("price-view-message").hidden, false);
    await ui.emit("price-view-message");
    assert.equal(ui.focused, ui.get("price-message"));
    assert.equal(ui.get("price-message").scrolled, true);
  }
});

test("adding opens the new product, removal preserves other drafts and year changes reset expanded details", async () => {
  const ui = await harness();
  await ui.emit("open-prices");
  await ui.emit("add-price-product");
  assert.equal(ui.get("price-details-2").hidden, false);
  assert.equal(ui.focused, ui.get("price-name-2"));
  assert.ok(ui.get("media-product-2").children.some(node => /Save this new product/.test(node.textContent)));
  assert.equal(ui.get("youtube-url-2").type, "url");
  const remove = ui.get("price-editor-2").querySelectorAll("button").find(button => button.textContent === "Remove product #2");
  remove.events.get("click")();
  assert.equal(ui.get("price-products").children.length, 2);
  assert.equal(ui.focused, ui.get("add-price-product"));
  await ui.emit("price-toggle-1");
  ui.respondPrice(async () => Response.json({ activeYear: 2026,
    years: [{ year: 2026, revision: 1 }, { year: 2027, revision: 1 }],
    catalogue: { year: 2027, revision: 1, products: catalogueProducts(products.slice(0, 1)) } }));
  ui.get("price-year").value = "2027";
  await ui.emit("price-year", "change");
  assert.equal(ui.get("price-details-1").hidden, true);
  assert.match(ui.get("price-save-state").textContent, /2027.*All changes saved/);
});

test("collapsing an editor unloads its video, and expiry clears expansion and sticky status", async () => {
  const ui = await harness();
  await ui.emit("open-prices");
  ui.context.asset = { ...mediaAsset, resourceType: "video", duration: 10, format: "mp4" };
  vm.runInContext("priceList.products[0].media = [asset]", ui.context);
  await ui.emit("price-toggle-1");
  const video = ui.get("price-products").querySelector("video");
  await ui.emit("price-toggle-1");
  assert.equal(video.paused, true);
  assert.equal(video.unloaded, true);
  vm.runInContext("clearPrivateView()", ui.context);
  assert.equal(ui.get("price-save-state").textContent, "");
  assert.equal(vm.runInContext("expandedProductId", ui.context), null);
});

test("sticky controls reserve their measured height for focus scrolling and restore the default when hidden", async () => {
  const ui = await harness();
  for (const [height, offset] of [[104.8, "121px"], [269.2, "286px"], [0, "24px"]]) {
    ui.resizeSaveBar(height);
    assert.equal(ui.styles.get("--vendor-save-offset"), offset);
  }
});
test("pending imports cannot duplicate or close; logout clears private data and suppresses late responses", async () => {
  const ui = await harness();
  await ui.choose();
  let finish;
  ui.respond(() => new Promise(resolve => { finish = resolve; }));
  await ui.emit("import-form", "submit");
  const calls = ui.requests.length;
  assert.equal(ui.get("import-file").disabled, true);
  assert.equal(ui.get("close-import").disabled, true);
  assert.equal(ui.get("sign-out").disabled, true);
  await ui.emit("import-form", "submit");
  await ui.emit("close-import");
  assert.equal(ui.requests.length, calls);
  assert.equal(ui.get("import-panel").hidden, false);
  vm.runInContext("clearPrivateView()", ui.context);
  finish(new Response(JSON.stringify({ ...result, previewed: true, rolledBack: true, receipt: "signed.preview" })));
  await tick();
  assert.equal(ui.get("import-panel").hidden, true);
  assert.equal(ui.get("import-message").textContent, "");
  assert.equal(ui.get("commit-import").disabled, true);
  assert.equal(vm.runInContext("importSql", ui.context), "");
  assert.equal(vm.runInContext("importReceipt", ui.context), "");
});

test("changed files invalidate approvals; malformed or uncertain replies require a new preview", async () => {
  const ui = await harness();
  await ui.choose();
  await ui.emit("import-form", "submit");
  ui.get("import-ack").checked = true;
  await ui.emit("import-ack", "change");
  await ui.emit("import-file", "change");
  assert.equal(ui.get("commit-import").disabled, true);
  assert.equal(ui.get("import-ack").checked, false);
  ui.respond(async () => new Response(JSON.stringify({ ...result, previewed: true, receipt: "signed.preview" })));
  await ui.emit("import-form", "submit");
  assert.match(ui.get("import-message").textContent, /acknowledgement could not be verified/);
  assert.equal(ui.get("commit-import").disabled, true);
  ui.respond(async () => { throw new Error("Network unavailable"); });
  await ui.emit("import-form", "submit");
  assert.match(ui.get("import-message").textContent, /Check the register/);
  assert.equal(ui.get("preview-import").disabled, false);
  ui.get("import-file").files = [{ name: "orders.xlsx", size: 10, text: async () => "not SQL" }];
  await ui.emit("import-file", "change");
  assert.equal(ui.get("preview-import").disabled, true);
  assert.match(ui.get("import-message").textContent, /original approved .sql file/);
});
