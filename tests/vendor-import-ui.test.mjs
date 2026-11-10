import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { ORDER_STATUSES, PAGE_SIZE, validOrder } from "../vendor-app/vendor-model.mjs";
import { validCatalogue, validYear, catalogueProducts } from "../vendor-app/catalogue-model.mjs";
import { products } from "../vendor-app/catalog.mjs";
import { validMedia, MEDIA_LIMITS, mediaUrl, isYouTubeMedia, youtubeVideoId } from "../vendor-app/media-model.mjs";
import { inspectMediaFile } from "../vendor-app/media-upload.mjs";

const mediaAsset = { cloudName: "synthetic-cloud", publicId: "sai-baba-crackers/products/00000000-0000-4000-8000-000000000001",
  resourceType: "image", version: 1234567890, format: "jpg", bytes: 1000, width: 640, height: 480,
  duration: 0, alt: "Synthetic product photo", credit: "", proof: "p".repeat(43) };

const tick = () => new Promise(resolve => setImmediate(resolve));
const sampleOrder = {
  orderId: "SBC-00000000-0000-4000-8000-000000000001", createdAt: "2026-11-10T05:30:00.000Z",
  status: "New", name: "<script>Synthetic customer</script>", phone: "9876543210", fulfilment: "Pickup",
  total: 85, subtotal: 100, discountPercent: 15, discount: 15, deliveryCharge: 0,
  address: "Synthetic address", preferredDate: "", items: "Synthetic product x 1", notes: "",
};
function orderListing(orders = [], page = 1) {
  return {
    orders: orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: orders.length, page,
    stats: { requestValue: orders.filter(order => order.status !== "Cancelled").reduce((sum, order) => sum + order.total, 0),
      ...Object.fromEntries(ORDER_STATUSES.map(status => [status, orders.filter(order => order.status === status).length])) },
  };
}
function shareResult() {
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  return {
    orderId: sampleOrder.orderId, expiresAt,
    url: `https://vendor.example/request/${expiresAt.slice(0, 10).replaceAll("-", "")}.${"a".repeat(43)}`,
  };
}
async function openShareOrder(ui) {
  ui.respondOrders(async path => Response.json(path.includes("orderId=") ? { order: sampleOrder } : orderListing([sampleOrder])));
  await vm.runInContext(`openDetails(${JSON.stringify(sampleOrder.orderId)})`, ui.context);
}
async function harness({ navigator = {} } = {}) {
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
    removeAttribute(key) { delete this.attributes[key]; if (key === "href") delete this.href; }
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
    select() { this.selected = true; }
    scrollIntoView() { this.scrolled = true; }
    getBoundingClientRect() { return { height: this.height ?? 0 }; }
    close() { this.open = false; }
    showModal() { this.open = true; }
    pause() { this.paused = true; }
    load() { this.unloaded = true; }
  }
  const find = (node, id) => node.id === id ? node : node.children.map(child => find(child, id)).find(Boolean);
  const get = id => {
    if (/(?:^|-)import(?:-|$)/.test(id)) throw new Error(`Removed historical-import control accessed: ${id}`);
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
  let respondOrders = async () => Response.json(orderListing());
  let respondShare = async () => Response.json(shareResult());
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
    ORDER_STATUSES, PAGE_SIZE, validOrder, validCatalogue, validYear, catalogueProducts,
    validMedia, MEDIA_LIMITS, mediaUrl, isYouTubeMedia, youtubeVideoId, inspectMediaFile, transferMedia: (...args) => transfer(...args),
    AbortController, AbortSignal, URL, URLSearchParams, Intl, console, navigator,
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
      if (path.startsWith("/api/vendor-orders")) return respondOrders(path, options);
      if (path === "/api/vendor-auth/logout") return new Response("{}");
      if (path === "/api/vendor-order-share") return respondShare(JSON.parse(options.body), options);
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
    respondOrders(callback) { respondOrders = callback; },
    respondShare(callback) { respondShare = callback; },
    respondPrice(callback) { respondPrice = callback; },
    respondMedia(callback) { respondMedia = callback; },
    transfer(callback) { transfer = callback; },
    confirm(value) { confirmed = value; },
  };
}

