import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ChevronRightIcon, ImageIcon } from "lucide-react";
import {
  FloatingColorPopover,
  LiquidGlassCard,
  SidebarCornersCard,
  ThemeHeroCard,
  ThemePaletteCard,
  ThemeSnapshotActions,
  TypographyCard,
  type ActiveColorPickerSlot,
  type AppearanceConfig,
  type ColorPickerOpenRequest,
} from "@prismux/appearance";
import { useWallpaperStore } from "@prismux/wallpaper";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { toastManager } from "../../components/ui/toast";
import {
  SettingsSegmentedTabs,
  type SettingsSegmentedTabItem,
} from "../../components/settings/SettingsSegmentedTabs";
import { TypographySection } from "../../components/settings/TypographySettings";
import { usePrismuxRuntime } from "../PrismuxRuntimeProvider";

function isSamePickerSlot(a: ActiveColorPickerSlot | null, b: ActiveColorPickerSlot): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "typography" && b.kind === "typography") {
    return a.polarity === b.polarity && a.role === b.role;
  }
  if (a.kind === "uiColor" && b.kind === "uiColor") {
    return a.key === b.key;
  }
  if (a.kind === "surfaceColor" && b.kind === "surfaceColor") {
    return a.surfaceId === b.surfaceId;
  }
  return true;
}

export const APPEARANCE_TAB_IDS = {
  theme: "theme",
  glass: "glass",
  typography: "typography",
} as const;

export const APPEARANCE_TAB_HASH_ANCHORS = {
  theme: ["prismux-appearance", "color-scheme", "theme", "panel-animations"] as const,
  glass: ["liquid-glass", "glass-zones", "sidebar-corners"] as const,
  typography: [
    "typography",
    "interface-font",
    "prompt-font",
    "code-font",
    "terminal-font",
    "separate-fonts",
    "font-smoothing",
    "word-wrap",
  ] as const,
} as const;

