import {
  InlineAppearanceStudio,
  ThemePaletteCard,
  clearPrismuxAppearanceFromDocument,
  contrastRatioHex,
  hexToRgb,
  type ThemeMode,
} from "@prismux/appearance";
import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "@prismux/appearance/styles.css";
import "~/index.css";
import { render } from "../../test/render";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { setAppearanceMode, setTheme } from "../hooks/useTheme";
import { PrismuxRuntimeProvider, usePrismuxRuntime } from "./PrismuxRuntimeProvider";

function parseCssRgb(value: string): { r: number; g: number; b: number } {
  const match = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!match) {
    throw new Error(`Expected rgb()/rgba() CSS color, got: ${value}`);
  }
  return {
    r: Math.round(Number(match[1])),
    g: Math.round(Number(match[2])),
    b: Math.round(Number(match[3])),
  };
}

function rgbToHexStr(rgb: { r: number; g: number; b: number }): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function AccentProbeWorkbench() {
  const { appearance, setAppearance, setThemeMode } = usePrismuxRuntime();
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="mode-light"
          onClick={() => setThemeMode("light")}
        >
          Light
        </button>
        <button
          type="button"
          data-testid="mode-dark"
          onClick={() => setThemeMode("dark")}
        >
          Dark
        </button>
        <button
          type="button"
          data-testid="mode-glass"
          onClick={() => setThemeMode("glass")}
        >
          Glass
        </button>
        <button
          type="button"
          data-testid="accent-yellow"
          onClick={() =>
            setAppearance((prev) => ({ ...prev, accentMode: "custom", accent: "#facc15" }))
          }
        >
          Yellow
        </button>
        <button
          type="button"
          data-testid="accent-navy"
          onClick={() =>
            setAppearance((prev) => ({ ...prev, accentMode: "custom", accent: "#0d1524" }))
          }
        >
          Navy
        </button>
        <button
          type="button"
          data-testid="accent-system"
          onClick={() =>
            setAppearance((prev) => ({ ...prev, accentMode: "system", accent: "" }))
          }
        >
          System
        </button>
      </div>

      <div className="flex items-center gap-3">
        <Button data-testid="primary-btn" variant="default">
          Primary Action
        </Button>
        <Switch data-testid="accent-switch" checked onCheckedChange={() => {}} />
      </div>

      <div data-app-sidebar="1">
        <div
          data-testid="active-sidebar-card"
          data-sidebar-card="1"
          data-sidebar-card-active="1"
          className="rounded-md border px-3 py-2"
        >
          Active Thread
        </div>
      </div>

      <InlineAppearanceStudio
        config={appearance}
        onChange={setAppearance}
        onThemeModeChange={(m: ThemeMode) => setThemeMode(m)}
      />

      <ThemePaletteCard
        config={appearance}
        onChange={setAppearance}
        onOpenColorPicker={() => {}}
      />
    </div>
  );
}