test("sharing is explicitly created for the selected saved request and exposes WhatsApp, native sharing and copying without automatic sends", async () => {
  const copied = [];
  const shared = [];
  const ui = await harness({ navigator: {
    clipboard: { writeText: async value => copied.push(value) },
    share: async payload => shared.push(payload), canShare: () => true,
  } });
  await openShareOrder(ui);
  assert.equal(ui.get("share-ready").hidden, true);
  assert.equal(ui.requests.some(request => request.path === "/api/vendor-order-share"), false);
  await ui.emit("create-share");
  assert.equal(ui.get("share-ready").hidden, false);
  assert.equal(ui.get("create-share").hidden, true);
  assert.equal(ui.get("share-other").hidden, false);
  const creation = ui.requests.find(request => request.path === "/api/vendor-order-share");
  assert.equal(creation.method, "POST");
  assert.equal(creation.headers["X-Vendor-CSRF"], "a".repeat(43));
  assert.deepEqual(JSON.parse(creation.body), { orderId: sampleOrder.orderId });
  const link = ui.get("share-link").value;
  assert.match(link, /^https:\/\/vendor\.example\/request\/\d{8}\.[a-z]{43}$/);
  const whatsapp = new URL(ui.get("share-whatsapp").href);
  assert.equal(whatsapp.origin, "https://wa.me");
  assert.ok(whatsapp.searchParams.get("text").includes(link));
  assert.ok(!whatsapp.searchParams.get("text").includes(sampleOrder.phone));
  assert.match(ui.get("share-expiry").textContent, /IST/);
  assert.equal(copied.length, 0);
  assert.equal(shared.length, 0);
  await ui.emit("copy-share");
  assert.deepEqual(copied, [link]);
  await ui.emit("share-other");
  assert.equal(shared[0].url, link);
  assert.ok(shared[0].title.includes(sampleOrder.orderId));
  assert.match(ui.get("share-message").textContent, /handed to your sharing app/);
  assert.equal(ui.requests.filter(request => request.path === "/api/vendor-order-share").length, 1);
});

test("unsupported sharing and blocked clipboard access keep a selectable link with explicit fallback feedback", async () => {
  const ui = await harness();
  await openShareOrder(ui);
  await ui.emit("create-share");
  assert.equal(ui.get("share-other").hidden, true);
  await ui.emit("copy-share");
  assert.match(ui.get("share-message").textContent, /Select and copy.*manually/);
  assert.equal(ui.get("share-message").dataset.error, "true");
  assert.equal(ui.get("share-link").selected, true);
  assert.equal(ui.focused, ui.get("share-link"));
  const unsupported = await harness({ navigator: { share() {}, canShare: () => false } });
  await openShareOrder(unsupported);
  await unsupported.emit("create-share");
  assert.equal(unsupported.get("share-other").hidden, true);
  assert.equal(unsupported.get("share-ready").hidden, false);
});

test("native share cancellation is not a failure; real failures remain actionable and repeated pending shares are blocked", async () => {
  let finish;
  const ui = await harness({ navigator: { share: () => new Promise(resolve => { finish = resolve; }) } });
  await openShareOrder(ui);
  await ui.emit("create-share");
  const pending = ui.emit("share-other");
  await tick();
  assert.equal(ui.get("share-other").disabled, true);
  await ui.emit("share-other");
  finish();
  await pending;
  assert.equal(ui.get("share-other").disabled, false);
  ui.context.navigator.share = async () => { throw Object.assign(new Error("Cancelled"), { name: "AbortError" }); };
  await ui.emit("share-other");
  assert.match(ui.get("share-message").textContent, /Sharing cancelled/);
  assert.equal(ui.get("share-message").dataset.error, "false");
  ui.context.navigator.share = async () => { throw new Error("Sharing blocked"); };
  await ui.emit("share-other");
  assert.match(ui.get("share-message").textContent, /Sharing blocked.*Use WhatsApp or Copy link/);
  assert.equal(ui.get("share-message").dataset.error, "true");
});

