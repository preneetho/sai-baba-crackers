import { validHomepageVideo, homepageVideoUrl } from "./homepage-model.mjs";

const section = document.getElementById("shop-video");
const player = document.getElementById("home-video-player");
const link = document.getElementById("home-video-link");
const status = document.getElementById("home-video-status");
const message = document.getElementById("home-video-message");
const retry = document.getElementById("retry-home-video");

async function loadHomepageVideo() {
  section.hidden = true;
  player.removeAttribute("src");
  link.removeAttribute("href");
  status.hidden = false;
  retry.hidden = true;
  retry.disabled = true;
  message.textContent = "Loading shop video...";
  try {
    const response = await fetch("/api/homepage", { cache: "no-store", signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok || !validHomepageVideo(result.video)) throw new Error("The shop video settings could not be verified.");
    if (result.video.videoId !== null) {
      link.href = homepageVideoUrl(result.video);
      player.src = `https://www.youtube-nocookie.com/embed/${result.video.videoId}?rel=0`;
      section.hidden = false;
    }
    status.hidden = true;
    message.textContent = "";
  } catch {
    message.textContent = "The shop video could not be loaded. Retry or contact the shop.";
    retry.hidden = false;
  } finally {
    retry.disabled = false;
  }
}

retry.addEventListener("click", loadHomepageVideo);
loadHomepageVideo();
