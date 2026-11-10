import { initializeCanvasFireworks } from "./canvas-fireworks.mjs";

initializeCanvasFireworks();

const header = document.querySelector(".site-header");
if (header && typeof ResizeObserver === "function") {
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--modern-header-height", `${header.offsetHeight}px`);
  }).observe(header);
}

const drawer = document.querySelector("#cart-drawer");
if (drawer) {
  const triggers = [...document.querySelectorAll('a[href="#requirement"]')];
  let returnTo = null;
  for (const trigger of triggers) {
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", drawer.id);
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("click", event => {
      event.preventDefault();
      openCart(trigger);
    });
  }
  function openCart(trigger = document.activeElement) {
    if (drawer.open) return;
    returnTo = trigger;
    drawer.showModal();
    for (const link of triggers) link.setAttribute("aria-expanded", "true");
  }
  for (const button of drawer.querySelectorAll("[data-close-cart]")) {
    button.addEventListener("click", () => drawer.close());
  }
  let backdropPress = false;
  function outside(event) {
    const box = drawer.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right ||
      event.clientY < box.top || event.clientY > box.bottom;
  }
  drawer.addEventListener("pointerdown", event => { backdropPress = event.target === drawer && outside(event); });
  drawer.addEventListener("click", event => {
    if (backdropPress && event.target === drawer && outside(event)) drawer.close();
    backdropPress = false;
    if (drawer.open && event.target.closest("#clear-cart, #clear-cart-top, button[data-direction]")) {
      const active = document.activeElement;
      if (!drawer.contains(active) || !active.getClientRects().length) {
        drawer.querySelector("[data-close-cart]")?.focus({ preventScroll: true });
      }
    }
  });
  drawer.addEventListener("close", () => {
    for (const link of triggers) link.setAttribute("aria-expanded", "false");
    if (location.hash === "#requirement") history.replaceState(history.state, "", `${location.pathname}${location.search}`);
    const target = returnTo?.isConnected && returnTo.getClientRects().length ? returnTo : triggers[0];
    target?.focus({ preventScroll: true });
  });
  function restoreCartBookmark() {
    if (location.hash === "#requirement") openCart();
  }
  window.addEventListener("hashchange", restoreCartBookmark);
  restoreCartBookmark();
}
