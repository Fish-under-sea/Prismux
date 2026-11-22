import { useEffect, useRef, useState } from "react";
import type { AppearanceThemeMode, WallpaperSettings } from "@prismux/protocol";
import { WebWallGLCanvas } from "../wallpaper/WebWallGLCanvas.js";

export interface WallpaperViewportProps {
  wallpaper: WallpaperSettings;
  occluded: boolean;
  audioBands: number[];
  themeMode: AppearanceThemeMode;
}

export function WallpaperViewport({
  wallpaper,
  occluded,
  audioBands,
  themeMode
}: WallpaperViewportProps) {
  const [documentHidden, setDocumentHidden] = useState<boolean>(() =>
    typeof document !== "undefined" ? Boolean(document.hidden) : false
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const handleVisibility = (): void => {
      setDocumentHidden(Boolean(document.hidden));
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const isPaused = occluded || (wallpaper.pauseWhenOccluded && documentHidden);
  const activeFps =
    isPaused || wallpaper.sourceType === "none"
      ? 0
      : Math.max(1, Math.round(wallpaper.fpsLimit || 60));

  useEffect(() => {
    const video = videoRef.current;
    if (!video || wallpaper.sourceType !== "video") {
      return;
    }
    if (isPaused) {
      video.pause();
    } else {
      void video.play().catch(() => {
        // Ignore autoplay promise rejection when muted media isn't ready
      });
    }
  }, [isPaused, wallpaper.sourceType, wallpaper.sourcePath]);

  const vignetteAlpha = Math.min(1, Math.max(0, wallpaper.vignetteStrength));
  const vignetteColor =
    themeMode === "light"
      ? `rgba(226, 232, 240, ${(vignetteAlpha * 0.65).toFixed(3)})`
      : `rgba(10, 15, 26, ${(vignetteAlpha * 0.82).toFixed(3)})`;

  const hasSafeWebUrl =
    typeof wallpaper.sourcePath === "string" &&
    (wallpaper.sourcePath.startsWith("https://") ||
      wallpaper.sourcePath.startsWith("http://"));

  const spectrumBars = Array.from({ length: 20 }, (_, i) => {
    const raw =
      audioBands.length > 0
        ? (audioBands[i % audioBands.length] ?? 0)
        : 0;
    return Math.min(1, Math.max(0.06, raw));
  });

  return (
    <div
      className="prismux-wallpaper-viewport"
      data-prismux-wallpaper-viewport="true"
      data-wallpaper-paused={isPaused ? "1" : "0"}
      data-current-fps={String(activeFps)}
      aria-hidden="true"
    >
      <div className="prismux-wallpaper-media">
        {wallpaper.sourceType === "scene" && (
          <WebWallGLCanvas
            sceneId={wallpaper.sourcePath}
            themeMode={themeMode}
            paused={isPaused}
            fpsLimit={wallpaper.fpsLimit}
            audioReactive={wallpaper.audioReactive}
            audioBands={audioBands}
          />
        )}

        {wallpaper.sourceType === "video" && wallpaper.sourcePath ? (
          <video
            ref={videoRef}
            src={wallpaper.sourcePath}
            muted
            loop
            playsInline
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block"
            }}
          />
        ) : wallpaper.sourceType === "video" ? (
          <WebWallGLCanvas
            sceneId="starlight-fluid"
            themeMode={themeMode}
            paused={isPaused}
            fpsLimit={wallpaper.fpsLimit}
            audioReactive={wallpaper.audioReactive}
            audioBands={audioBands}
          />
        ) : null}

        {wallpaper.sourceType === "web" && hasSafeWebUrl ? (
          <iframe
            title="Prismux Web Wallpaper"
            src={wallpaper.sourcePath}
            sandbox="allow-scripts"
            style={{
              width: "100%",
              height: "100%",
              border: 0,
              pointerEvents: "none"
            }}
          />
        ) : wallpaper.sourceType === "web" ? (
          <WebWallGLCanvas
            sceneId="prism-mesh"
            themeMode={themeMode}
            paused={isPaused}
            fpsLimit={wallpaper.fpsLimit}
            audioReactive={wallpaper.audioReactive}
            audioBands={audioBands}
          />
        ) : null}

        {wallpaper.sourceType === "image" && wallpaper.sourcePath ? (
          <img
            src={wallpaper.sourcePath}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block"
            }}
          />
        ) : wallpaper.sourceType === "image" ? (
          <WebWallGLCanvas
            sceneId="aurora-prism"
            themeMode={themeMode}
            paused={isPaused}
            fpsLimit={wallpaper.fpsLimit}
            audioReactive={wallpaper.audioReactive}
            audioBands={audioBands}
          />
        ) : null}
      </div>

      {/* Contrast Veil (--wall-veil) */}
      <div className="prismux-wallpaper-veil" />

      {/* Radial Edge Vignette (never #000) */}
      <div
        className="prismux-wallpaper-vignette"
        style={{
          background: `radial-gradient(circle at 50% 45%, transparent 48%, ${vignetteColor} 100%)`
        }}
      />

      {/* Z-1 System Audio FFT Reactive Spectrum Hairline (0 Token Cost) */}
      {wallpaper.audioReactive &&
        !isPaused &&
        wallpaper.sourceType !== "none" && (
          <div className="prismux-audio-spectrum">
            {spectrumBars.map((level, idx) => (
              <span
                key={idx}
                className="prismux-audio-bar"
                style={{ height: `${Math.round(level * 24)}px` }}
              />
            ))}
          </div>
        )}
    </div>
  );
}
