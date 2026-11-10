import "./auth-callback.mjs";
import "./homepage-video.mjs";

const catalogueAnchors = new Set(["#catalogue", "#requirement", "#products", "#search", "#checkout"]);
function restoreCatalogueBookmark() {
  if ((location.pathname === "/" || location.pathname === "/index.html") && catalogueAnchors.has(location.hash)) {
    location.replace(`/order/${location.search}${location.hash}`);
  }
}
restoreCatalogueBookmark();
window.addEventListener("hashchange", restoreCatalogueBookmark);