test("unverified, foreign, mismatched and expired links are never offered for sharing, and failed creation can be retried", async () => {
  const ui = await harness();
  await openShareOrder(ui);
  const valid = shareResult();
  for (const result of [
    { ...valid, url: valid.url.replace("vendor.example", "elsewhere.example") },
    { ...valid, url: valid.url.replace("vendor.example", "user:password@vendor.example") },
    { ...valid, url: valid.url + "?other=1" },
    { ...valid, url: valid.url + "#other" },
    { ...valid, orderId: "another-order" },
    { ...valid, expiresAt: new Date(Date.now() - 1).toISOString() },
    { ...valid, expiresAt: new Date(Date.now() + 8 * 86400000).toISOString() },
    { ...valid, url: "https://vendor.example/request/invalid" },
    { ...valid, expiresAt: "invalid" }, {},
  ]) {
    ui.respondShare(async () => Response.json(result));
    await ui.emit("create-share");
    assert.equal(ui.get("share-ready").hidden, true);
    assert.equal(ui.get("share-link").value, "");
    assert.equal(ui.get("create-share").disabled, false);
    assert.match(ui.get("share-message").textContent, /could not be verified/);
  }
  ui.respondShare(async () => { throw new Error("Network unavailable"); });
  await ui.emit("create-share");
  assert.match(ui.get("share-message").textContent, /Network unavailable/);
  ui.respondShare(async () => Response.json(shareResult()));
  await ui.emit("create-share");
  assert.equal(ui.get("share-ready").hidden, false);
});

test("duplicate link creation is blocked and close, changed details or sign-out suppress late replies and clear private links", async () => {
  for (const action of ["close", "change", "sign-out"]) {
    const ui = await harness();
    await openShareOrder(ui);
    let finish;
    ui.respondShare(() => new Promise(resolve => { finish = resolve; }));
    const pending = ui.emit("create-share");
    await tick();
    assert.equal(ui.get("create-share").disabled, true);
    const before = ui.requests.length;
    await ui.emit("create-share");
    assert.equal(ui.requests.length, before);
    if (action === "close") await ui.emit("order-dialog", "close");
    else if (action === "change") await openShareOrder(ui);
    else await ui.emit("sign-out");
    finish(Response.json(shareResult()));
    await pending;
    assert.equal(ui.get("share-ready").hidden, true);
    assert.equal(ui.get("share-link").value, "");
    assert.equal(ui.get("share-whatsapp").href, undefined);
  }
  const ui = await harness();
  await openShareOrder(ui);
  await ui.emit("create-share");
  await ui.emit("sign-out");
  assert.equal(ui.get("share-link").value, "");
  assert.equal(ui.get("share-expiry").textContent, "");
  assert.equal(ui.get("share-message").textContent, "");
});

test("saving a status clears sharing controls and stale clipboard replies cannot repopulate them", async () => {
  let finish;
  const ui = await harness({ navigator: { clipboard: { writeText: () => new Promise(resolve => { finish = resolve; }) } } });
  await openShareOrder(ui);
  await ui.emit("create-share");
  const pendingCopy = ui.emit("copy-share");
  await tick();
  ui.respondOrders(async (path, options) => Response.json(options.method === "POST" ?
    { order: { ...sampleOrder, status: "Confirmed" } } : orderListing()));
  ui.get("detail-status").value = "Confirmed";
  await ui.emit("status-form", "submit");
  assert.equal(ui.get("share-ready").hidden, true);
  assert.equal(ui.get("share-link").value, "");
  finish();
  await pendingCopy;
  assert.equal(ui.get("share-message").textContent, "");
  await ui.emit("create-share");
  assert.equal(ui.get("share-ready").hidden, false);
  vm.runInContext("clearPrivateView()", ui.context);
  assert.equal(ui.get("share-link").value, "");
  assert.equal(ui.get("share-ready").hidden, true);
});

