export function initializeFireworks(root = document) {
  const video = root.querySelector("#hero-fireworks");
  const button = root.querySelector("#fireworks-toggle");
  const frame = video.parentElement;
  const motion = root.defaultView.matchMedia("(prefers-reduced-motion: reduce)");
  let visible = false;
  let attempted = false;
  let playRequest = 0;
  let warned = false;

  function showStill() {
    frame.classList.remove("is-playing");
    button.textContent = video.ended ? "Replay fireworks" : "Play fireworks";
  }

  function stop() {
    playRequest++;
    video.pause();
    showStill();
  }

  function reportFailure() {
    stop();
    if (!warned) {
      console.warn("Header fireworks could not play. The still image and Play button remain available.");
      warned = true;
    }
  }

  async function play() {
    if (motion.matches || root.hidden || !visible) return;
    const request = ++playRequest;
    attempted = true;
    warned = false;
    video.muted = true;
    if (!video.hasAttribute("src")) video.src = video.dataset.src;
    if (video.error) video.load();
    if (video.ended) video.currentTime = 0;
    try {
      await video.play();
      if (request !== playRequest) return;
      if (motion.matches || root.hidden || !visible) stop();
    } catch {
      if (request === playRequest) reportFailure();
    }
  }

  function autoPlay() {
    if (!attempted) void play();
  }

  function updateMotion() {
    button.hidden = motion.matches;
    if (motion.matches) {
      stop();
      if (video.hasAttribute("src")) {
        video.removeAttribute("src");
        video.load();
      }
    } else {
      autoPlay();
    }
  }

  video.addEventListener("playing", () => {
    if (motion.matches || root.hidden || !visible) {
      stop();
      return;
    }
    frame.classList.add("is-playing");
    button.textContent = "Pause fireworks";
  });
  video.addEventListener("pause", showStill);
  video.addEventListener("ended", showStill);
  video.addEventListener("error", reportFailure);
  button.addEventListener("click", () => {
    if (video.paused) void play();
    else stop();
  });
  root.addEventListener("visibilitychange", () => {
    if (root.hidden) stop();
    else autoPlay();
  });
  motion.addEventListener("change", updateMotion);
  const observer = new root.defaultView.IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.35);
    if (visible) autoPlay();
    else stop();
  }, { threshold: 0.35 });
  updateMotion();
  observer.observe(frame);
}