describe("PrismuxRuntimeProvider real-Chromium Light/Dark/Glass accent verification", () => {
  it("applies custom, bright, and dark accents to real Button, Switch, sidebar cards & root tokens in Light, Dark, and Glass modes without clobbering by useTheme", async () => {
    await page.viewport(1280, 900);
    window.localStorage.clear();
    using _cleanup = {
      [Symbol.dispose]() {
        clearPrismuxAppearanceFromDocument(document);
        window.localStorage.clear();
      },
    };

    await using _screen = await render(
      <PrismuxRuntimeProvider>
        <AccentProbeWorkbench />
      </PrismuxRuntimeProvider>,
    );

    const expectAccentRendered = async (
      expectedHex: string,
      expectedInkHex: "#ffffff" | "#000000",
      expectedTheme: "light" | "dark",
      expectedGlass: "0" | "1",
    ) => {
      const wantRgb = hexToRgb(expectedHex);
      const wantInkRgb = hexToRgb(expectedInkHex);

      await expect
        .poll(() => document.documentElement.getAttribute("data-pmx-theme"))
        .toBe(expectedTheme);
      expect(document.documentElement.getAttribute("data-pmx-glass")).toBe(expectedGlass);

      const rootStyle = getComputedStyle(document.documentElement);
      expect(rootStyle.getPropertyValue("--pmx-accent").trim().toLowerCase()).toBe(expectedHex);
      expect(rootStyle.getPropertyValue("--primary").trim().toLowerCase()).toBe(expectedHex);
      expect(rootStyle.getPropertyValue("--primary-foreground").trim().toLowerCase()).toBe(
        expectedInkHex,
      );
      expect(rootStyle.getPropertyValue("--ring").trim().toLowerCase()).toBe(expectedHex);
      expect(rootStyle.getPropertyValue("--sidebar-primary").trim().toLowerCase()).toBe(
        expectedHex,
      );
      expect(rootStyle.getPropertyValue("--sidebar-ring").trim().toLowerCase()).toBe(expectedHex);

      // WCAG >= 4.5:1 for --pmx-accent-text on active polarity surface
      const accentTextHex = rootStyle.getPropertyValue("--pmx-accent-text").trim().toLowerCase();
      expect(accentTextHex).toMatch(/^#[0-9a-f]{6}$/);
      expect(
        contrastRatioHex(accentTextHex, expectedTheme === "dark" ? "#181a24" : "#f4f4f5"),
      ).toBeGreaterThanOrEqual(4.5);

      // Real host Button consumes --primary and --primary-foreground
      const btnEl = document.querySelector<HTMLElement>('[data-testid="primary-btn"]')!;
      await expect
        .poll(() => parseCssRgb(getComputedStyle(btnEl).backgroundColor))
        .toEqual(wantRgb);
      await expect.poll(() => parseCssRgb(getComputedStyle(btnEl).color)).toEqual(wantInkRgb);
      const btnStyle = getComputedStyle(btnEl);
      expect(
        contrastRatioHex(
          rgbToHexStr(parseCssRgb(btnStyle.color)),
          rgbToHexStr(parseCssRgb(btnStyle.backgroundColor)),
        ),
      ).toBeGreaterThanOrEqual(4.5);

      // Real checked Switch consumes --primary (wait for its 200ms background-color transition)
      const switchEl = document.querySelector<HTMLElement>('[data-testid="accent-switch"]')!;
      await expect
        .poll(() => parseCssRgb(getComputedStyle(switchEl).backgroundColor))
        .toEqual(wantRgb);
    };

    // 1. Switch to Light mode and click Emerald (#10b981) inside InlineAppearanceStudio
    await page.getByTestId("mode-light").click();
    await page.getByRole("button", { name: "选择强调色 薄荷绿" }).click();
    await expectAccentRendered("#10b981", "#000000", "light", "0");

    const sidebarCard = document.querySelector<HTMLElement>('[data-testid="active-sidebar-card"]')!;
    const lightEmeraldBorder = getComputedStyle(sidebarCard).borderColor;

    // Bidirectional sync: ThemePaletteCard immediately reflects #10b981
    const paletteCard = document.querySelector<HTMLElement>("[data-pmx-theme-palette-card]")!;
    expect(paletteCard.textContent).toContain("#10b981");

    // 2. Bright yellow (#facc15) in Light mode -> dark #000000 ink on button & active sidebar card updates
    await page.getByTestId("accent-yellow").click();
    await expectAccentRendered("#facc15", "#000000", "light", "0");
    await expect
      .poll(() => getComputedStyle(sidebarCard).borderColor)
      .not.toBe(lightEmeraldBorder);

    // 3. External built-in theme switch (`ocean` sets data-theme-id + inline context chips) must NOT clobber accent
    setTheme("ocean");
    setAppearanceMode("light");
    await expectAccentRendered("#facc15", "#000000", "light", "0");
    const chipAfterOcean = getComputedStyle(document.documentElement)
      .getPropertyValue("--context-chip-file")
      .trim()
      .toLowerCase();
    expect(chipAfterOcean).toBe(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--pmx-accent-text")
        .trim()
        .toLowerCase(),
    );

    // 4. Switch to Dark mode: custom violet (#8b5cf6 -> #000000 ink at 4.96:1 > white 4.23:1) & deep navy (#0d1524 -> white ink)
    await page.getByTestId("mode-dark").click();
    await page.getByRole("button", { name: "选择强调色 星语紫" }).click();
    await expectAccentRendered("#8b5cf6", "#000000", "dark", "0");
    expect(paletteCard.textContent).toContain("#8b5cf6");

    await page.getByTestId("accent-navy").click();
    await expectAccentRendered("#0d1524", "#ffffff", "dark", "0");

    // 5. Switch to Glass mode: keeps accent intact and applies glass flag
    await page.getByTestId("mode-glass").click();
    await expectAccentRendered("#0d1524", "#ffffff", "dark", "1");

    // 6. Reset back to System default in Light & Dark modes
    await page.getByTestId("accent-system").click();
    await page.getByTestId("mode-light").click();
    await expectAccentRendered("#005fb8", "#ffffff", "light", "0");

    await page.getByTestId("mode-dark").click();
    await expectAccentRendered("#5e9bff", "#000000", "dark", "0");

    // 7. Theme Editor live preview (`data-theme-id="__preview"`) retains precedence over inline accent tokens
    document.documentElement.dataset.themeId = "__preview";
    document.documentElement.style.setProperty("--app-theme-message-action", "#e11d48");
    document.documentElement.style.setProperty("--app-theme-message-action-foreground", "#ffffff");
    const btnEl = document.querySelector<HTMLElement>('[data-testid="primary-btn"]')!;
    await expect
      .poll(() => parseCssRgb(getComputedStyle(btnEl).backgroundColor))
      .toEqual(hexToRgb("#e11d48"));
    delete document.documentElement.dataset.themeId;
    document.documentElement.style.removeProperty("--app-theme-message-action");
    document.documentElement.style.removeProperty("--app-theme-message-action-foreground");
  });
});