test("late native-sharing success or failure cannot restore cleared private controls or messages", async () => {
  for (const succeeds of [true, false]) {
    let finish;
    const ui = await harness({ navigator: {
      share: () => new Promise((resolve, reject) => {
        finish = () => succeeds ? resolve() : reject(new Error("Synthetic sharing failure"));
      }),
    } });
    await openShareOrder(ui);
    await ui.emit("create-share");
    const pending = ui.emit("share-other");
    await tick();
    assert.equal(ui.get("share-other").disabled, true);
    vm.runInContext("clearPrivateView()", ui.context);
    finish();
    await pending;
    assert.equal(ui.get("share-message").textContent, "");
    assert.equal(ui.get("share-link").value, "");
    assert.equal(ui.get("share-ready").hidden, true);
    assert.equal(ui.get("share-other").disabled, false);
  }
});

test("order table rows open the existing details and keep status updates and focus restoration working", async () => {
  const ui = await harness();
  let order = { ...sampleOrder };
  ui.respondOrders(async (path, options) => {
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.orderId, order.orderId);
      assert.equal(body.expectedStatus, "New");
      assert.equal(body.status, "Confirmed");
      order = { ...order, status: body.status };
      return Response.json({ order });
    }
    return Response.json(path.includes("orderId=") ? { order } : orderListing([order]));
  });
  await ui.emit("refresh-orders");
  assert.equal(ui.get("order-table-wrap").hidden, false);
  const row = ui.get("order-list").children[0];
  assert.equal(row.tagName, "TR");
  assert.deepEqual(row.children.map(cell => cell.tagName), ["TH", "TD", "TD", "TD", "TD"]);
  assert.equal(row.children[0].scope, "row");
  const button = row.children[0].children[0];
  assert.equal(button.type, "button");
  assert.equal(button.getAttribute("aria-haspopup"), "dialog");
  assert.match(button.getAttribute("aria-label"), new RegExp(order.orderId));
  assert.equal(button.children[0].children[0].textContent, order.name);
  assert.equal(button.children[0].children[1].textContent, order.phone);
  assert.equal(row.children[1].children[0].textContent, order.orderId);
  assert.match(row.children[1].children[1].textContent, /11:00 am IST$/i);
  assert.equal(row.children[2].textContent, order.fulfilment);
  assert.equal(row.children[3].children[0].dataset.status, "New");
  assert.equal(row.children[4].textContent, "Rs.85.00");
  row.events.get("click")({ target: { closest: () => null } });
  await tick();
  assert.equal(ui.focused, button);
  assert.equal(ui.get("order-dialog").open, true);
  assert.equal(ui.get("detail-items").textContent, order.items);
  const detailReads = () => ui.requests.filter(request => request.path.includes("orderId=")).length;
  assert.equal(detailReads(), 1);
  row.events.get("click")({ target: { closest: () => button } });
  assert.equal(detailReads(), 1);
  ui.get("detail-status").value = "Confirmed";
  await ui.emit("detail-status", "change");
  assert.equal(ui.get("save-status").disabled, false);
  await ui.emit("status-form", "submit");
  assert.equal(ui.get("order-list").children[0].children[3].children[0].dataset.status, "Confirmed");
  assert.match(ui.get("detail-message").textContent, /Status saved: Confirmed/);
  await ui.emit("close-details");
  await ui.emit("order-dialog", "close");
  assert.equal(ui.focused, ui.get(button.id));
  await ui.emit(button.id);
  assert.equal(ui.get("order-dialog").open, true);
  assert.equal(detailReads(), 2);
});

