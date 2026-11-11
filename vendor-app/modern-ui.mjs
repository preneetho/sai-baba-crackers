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
  const cart = drawer.querySelector("#requirement");
  const sidebar = document.querySelector("#cart-sidebar");
  const title = document.querySelector("#requirement-title");
  const desktop = window.matchMedia("(min-width: 1024px)");
  const triggers = [...document.querySelectorAll('a[href="#requirement"]')];
  let returnTo = null;
  let skipCloseFocus = false;
  function updateTriggers() {
    for (const link of triggers) {
      if (desktop.matches) link.removeAttribute("aria-haspopup");
      else link.setAttribute("aria-haspopup", "dialog");
      link.setAttribute("aria-controls", desktop.matches ? cart.id : drawer.id);
      link.setAttribute("aria-expanded", String(desktop.matches || drawer.open));
    }
  }
  for (const trigger of triggers) {
    trigger.addEventListener("click", event => {
      event.preventDefault();
      openCart(trigger);
    });
  }
  function openCart(trigger = document.activeElement) {
    if (desktop.matches) {
      cart.scrollIntoView({ block: "nearest" });
      title.focus({ preventScroll: true });
      return;
    }
    if (drawer.open) return;
    returnTo = trigger;
    drawer.showModal();
    updateTriggers();
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
  });
  cart.addEventListener("click", event => {
    if (drawer.open && event.target.closest("#clear-cart, #clear-cart-top, button[data-direction]")) {
      const active = document.activeElement;
      if (!drawer.contains(active) || !active.getClientRects().length) {
        drawer.querySelector("[data-close-cart]")?.focus({ preventScroll: true });
      }
    }
  });
  drawer.addEventListener("close", () => {
    updateTriggers();
    if (skipCloseFocus) { skipCloseFocus = false; return; }
    if (location.hash === "#requirement") history.replaceState(history.state, "", `${location.pathname}${location.search}`);
    const target = returnTo?.isConnected && returnTo.getClientRects().length ? returnTo : triggers[0];
    target?.focus({ preventScroll: true });
  });
  function updateLayout() {
    const active = document.activeElement;
    const hadCartFocus = cart.contains(active);
    if (desktop.matches && drawer.open) {
      skipCloseFocus = true;
      drawer.close();
    }
    const destination = desktop.matches ? sidebar : drawer;
    if (cart.parentElement !== destination) destination.append(cart);
    updateTriggers();
    if (hadCartFocus) {
      if (!desktop.matches) openCart(triggers[0]);
      const target = active.getClientRects().length ? active : title;
      target.focus({ preventScroll: true });
    }
  }
  desktop.addEventListener("change", updateLayout);
  updateLayout();
  document.querySelector("#checkout")?.addEventListener("close", () => {
    if (!desktop.matches && !drawer.open) openCart(triggers[0]);
  });
  function restoreCartBookmark() {
    if (location.hash === "#requirement") openCart();
  }
  window.addEventListener("hashchange", restoreCartBookmark);
  restoreCartBookmark();
}
