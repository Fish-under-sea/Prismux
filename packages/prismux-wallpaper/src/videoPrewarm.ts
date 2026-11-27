/**
 * Single-slot metadata-only video prewarm queue (20s TTL, muted, no autoplay/play()).
 * Skips blob: URLs and never tears down an element already attached to the live DOM.
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
  // Never tear down an element that has already been mounted into the live DOM stage
  if (entry.el.isConnected) {
    return;
  }
  try {
    entry.el.pause();
    const startedLoading = entry.el.readyState > 0 || entry.el.networkState === 2;
    entry.el.removeAttribute("src");
    // Avoid triggering unnecessary Chromium D3D11 decoder teardown/re-init if nothing started buffering
    if (startedLoading) {
      entry.el.load();
    }
  } catch {
    // Ignore detached DOM errors
  }
}

export function prewarmVideo(url: string | null | undefined): void {
  const normalized = typeof url === "string" ? url.trim() : "";
  if (
    !normalized ||
    /^blob:/i.test(normalized) ||
    typeof document === "undefined" ||
    typeof document.createElement !== "function"
  ) {
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
  // Discard broken/errored elements so Stage always starts from a clean <video>
  if (entry.el.error !== null || (entry.el.readyState === 0 && entry.el.networkState === 3)) {
    try {
      entry.el.pause();
      entry.el.removeAttribute("src");
    } catch {
      // Ignore detached DOM errors
    }
    return null;
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
