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
  feedback.textContent = "";
  for (const coupon of offers.coupons.filter(isPublicCoupon)) {
    const card = make("li", "", "offer-card offer-coupon");
    const label = make("span", "", "offer-card-copy");
    label.append(make("strong", `${coupon.percent}% off`), make("span", `Use code ${coupon.code}`));
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
  delivery.append(make("strong", "Free delivery"),
    make("span", conditional ? `From ${money(freeDeliveryMinimum)} after coupon discount` : "On all billed amounts"),
    make("p", `${conditional ? `Below this: ${money(deliveryFee)} delivery. ` : ""}Pickup is free. Delivery area and timing must be confirmed by the shop.`));
  list.replaceChildren(...cards.slice(0, 1), delivery, ...cards.slice(1));
}

export function initializeOfferCarousel(list, toggle) {
  const document = list.ownerDocument;
  const view = document.defaultView;
  if (typeof view.IntersectionObserver !== "function" || typeof view.ResizeObserver !== "function") {
    toggle.hidden = true;
    console.warn("Automatic offer scrolling is unavailable. Offers can still be scrolled manually.");
    return () => {};
  }
  const motion = view.matchMedia("(prefers-reduced-motion: reduce)");
  let paused = false;
  let hovered = false;
  let focused = false;
  let visible = false;
  let timer = null;
  function stop() {
    if (timer !== null) {
      view.clearInterval(timer);
      timer = null;
      list.scrollTo({ left: list.scrollLeft, behavior: "instant" });
    }
  }
  function update() {
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
  list.addEventListener("focusin", () => { focused = true; update(); });
  list.addEventListener("focusout", event => { focused = list.contains(event.relatedTarget); update(); });
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
