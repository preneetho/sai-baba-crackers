import { test } from "node:test";
import assert from "node:assert/strict";
import { initializeOfferCarousel } from "../vendor-app/offer-widgets.mjs";

function carousel({ reduced = false, overflow = true } = {}) {
  const document = new EventTarget();
  document.hidden = false;
  const motion = new EventTarget();
  motion.matches = reduced;
  const timers = new Map();
  let intersection;
  let resize;
  let nextTimer = 0;
  const view = new EventTarget();
  Object.assign(view, {
    matchMedia: () => motion,
    setInterval(callback, delay) {
      assert.equal(delay, 4500);
      timers.set(++nextTimer, callback);
      return nextTimer;
    },
    clearInterval: id => timers.delete(id),
    getComputedStyle: () => ({ columnGap: "12px" }),
    IntersectionObserver: class {
      constructor(callback) { intersection = callback; }
      observe() {}
    },
    ResizeObserver: class {
      constructor(callback) { resize = callback; }
      observe() {}
    },
  });
  document.defaultView = view;
  const list = new EventTarget();
  const scrolls = [];
  Object.assign(list, {
    ownerDocument: document, parentElement: new EventTarget(),
    scrollWidth: overflow ? 550 : 200, clientWidth: 200, scrollLeft: 0,
    firstElementChild: { getBoundingClientRect: () => ({ width: 100 }) },
    contains: node => node === list.firstElementChild,
    scrollTo(options) { this.scrollLeft = options.left; scrolls.push(options); },
  });
  const toggle = new EventTarget();
  initializeOfferCarousel(list, toggle);
  return {
    list, toggle, document, motion, view, timers, scrolls,
    visible: value => intersection([{ isIntersecting: value }]),
    resize: () => resize(),
    tick: () => { for (const callback of [...timers.values()]) callback(); },
    emit(target, type, relatedTarget = null) {
      const event = new Event(type);
      Object.defineProperty(event, "relatedTarget", { value: relatedTarget });
      target.dispatchEvent(event);
    },
  };
}

test("offer widgets advance one card at a time, wrap without cloned cards and stop when everything fits", () => {
  const scene = carousel();
  assert.equal(scene.timers.size, 0, "Offscreen offers must not move");
  scene.visible(true);
  assert.equal(scene.timers.size, 1);
  for (const left of [112, 224, 336, 350, 0]) {
    scene.tick();
    assert.equal(scene.list.scrollLeft, left);
    assert.equal(scene.scrolls.at(-1).behavior, "smooth");
  }
  scene.list.scrollWidth = scene.list.clientWidth;
  scene.resize();
  assert.equal(scene.timers.size, 0);
  assert.equal(scene.toggle.hidden, true);
  const count = scene.scrolls.length;
  scene.tick();
  assert.equal(scene.scrolls.length, count);
});

test("offer widgets pause for hover, focus, hidden tabs and offscreen content; explicit Pause persists until Resume", () => {
  const scene = carousel();
  scene.visible(true);
  for (const [target, start, end] of [
    [scene.list.parentElement, "pointerenter", "pointerleave"],
    [scene.list, "focusin", "focusout"],
    [scene.view, "pagehide", "pageshow"],
  ]) {
    scene.emit(target, start);
    assert.equal(scene.timers.size, 0);
    assert.equal(scene.scrolls.at(-1).behavior, "instant", "Cancel any in-progress automatic movement");
    if (start === "focusin") {
      scene.emit(target, "focusout", scene.list.firstElementChild);
      assert.equal(scene.timers.size, 0, "Moving between card controls must not resume scrolling");
    }
    scene.emit(target, end);
    assert.equal(scene.timers.size, 1);
  }
  scene.document.hidden = true;
  scene.emit(scene.document, "visibilitychange");
  assert.equal(scene.timers.size, 0);
  scene.document.hidden = false;
  scene.emit(scene.document, "visibilitychange");
  assert.equal(scene.timers.size, 1);
  scene.visible(false);
  assert.equal(scene.timers.size, 0);
  scene.visible(true);
  scene.emit(scene.toggle, "click");
  assert.equal(scene.toggle.textContent, "Resume offers");
  scene.emit(scene.list.parentElement, "pointerenter");
  scene.emit(scene.list.parentElement, "pointerleave");
  scene.visible(false);
  scene.visible(true);
  assert.equal(scene.timers.size, 0);
  scene.emit(scene.toggle, "click");
  assert.equal(scene.toggle.textContent, "Pause offers");
  assert.equal(scene.timers.size, 1);
});

test("reduced motion prevents automatic scrolling, including preference changes, without blocking manual scrolling", () => {
  const scene = carousel({ reduced: true });
  scene.visible(true);
  assert.equal(scene.timers.size, 0);
  assert.equal(scene.toggle.hidden, true);
  scene.list.scrollTo({ left: 112, behavior: "instant" });
  scene.tick();
  assert.equal(scene.list.scrollLeft, 112);
  scene.motion.matches = false;
  scene.emit(scene.motion, "change");
  assert.equal(scene.toggle.hidden, false);
  scene.tick();
  assert.equal(scene.list.scrollLeft, 224);
  scene.motion.matches = true;
  scene.emit(scene.motion, "change");
  assert.equal(scene.timers.size, 0);
  assert.equal(scene.toggle.hidden, true);
  scene.tick();
  assert.equal(scene.list.scrollLeft, 224);
});

test("missing observers leave offers manually scrollable rather than stopping the storefront script", () => {
  const list = { ownerDocument: { defaultView: {} }, scrollLeft: 0 };
  const toggle = {};
  const update = initializeOfferCarousel(list, toggle);
  assert.equal(toggle.hidden, true);
  assert.doesNotThrow(update);
});
