import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { initializeCanvasFireworks } from "../vendor-app/canvas-fireworks.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function animationFixture({ reduced = false, contextAvailable = true } = {}) {
  const callbacks = new Map();
  const root = new EventTarget();
  const view = new EventTarget();
  const motion = Object.assign(new EventTarget(), { matches: reduced });
  const button = Object.assign(new EventTarget(), { hidden: true });
  let sequence = 0;
  let intersection;
  let resize;
  let strokes = 0;
  let clears = 0;
  const context = {
    setTransform(ratio) { assert.ok(ratio <= 1.5); },
    clearRect() { clears++; },
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() { strokes++; },
  };
  const canvas = {
    getContext: () => contextAvailable ? context : null,
    getBoundingClientRect: () => ({ width: 420, height: 340 }),
  };
  Object.assign(view, {
    devicePixelRatio: 3, matchMedia: () => motion,
    requestAnimationFrame(callback) { callbacks.set(++sequence, callback); return sequence; },
    cancelAnimationFrame(id) { callbacks.delete(id); },
    IntersectionObserver: class {
      constructor(callback) { intersection = callback; }
      observe(element) { assert.equal(element, canvas); }
    },
    ResizeObserver: class {
      constructor(callback) { resize = callback; }
      observe(element) { assert.equal(element, canvas); }
    },
  });
  Object.assign(root, {
    defaultView: view, hidden: false,
    querySelector: selector => selector === "[data-fireworks]" ? canvas : button,
  });
  initializeCanvasFireworks(root);
  return {
    root, view, motion, button, canvas, callbacks, resize: () => resize(),
    visible(value) { intersection([{ isIntersecting: value }]); },
    step(now) {
      for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(now); }
    },
    get strokes() { return strokes; }, get clears() { return clears; },
  };
}

test("canvas is hero-only, bounds its resolution, throttles frames and caps the particle budget", () => {
  const scene = animationFixture();
  assert.equal(scene.canvas.width, 630);
  assert.equal(scene.canvas.height, 510);
  assert.equal(scene.callbacks.size, 0);
  scene.visible(true);
  assert.equal(scene.callbacks.size, 1);
  scene.step(1);
  scene.step(20);
  assert.equal(scene.strokes, 0);
  scene.step(40);
  assert.equal(scene.strokes, 32);
  for (let now = 80; now < 20000; now += 40) {
    const before = scene.strokes;
    scene.step(now);
    assert.ok(scene.strokes - before <= 96);
    assert.equal(scene.callbacks.size, 1);
  }
});

test("canvas respects pause, offscreen and document visibility without losing the user's pause preference", () => {
  const scene = animationFixture();
  scene.visible(true);
  scene.button.dispatchEvent(new Event("click"));
  assert.equal(scene.callbacks.size, 0);
  assert.equal(scene.button.textContent, "Play fireworks");
  scene.visible(false);
  scene.visible(true);
  assert.equal(scene.callbacks.size, 0);
  scene.button.dispatchEvent(new Event("click"));
  assert.equal(scene.callbacks.size, 1);
  scene.visible(false);
  assert.equal(scene.callbacks.size, 0);
  scene.visible(true);
  scene.root.hidden = true;
  scene.root.dispatchEvent(new Event("visibilitychange"));
  assert.equal(scene.callbacks.size, 0);
  scene.root.hidden = false;
  scene.root.dispatchEvent(new Event("visibilitychange"));
  assert.equal(scene.callbacks.size, 1);
  scene.view.dispatchEvent(new Event("pagehide"));
  assert.equal(scene.callbacks.size, 0);
  scene.view.dispatchEvent(new Event("pageshow"));
  assert.equal(scene.callbacks.size, 1);
});

test("reduced motion runs no animation and a live preference change cancels and clears it", () => {
  const scene = animationFixture({ reduced: true });
  scene.visible(true);
  scene.resize();
  assert.equal(scene.button.hidden, true);
  assert.equal(scene.callbacks.size, 0);
  assert.equal(scene.strokes, 0);
  scene.motion.matches = false;
  scene.motion.dispatchEvent(new Event("change"));
  assert.equal(scene.callbacks.size, 1);
  scene.motion.matches = true;
  scene.motion.dispatchEvent(new Event("change"));
  assert.equal(scene.callbacks.size, 0);
  assert.equal(scene.button.hidden, true);
  assert.ok(scene.clears > 0);
});

test("canvas failure leaves the static artwork and reports the degradation", t => {
  t.mock.method(console, "warn", () => {});
  const scene = animationFixture({ contextAvailable: false });
  assert.equal(scene.callbacks.size, 0);
  assert.equal(scene.button.hidden, true);
  assert.match(console.warn.mock.calls[0].arguments[0], /static hero artwork remains visible/);
});

