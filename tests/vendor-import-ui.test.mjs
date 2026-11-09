import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { ORDER_STATUSES, PAGE_SIZE, validOrder, validImportSummary } from "../vendor-app/vendor-model.mjs";
import { validCatalogue, validYear, catalogueProducts } from "../vendor-app/catalogue-model.mjs";
import { products } from "../vendor-app/catalog.mjs";
import { validMedia, MEDIA_LIMITS, mediaUrl } from "../vendor-app/media-model.mjs";
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
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: "", textContent: "", hidden: false, disabled: false, checked: false,
      dataset: {}, files: [], events: new Map(), children: [],
      addEventListener(type, callback) { this.events.set(type, callback); },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute() {}, close() {}, showModal() {}, querySelectorAll() { return []; }, focus() {},
    });
    return nodes.get(id);
  };
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
    validMedia, MEDIA_LIMITS, mediaUrl, inspectMediaFile, transferMedia: (...args) => transfer(...args),
    AbortController, AbortSignal, URL, URLSearchParams, Intl, console,
    document: { getElementById: get, createElement: () => get(Symbol()) },
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
    get, requests, emit, context,
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
  let details = ui.get("price-products").children[0].children.at(-1);
  const firstItem = details.children[2].children[0];
  const credit = firstItem.children[4].children[0];
  credit.value = "Illustrative example - licensed test credit";
  credit.events.get("input")();
  assert.equal(vm.runInContext("priceList.products[0].media[0].credit", ui.context), credit.value);
  vm.runInContext("priceList.products[0].media.push({ ...priceList.products[0].media[0], publicId: priceList.products[0].media[0].publicId.slice(0,-1) + '2' }); renderPriceProducts()", ui.context);
  details = ui.get("price-products").children[0].children.at(-1);
  const secondActions = details.children[2].children[1].children.at(-1);
  secondActions.children.find(button => button.textContent === "Use as cover").events.get("click")();
  assert.match(vm.runInContext("priceList.products[0].media[0].publicId", ui.context), /2$/);
  details = ui.get("price-products").children[0].children.at(-1);
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
  assert.match(ui.get("price-message").textContent, /saved list changed.*existing edits/);
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
    assert.equal(ui.get("price-products").children.length, 1);
    assert.equal(ui.get("save-prices").disabled, true);
    const price = ui.get("price-products").children[0].children[5].children[0];
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
    const price = ui.get("price-products").children[0].children[5].children[0];
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
