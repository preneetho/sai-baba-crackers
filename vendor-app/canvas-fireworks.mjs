const COLOURS = ["#8B5CF6", "#FF6B35", "#FFC857"];
const MAX_PARTICLES = 96;
const FRAME_INTERVAL = 1000 / 30;

export function initializeCanvasFireworks(root = document) {
  const canvas = root.querySelector("[data-fireworks]");
  const button = root.querySelector("[data-fireworks-toggle]");
  if (!canvas || !button) return;
  const view = root.defaultView;
  if (typeof view.IntersectionObserver !== "function" || typeof view.ResizeObserver !== "function") {
    console.warn("Canvas observers are unavailable. The static hero artwork remains visible.");
    return;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    console.warn("Canvas fireworks are unavailable. The static hero artwork remains visible.");
    return;
  }
  const motion = view.matchMedia("(prefers-reduced-motion: reduce)");
  let paused = false;
  let suspended = false;
  let visible = false;
  let frame = null;
  let previous = 0;
  let elapsed = 0;
  let nextBurst = 0;
  let width = 0;
  let height = 0;
  let particles = [];

  function resize() {
    const box = canvas.getBoundingClientRect();
    width = box.width;
    height = box.height;
    const ratio = Math.min(view.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    particles = [];
  }
  function burst() {
    if (!width || !height) return;
    const x = width * (.2 + Math.random() * .6);
    const y = height * (.2 + Math.random() * .4);
    const colour = COLOURS[Math.floor(Math.random() * COLOURS.length)];
    for (let index = 0; index < 32 && particles.length < MAX_PARTICLES; index++) {
      const angle = index * Math.PI * 2 / 32;
      const speed = 26 + Math.random() * 48;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        age: 0, lifetime: 1.8 + Math.random() * .6, colour });
    }
  }
  function draw(now) {
    if (frame === null) return;
    frame = view.requestAnimationFrame(draw);
    if (!previous) { previous = now; return; }
    if (now - previous < FRAME_INTERVAL) return;
    const delta = Math.min((now - previous) / 1000, .1);
    previous = now;
    elapsed += delta;
    if (elapsed >= nextBurst) {
      burst();
      nextBurst = elapsed + 1.5;
    }
    context.clearRect(0, 0, width, height);
    for (const particle of particles) {
      particle.age += delta;
      particle.vy += 14 * delta;
      const oldX = particle.x;
      const oldY = particle.y;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      context.globalAlpha = Math.max(0, 1 - particle.age / particle.lifetime) * .8;
      context.strokeStyle = particle.colour;
      context.lineWidth = 1.8;
      context.beginPath();
      context.moveTo(oldX, oldY);
      context.lineTo(particle.x, particle.y);
      context.stroke();
    }
    context.globalAlpha = 1;
    particles = particles.filter(particle => particle.age < particle.lifetime);
  }
  function update() {
    button.hidden = motion.matches;
    button.textContent = paused ? "Play fireworks" : "Pause fireworks";
    if (!paused && !suspended && !motion.matches && !root.hidden && visible && width && height) {
      if (frame === null) {
        previous = 0;
        frame = view.requestAnimationFrame(draw);
      }
    } else {
      if (frame !== null) view.cancelAnimationFrame(frame);
      frame = null;
      previous = 0;
      particles = [];
      context.clearRect(0, 0, width, height);
    }
  }
  button.addEventListener("click", () => { paused = !paused; update(); });
  motion.addEventListener("change", update);
  root.addEventListener("visibilitychange", update);
  view.addEventListener("pagehide", () => { suspended = true; update(); });
  view.addEventListener("pageshow", () => { suspended = false; update(); });
  new view.IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    update();
  }).observe(canvas);
  new view.ResizeObserver(() => { resize(); update(); }).observe(canvas);
  resize();
  update();
}