/** 3-tab Prismux appearance settings hub (`theme`, `glass`, `typography`). */
export function PrismuxAppearanceIntegration({
  themeAdvancedSlot,
}: {
  readonly themeAdvancedSlot?: ReactNode;
} = {}) {
  const gt = useGT();
  const navigate = useNavigate();
  const { appearance, setAppearance, wallpaperStore } = usePrismuxRuntime();
  const wallpaperSnap = useWallpaperStore(wallpaperStore);
  const [pickerReq, setPickerReq] = useState<ColorPickerOpenRequest | null>(null);

  const selectedId = wallpaperSnap.settings.selectedId;
  const activeWallpaper = selectedId
    ? (wallpaperSnap.wallpapers.find((item) => item.id === selectedId) ?? null)
    : null;

  const handleAppearanceChange = (next: AppearanceConfig) => {
    setAppearance(next);
  };

  const handleOpenColorPicker = (req: ColorPickerOpenRequest) => {
    setPickerReq((prev) => (prev && isSamePickerSlot(prev.slot, req.slot) ? null : req));
  };

  const applySlotColor = (slot: ActiveColorPickerSlot, hex: string) => {
    setAppearance((prev) => {
      switch (slot.kind) {
        case "accent":
          return { ...prev, accentMode: "custom", accent: hex };
        case "glassColor":
          return { ...prev, glassColor: hex || "#ffffff" };
        case "glassDarkColor":
          return { ...prev, glassDarkColor: hex || "#000000" };
        case "surfaceColor": {
          const prevSurface = prev.perSurfaceOverrides[slot.surfaceId];
          return {
            ...prev,
            perSurfaceOverrides: {
              ...prev.perSurfaceOverrides,
              [slot.surfaceId]: {
                ...prevSurface,
                mode: "custom",
                color: hex,
              },
            },
          };
        }
        case "caretColor":
          return { ...prev, caretColor: hex };
        case "typography":
          return {
            ...prev,
            typography: {
              ...prev.typography,
              [slot.polarity]: {
                ...prev.typography[slot.polarity],
                [slot.role]: hex,
              },
            },
          };
        case "uiColor":
          return {
            ...prev,
            uiColorCustom: {
              ...prev.uiColorCustom,
              enabled: true,
              [slot.key]: hex,
            },
          };
      }
    });
  };

  const activeColorValue = (() => {
    if (!pickerReq) return "";
    const slot = pickerReq.slot;
    switch (slot.kind) {
      case "accent":
        return appearance.accentMode === "custom" ? appearance.accent : "#0078d4";
      case "glassColor":
        return appearance.glassColor;
      case "glassDarkColor":
        return appearance.glassDarkColor;
      case "surfaceColor":
        return appearance.perSurfaceOverrides[slot.surfaceId]?.color ?? "";
      case "caretColor":
        return appearance.caretColor;
      case "typography":
        return appearance.typography[slot.polarity][slot.role];
      case "uiColor":
        return appearance.uiColorCustom[slot.key];
    }
  })();

  const handleClearAppearanceFontOverride = (kind: "sans" | "code") => {
    setAppearance((prev) => {
      if (kind === "sans" && prev.typography.fontFamily === "") return prev;
      if (kind === "code" && prev.typography.codeFontFamily === "") return prev;
      return {
        ...prev,
        typography: {
          ...prev.typography,
          ...(kind === "sans" ? { fontFamily: "" } : { codeFontFamily: "" }),
        },
      };
    });
  };

  const handleSnapshotFeedback = (feedback: {
    readonly tone: "ok" | "error";
    readonly message: string;
  }) => {
    toastManager.add({
      type: feedback.tone === "error" ? "error" : "success",
      title: feedback.message,
    });
  };

  const wallpaperSlot = (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/35 px-3 py-2 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-foreground">
          {activeWallpaper
            ? gt("Current wallpaper: {title}", { title: activeWallpaper.title })
            : gt("No wallpaper active (default stage)")}
        </span>
        {activeWallpaper ? (
          <Badge variant={wallpaperSnap.settings.playing ? "success" : "secondary"}>
            {wallpaperSnap.settings.playing ? gt("Rendering") : gt("Paused")}
          </Badge>
        ) : null}
      </div>
      <Button
        size="xs"
        variant="outline"
        onClick={() => void navigate({ to: "/settings/wallpaper" })}
      >
        <T>Wallpaper engine</T>
        <ChevronRightIcon className="size-3.5" />
      </Button>
    </div>
  );

  const tabs: ReadonlyArray<SettingsSegmentedTabItem> = [
    {
      id: APPEARANCE_TAB_IDS.theme,
      label: gt("Theme & colors"),
      hashAnchors: APPEARANCE_TAB_HASH_ANCHORS.theme,
      content: (
        <div id="prismux-appearance" className="flex flex-col gap-5">
          <ThemeHeroCard config={appearance} onChange={handleAppearanceChange}>
            {wallpaperSlot}
          </ThemeHeroCard>

          <ThemePaletteCard
            config={appearance}
            onChange={handleAppearanceChange}
            activeSlot={pickerReq?.slot ?? null}
            onOpenColorPicker={handleOpenColorPicker}
          />

          {themeAdvancedSlot}
        </div>
      ),
    },
    {
      id: APPEARANCE_TAB_IDS.glass,
      label: gt("Liquid glass & corners"),
      hashAnchors: APPEARANCE_TAB_HASH_ANCHORS.glass,
      content: (
        <div id="liquid-glass" className="flex flex-col gap-5">
          <LiquidGlassCard
            config={appearance}
            onChange={handleAppearanceChange}
            activeSlot={pickerReq?.slot ?? null}
            onOpenColorPicker={handleOpenColorPicker}
            alwaysShow
            showAccentRow={false}
          />

          <div id="sidebar-corners">
            <SidebarCornersCard config={appearance} onChange={handleAppearanceChange} />
          </div>
        </div>
      ),
    },
    {
      id: APPEARANCE_TAB_IDS.typography,
      label: gt("Fonts & typography"),
      hashAnchors: APPEARANCE_TAB_HASH_ANCHORS.typography,
      content: (
        <div className="flex flex-col gap-5">
          <TypographySection onClearAppearanceFontOverride={handleClearAppearanceFontOverride} />

          <TypographyCard
            config={appearance}
            onChange={handleAppearanceChange}
            activeSlot={pickerReq?.slot ?? null}
            onOpenColorPicker={handleOpenColorPicker}
            showFontFamilySelectors={false}
            showUiColorsAndCaret={false}
          />
        </div>
      ),
    },
  ];

  const colorPopoverPortalContainer =
    pickerReq?.anchorEl?.closest<HTMLElement>('[data-slot="dialog-popup"]') ?? undefined;

  return (
    <>
      <SettingsSegmentedTabs
        tabs={tabs}
        defaultTabId={APPEARANCE_TAB_IDS.theme}
        ariaLabel={gt("Appearance settings sections")}
        trailingAction={
          <ThemeSnapshotActions
            config={appearance}
            onChange={handleAppearanceChange}
            themeName="Prismux Liquid Glass"
            onFeedback={handleSnapshotFeedback}
          />
        }
      />

      <FloatingColorPopover
        open={pickerReq !== null}
        value={activeColorValue}
        fallbackColor={pickerReq?.fallbackColor ?? "#5e9bff"}
        anchorEl={pickerReq?.anchorEl ?? null}
        portalContainer={colorPopoverPortalContainer}
        title={pickerReq?.title ?? gt("Pick color")}
        onChange={(hex) => {
          if (pickerReq) applySlotColor(pickerReq.slot, hex);
        }}
        onClear={() => {
          if (pickerReq) applySlotColor(pickerReq.slot, "");
        }}
        onClose={() => setPickerReq(null)}
      />
    </>
  );
}
