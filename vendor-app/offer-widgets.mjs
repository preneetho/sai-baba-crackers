import { isPublicCoupon } from "./offers-model.mjs";
import { money } from "./order.mjs";

export function renderOfferWidgets(list, offers, feedback) {
  const document = list.ownerDocument;
  const make = (tag, text, className = "") => {
    const node = document.createElement(tag);
    node.textContent = text;
    node.className = className;
    return node;
  };
  const cards = [];
  const heading = (text, icon) => {
    const title = make("strong", "");
    const symbol = make("span", icon, "offer-card-icon");
    symbol.setAttribute("aria-hidden", "true");
    title.append(symbol, make("span", text));
    return title;
  };
  feedback.textContent = "";
  for (const coupon of offers.coupons.filter(isPublicCoupon)) {
    const card = make("li", "", "offer-card offer-coupon");
    const label = make("span", "", "offer-card-copy");
    label.append(heading(`${coupon.percent}% off`, "\u{1F39F}\uFE0F"), make("span", `Use code ${coupon.code}`));
    const copy = make("button", "Copy code", "button secondary");
    copy.type = "button";
    copy.setAttribute("aria-label", `Copy coupon ${coupon.code}`);
    copy.addEventListener("click", async () => {
      copy.disabled = true;
      try {
        const clipboard = document.defaultView.navigator.clipboard;
        if (!clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
        await clipboard.writeText(coupon.code);
        copy.textContent = "Copied";
        feedback.textContent = `${coupon.code} copied. Paste it into the coupon field in your cart.`;
      } catch {
        copy.textContent = "Copy code";
        feedback.textContent = `Could not copy automatically. Select and copy ${coupon.code} above.`;
      } finally { copy.disabled = false; }
    });
    card.append(label, copy);
    cards.push(card);
  }
  const { freeDeliveryMinimum, deliveryFee } = offers;
  const conditional = freeDeliveryMinimum > 0 && deliveryFee > 0;
  const delivery = make("li", "", "offer-card offer-delivery");
  delivery.append(heading("Free delivery", "\u{1F69A}"),
    make("span", conditional ? `From ${money(freeDeliveryMinimum)} after coupon discount` : "On all billed amounts"),
    make("p", `${conditional ? `Below this: ${money(deliveryFee)} delivery. ` : ""}Pickup is free. Hyderabad-wide; same-day delivery is best-effort, subject to availability and shop confirmation.`));
  list.replaceChildren(...cards.slice(0, 1), delivery, ...cards.slice(1));
}

export function initializeOfferCarousel(list, toggle, pagination) {
  const document = list.ownerDocument;
  const view = document.defaultView;
  if (typeof view.IntersectionObserver !== "function" || typeof view.ResizeObserver !== "function") {
    toggle.hidden = true;
    pagination.hidden = true;
    console.warn("Automatic offer scrolling is unavailable. Offers can still be scrolled manually.");
    return () => {};
  }
  const motion = view.matchMedia("(prefers-reduced-motion: reduce)");
  let paused = false;
  let hovered = false;
  let focused = false;
  let visible = false;
  let timer = null;
  let positions = [];
  let dots = [];
  function showCurrentPage() {
    let current = 0;
    for (let index = 1; index < positions.length; index++) {
      if (Math.abs(list.scrollLeft - positions[index]) < Math.abs(list.scrollLeft - positions[current])) current = index;
    }
    dots.forEach((dot, index) => dot.setAttribute("aria-current", String(index === current)));
  }
  function updatePages() {
    const maximum = Math.max(0, list.scrollWidth - list.clientWidth);
    const step = list.firstElementChild ?
      list.firstElementChild.getBoundingClientRect().width + parseFloat(view.getComputedStyle(list).columnGap) : 0;
    positions = [...new Set(Array.from(list.children, (_, index) => Math.min(maximum, index * step)))];
    if (dots.length !== positions.length) {
      const focused = dots.indexOf(document.activeElement);
      dots = positions.map((_, index) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "offer-dot";
        dot.setAttribute("aria-label", `Show offers page ${index + 1} of ${positions.length}`);
        dot.setAttribute("aria-controls", list.id);
        dot.addEventListener("click", () => {
          list.scrollTo({ left: positions[index], behavior: motion.matches ? "instant" : "smooth" });
        });
        return dot;
      });
      pagination.replaceChildren(...dots);
      if (focused !== -1) (dots[Math.min(focused, dots.length - 1)] ?? list).focus({ preventScroll: true });
    }
    pagination.hidden = positions.length < 2;
    showCurrentPage();
  }
  function stop() {
    if (timer !== null) {
      view.clearInterval(timer);
      timer = null;
      list.scrollTo({ left: list.scrollLeft, behavior: "instant" });
    }
  }
  function update() {
    updatePages();
    const overflowing = list.scrollWidth > list.clientWidth + 1;
    toggle.hidden = motion.matches || !overflowing;
    toggle.textContent = paused ? "Resume offers" : "Pause offers";
    if (paused || hovered || focused || !visible || document.hidden || motion.matches || !overflowing) {
      stop();
    } else if (timer === null) {
      timer = view.setInterval(() => {
        const maximum = list.scrollWidth - list.clientWidth;
        const step = list.firstElementChild.getBoundingClientRect().width + parseFloat(view.getComputedStyle(list).columnGap);
        list.scrollTo({ left: list.scrollLeft >= maximum - 2 ? 0 : Math.min(maximum, list.scrollLeft + step),
          behavior: "smooth" });
      }, 4500);
    }
  }
  toggle.addEventListener("click", () => { paused = !paused; update(); });
  list.parentElement.addEventListener("pointerenter", () => { hovered = true; update(); });
  list.parentElement.addEventListener("pointerleave", () => { hovered = false; update(); });
  for (const region of [list, pagination]) {
    region.addEventListener("focusin", () => { focused = true; update(); });
    region.addEventListener("focusout", event => {
      focused = list.contains(event.relatedTarget) || pagination.contains(event.relatedTarget);
      update();
    });
  }
  list.addEventListener("scroll", showCurrentPage, { passive: true });
  motion.addEventListener("change", update);
  document.addEventListener("visibilitychange", update);
  view.addEventListener("pagehide", stop);
  view.addEventListener("pageshow", update);
  const observer = new view.IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    update();
  });
  observer.observe(list);
  new view.ResizeObserver(update).observe(list);
  update();
  return update;
}
