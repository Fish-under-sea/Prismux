/**
 * Single-slot metadata-only video prewarm queue (ported from dsh-wallpaper-engine video-layer.js).
 *
 * Invariants:
 *   1. Never calls `play()` or enables `autoplay` — prewarm warms only moov/demuxer metadata
 *      (`preload = "metadata"`, muted) without spinning up a second hardware video decoder.
 *   2. Idempotent for the same URL.
 *   3. Single slot + 20s TTL: switching candidate disposes the previous element cleanly.
 */

const VIDEO_WARM_TTL_MS = 20_000;
const VIDEO_WARM_HOVER_MS = 120;

interface WarmVideoEntry {
  url: string;
  el: HTMLVideoElement;
  timer: ReturnType<typeof setTimeout> | null;
}

let warmEntry: WarmVideoEntry | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

export function disposePrewarmedVideo(): void {
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  const entry = warmEntry;
  warmEntry = null;
  if (!entry) return;
  if (entry.timer !== null) {
    clearTimeout(entry.timer);
  }
  try {
    entry.el.pause();
    entry.el.removeAttribute("src");
    entry.el.load();
  } catch {
    // Ignore detached DOM errors
  }
}

export function prewarmVideo(url: string | null | undefined): void {
  const normalized = typeof url === "string" ? url.trim() : "";
  if (!normalized || typeof document === "undefined" || typeof document.createElement !== "function") {
    return;
  }
  if (warmEntry && warmEntry.url === normalized) {
    return;
  }
  disposePrewarmedVideo();

  let el: HTMLVideoElement;
  try {
    el = document.createElement("video");
  } catch {
    return;
  }

  try {
    el.preload = "metadata";
    el.muted = true;
    el.loop = true;
    el.autoplay = false;
    el.playsInline = true;
    el.setAttribute("playsinline", "");
    el.src = normalized;
  } catch {
    return;
  }

  const timer = setTimeout(() => {
    if (warmEntry && warmEntry.el === el) {
      disposePrewarmedVideo();
    }
  }, VIDEO_WARM_TTL_MS);

  warmEntry = { url: normalized, el, timer };
}

export function consumePrewarmedVideo(url: string | null | undefined): HTMLVideoElement | null {
  const normalized = typeof url === "string" ? url.trim() : "";
  if (!normalized || !warmEntry || warmEntry.url !== normalized) {
    return null;
  }
  const entry = warmEntry;
  warmEntry = null;
  if (entry.timer !== null) {
    clearTimeout(entry.timer);
  }
  return entry.el;
}

export function schedulePrewarmVideo(url: string | null | undefined, immediate = false): void {
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  const normalized = typeof url === "string" ? url.trim() : "";
  if (!normalized) return;
  if (immediate) {
    prewarmVideo(normalized);
    return;
  }
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    prewarmVideo(normalized);
  }, VIDEO_WARM_HOVER_MS);
}

export function getPrewarmedVideoUrl(): string | null {
  return warmEntry ? warmEntry.url : null;
}