async function drawerFixture(hash = "", wide = false) {
  class Node extends EventTarget {
    constructor(id) { super(); this.id = id; this.attributes = {}; this.isConnected = true; }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    append(child) { child.parentElement = this; }
    contains(node) {
      for (; node; node = node.parentElement) if (node === this) return true;
      return false;
    }
    getClientRects() { return this === close && desktop.matches ? [] : [{}]; }
    closest() { return null; }
    focus() { document.activeElement = this; }
    scrollIntoView() { this.scrolled = true; }
  }
  const desktop = Object.assign(new EventTarget(), { matches: wide });
  const trigger = new Node("cart-link");
  const close = new Node("close-cart");
  const cart = new Node("requirement");
  const sidebar = new Node("cart-sidebar");
  const title = new Node("requirement-title");
  const checkout = Object.assign(new Node("checkout"), { open: false });
  const drawer = Object.assign(new Node("cart-drawer"), {
    open: false, querySelectorAll: () => [close],
    querySelector: selector => selector === "#requirement" ? cart : close,
    showModal() { this.open = true; close.focus(); },
    close() { this.open = false; this.dispatchEvent(new Event("close")); },
    getBoundingClientRect: () => ({ left: 500, right: 980, top: 0, bottom: 900 }),
  });
  drawer.append(cart);
  cart.append(close);
  cart.append(title);
  const nodes = [drawer, sidebar, title, checkout];
  const document = {
    activeElement: trigger,
    querySelector: selector => nodes.find(node => selector === `#${node.id}`) ?? null,
    querySelectorAll: () => [trigger],
  };
  const location = { hash, pathname: "/order/", search: "?source=bookmark" };
  const replacements = [];
  const window = new EventTarget();
  window.matchMedia = query => {
    assert.equal(query, "(min-width: 1024px)");
    return desktop;
  };
  const context = vm.createContext({ document, window, location, initializeCanvasFireworks() {},
    history: { state: { existing: true }, replaceState: (...args) => replacements.push(args) } });
  vm.runInContext((await read("vendor-app/modern-ui.mjs")).replace(/^import .*;\r?\n/gm, ""), context);
  return { trigger, close, drawer, cart, sidebar, title, checkout, desktop, document, location, replacements, window };
}

test("cart links open a native modal; closing restores focus and expanded state", async () => {
  const scene = await drawerFixture();
  const click = new Event("click", { cancelable: true });
  scene.trigger.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  assert.equal(scene.drawer.open, true);
  assert.equal(scene.document.activeElement, scene.close);
  assert.equal(scene.trigger.attributes["aria-controls"], "cart-drawer");
  assert.equal(scene.trigger.attributes["aria-expanded"], "true");
  scene.close.dispatchEvent(new Event("click"));
  assert.equal(scene.drawer.open, false);
  assert.equal(scene.document.activeElement, scene.trigger);
  assert.equal(scene.trigger.attributes["aria-expanded"], "false");
});

test("legacy cart bookmarks open the drawer and close without losing query strings or history state", async () => {
  const scene = await drawerFixture("#requirement");
  assert.equal(scene.drawer.open, true);
  scene.drawer.close();
  assert.equal(scene.replacements.length, 1);
  assert.deepEqual(scene.replacements[0], [{ existing: true }, "", "/order/?source=bookmark"]);
  const other = await drawerFixture("#catalogue");
  assert.equal(other.drawer.open, false);
  other.location.hash = "#requirement";
  other.window.dispatchEvent(new Event("hashchange"));
  assert.equal(other.drawer.open, true);
});

test("cart actions restore visible drawer focus when an emptied cart removes or hides the focused control", async () => {
  const scene = await drawerFixture("#requirement");
  scene.document.activeElement = scene.trigger;
  const click = new Event("click");
  Object.defineProperty(click, "target", { value: { closest: () => ({}) } });
  scene.cart.dispatchEvent(click);
  assert.equal(scene.document.activeElement, scene.close);
  assert.equal(scene.drawer.open, true);
});

test("backdrop dismissal requires a pointer press and click outside, never an inside drag", async () => {
  const scene = await drawerFixture("#requirement");
  function pointer(type, x) {
    const event = new Event(type);
    Object.defineProperties(event, { clientX: { value: x }, clientY: { value: 100 } });
    scene.drawer.dispatchEvent(event);
  }
  pointer("pointerdown", 600);
  pointer("click", 100);
  assert.equal(scene.drawer.open, true);
  pointer("pointerdown", 100);
  pointer("click", 100);
  assert.equal(scene.drawer.open, false);
});