test("order table preserves filtering and pagination and clears customer rows on sign-out", async () => {
  const ui = await harness();
  const orders = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => ({
    ...sampleOrder, name: `Synthetic customer ${index + 1}`,
    orderId: `SBC-00000000-0000-4000-8000-${(index + 1).toString(16).toUpperCase().padStart(12, "0")}`,
  }));
  ui.respondOrders(async path => {
    const params = new URL(path, "https://vendor.example").searchParams;
    const matches = orders.filter(order => (!params.get("query") || order.name.includes(params.get("query"))) &&
      (!params.get("status") || order.status === params.get("status")));
    return Response.json(orderListing(matches, Number(params.get("page"))));
  });
  await ui.emit("refresh-orders");
  assert.equal(ui.get("order-list").children.length, PAGE_SIZE);
  assert.equal(ui.get("pagination").hidden, false);
  await ui.emit("next-page");
  assert.equal(ui.get("order-list").children.length, 1);
  assert.equal(ui.get("page-label").textContent, "Page 2 of 2");
  assert.equal(ui.get("next-page").disabled, true);
  ui.get("order-search").value = "customer 26";
  ui.get("status-filter").value = "New";
  await ui.emit("filter-form", "submit");
  assert.equal(ui.get("page-label").textContent, "Page 1 of 1");
  assert.equal(ui.get("order-list").children.length, 1);
  assert.equal(ui.get("pagination").hidden, true);
  assert.match(ui.requests.at(-1).path, /query=customer\+26&status=New&page=1/);
  await ui.emit("clear-filters");
  assert.equal(ui.get("order-list").children.length, PAGE_SIZE);
  await ui.emit("sign-out");
  assert.equal(ui.get("order-list").children.length, 0);
  assert.equal(ui.get("order-table-wrap").hidden, true);
  assert.equal(ui.get("dashboard").hidden, true);
});

test("order table hides stale rows during loading, empty results, errors and expired access", async () => {
  const ui = await harness();
  assert.equal(ui.get("order-table-wrap").hidden, true);
  assert.match(ui.get("list-message").textContent, /No order requests yet/);
  ui.respondOrders(async () => Response.json(orderListing([sampleOrder])));
  await ui.emit("refresh-orders");
  let finish;
  ui.respondOrders(() => new Promise(resolve => { finish = resolve; }));
  const pending = ui.emit("refresh-orders");
  assert.equal(ui.get("order-table-wrap").hidden, true);
  assert.equal(ui.get("order-list").children.length, 0);
  assert.equal(ui.get("order-list").getAttribute("aria-busy"), "true");
  finish(Response.json({ error: "Synthetic order outage" }, { status: 503 }));
  await pending;
  assert.equal(ui.get("order-table-wrap").hidden, true);
  assert.equal(ui.get("order-list").getAttribute("aria-busy"), "false");
  assert.equal(ui.get("retry-orders").hidden, false);
  assert.match(ui.get("list-message").textContent, /Synthetic order outage/);
  ui.respondOrders(async () => Response.json(orderListing()));
  await ui.emit("retry-orders");
  assert.equal(ui.get("retry-orders").hidden, true);
  assert.equal(ui.get("order-table-wrap").hidden, true);
  assert.equal(ui.get("list-message").dataset.error, "false");
  ui.respondOrders(async () => Response.json(orderListing([sampleOrder])));
  await ui.emit("refresh-orders");
  ui.respondOrders(async () => Response.json({ error: "Session expired" }, { status: 401 }));
  await ui.emit("refresh-orders");
  assert.equal(ui.get("order-table-wrap").hidden, true);
  assert.equal(ui.get("order-list").children.length, 0);
  assert.equal(ui.get("dashboard").hidden, true);
  assert.match(ui.get("access-message").textContent, /Session expired/);
});

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

test("dashboard access, price lists, refresh and sign-out work without historical-import controls or requests", async () => {
  const ui = await harness();
  assert.equal(ui.get("dashboard").hidden, false);
  await ui.emit("open-prices");
  assert.equal(ui.get("price-controls").hidden, false);
  assert.equal(ui.get("open-prices").disabled, false);
  assert.equal(ui.get("sign-out").disabled, false);
  await ui.emit("close-prices");
  const listBefore = ui.requests.filter(req => req.path.startsWith("/api/vendor-orders")).length;
  await ui.emit("refresh-orders");
  assert.equal(ui.requests.filter(req => req.path.startsWith("/api/vendor-orders")).length, listBefore + 1);
  await ui.emit("sign-out");
  assert.equal(ui.get("dashboard").hidden, true);
  assert.equal(ui.requests.some(req => req.path.startsWith("/api/vendor-import")), false);
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
