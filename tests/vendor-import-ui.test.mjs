import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { ORDER_STATUSES, PAGE_SIZE, validOrder, validImportSummary } from "../vendor-app/vendor-model.mjs";

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
      dataset: {}, files: [], events: new Map(),
      addEventListener(type, callback) { this.events.set(type, callback); },
      append() {}, replaceChildren() {}, setAttribute() {}, close() {}, showModal() {},
    });
    return nodes.get(id);
  };
  const requests = [];
  let respondImport = async () => new Response(JSON.stringify({
    ...result, previewed: true, rolledBack: true, receipt: "signed.preview",
  }));
  const context = vm.createContext({
    ORDER_STATUSES, PAGE_SIZE, validOrder, validImportSummary,
    AbortController, AbortSignal, URL, URLSearchParams, Intl, console,
    document: { getElementById: get, createElement: () => get(Symbol()) },
    window: { addEventListener() {} }, history: { replaceState() {} },
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
      throw new Error("Unexpected test route");
    },
  });
  const source = await readFile(new URL("../vendor-app/vendor.mjs", import.meta.url), "utf8");
  vm.runInContext(source.replace(/^import .*;\r?\n/, ""), context);
  await tick();
  const emit = async (id, type = "click") => {
    await get(id).events.get(type)({ preventDefault() {} });
    await tick();
  };
  return {
    get, requests, emit, context,
    respond(callback) { respondImport = callback; },
    async choose() {
      await emit("open-import");
      get("import-file").files = [{ name: "approved.sql", size: 16, text: async () => "approved-fixture" }];
      await emit("import-file", "change");
    },
  };
}

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