test("desktop cart is an inline sidebar; header and bookmarked links focus it without opening a modal", async () => {
  const scene = await drawerFixture("", true);
  assert.equal(scene.cart.parentElement, scene.sidebar);
  assert.equal(scene.drawer.open, false);
  assert.equal(scene.document.activeElement, scene.trigger);
  assert.equal(scene.trigger.attributes["aria-controls"], "requirement");
  assert.equal(scene.trigger.attributes["aria-expanded"], "true");
  assert.equal(scene.trigger.attributes["aria-haspopup"], undefined);
  scene.trigger.dispatchEvent(new Event("click", { cancelable: true }));
  assert.equal(scene.drawer.open, false);
  assert.equal(scene.cart.scrolled, true);
  assert.equal(scene.document.activeElement, scene.title);
  const bookmarked = await drawerFixture("#requirement", true);
  assert.equal(bookmarked.drawer.open, false);
  assert.equal(bookmarked.document.activeElement, bookmarked.title);
});

test("resizing an open mobile cart reuses its content and retains accessible cart focus", async () => {
  const scene = await drawerFixture("#requirement");
  scene.desktop.matches = true;
  scene.desktop.dispatchEvent(new Event("change"));
  assert.equal(scene.drawer.open, false);
  assert.equal(scene.cart.parentElement, scene.sidebar);
  assert.equal(scene.document.activeElement, scene.title);
  scene.desktop.matches = false;
  scene.desktop.dispatchEvent(new Event("change"));
  assert.equal(scene.cart.parentElement, scene.drawer);
  assert.equal(scene.drawer.open, true);
  assert.equal(scene.document.activeElement, scene.title);
  assert.equal(scene.trigger.attributes["aria-haspopup"], "dialog");
  assert.equal(scene.trigger.attributes["aria-controls"], "cart-drawer");
});

test("resizing during desktop checkout keeps checkout focus and returns to a mobile cart on close", async () => {
  const scene = await drawerFixture("", true);
  scene.checkout.open = true;
  scene.checkout.focus();
  scene.desktop.matches = false;
  scene.desktop.dispatchEvent(new Event("change"));
  assert.equal(scene.drawer.open, false);
  assert.equal(scene.document.activeElement, scene.checkout);
  scene.checkout.open = false;
  scene.checkout.dispatchEvent(new Event("close"));
  assert.equal(scene.drawer.open, true);
  assert.equal(scene.document.activeElement, scene.close);
});

test("the public theme does not load on vendor pages and presentation modules do not access business state or APIs", async () => {
  for (const file of ["vendor-app/index.html", "vendor-app/order/index.html"]) {
    const html = await read(file);
    assert.match(html, /class="[^"]*\bmodern\b/);
    assert.match(html, /href="\/modern\.css"/);
    assert.match(html, /src="\/modern-ui\.mjs"/);
    assert.equal([...html.matchAll(/<canvas\b/g)].length, file === "vendor-app/index.html" ? 1 : 0);
    if (file === "vendor-app/index.html") {
      assert.doesNotMatch(html, /class="festival-ribbon"/);
    } else {
      assert.match(html, /id="shop-offers"/);
      assert.doesNotMatch(html, /15% off your cart/);
    }
  }
  assert.doesNotMatch(await read("vendor-app/vendor/index.html"), /modern\.css|modern-ui\.mjs/);
  for (const file of ["vendor-app/modern-ui.mjs", "vendor-app/canvas-fireworks.mjs"]) {
    assert.doesNotMatch(await read(file), /fetch\(|localStorage|sessionStorage|order\.mjs|catalog\.mjs|\/api\/|whatsapp/i);
  }
});

test("the vibrant palette is homepage-only while shopping inherits the original light palette", async () => {
  const home = await read("vendor-app/index.html");
  const shop = await read("vendor-app/order/index.html");
  const css = await read("vendor-app/modern.css");
  assert.match(home, /<body class="home modern">/);
  assert.match(home, /name="theme-color" content="#080D1F"/);
  assert.match(shop, /name="theme-color" content="#1e4f91"/);
  assert.doesNotMatch(shop, /<body[^>]*\bhome\b|data-fireworks|modern-fireworks\.svg/);
  assert.match(css, /\.modern\.home\s*\{\s*--paper: #080D1F;/);
  assert.doesNotMatch(css, /\.modern\s*\{\s*--paper:/);
  assert.match(css, /\.modern:not\(\.home\) dialog \{ color-scheme: light; \}/);
});
