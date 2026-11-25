import {
  PREVIEW_VIEWPORT_MAX_AREA,
  PREVIEW_VIEWPORT_MAX_DIMENSION,
  PREVIEW_VIEWPORT_MIN_DIMENSION,
  type DesktopPreviewColorScheme,
  type PreviewViewportSetting,
} from "@prismux/core-contracts";
import {
  CURATED_MOBILE_VIEWPORT_PRESETS,
  DEFAULT_MOBILE_SIMULATOR_PRESET_ID,
  findPreviewViewportPreset,
  PREVIEW_VIEWPORT_PRESETS,
  resolvePreviewViewport,
} from "@prismux/core-shared/previewViewport";
import {
  FrameIcon,
  Link2,
  MonitorIcon,
  MoonIcon,
  SmartphoneIcon,
  SunIcon,
  Unlink2,
  X,
} from "lucide-react";
import { useState } from "react";
import { msg, T, useGT, useMessages } from "gt-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";

import { BROWSER_DEVICE_TOOLBAR_HEIGHT, resizeFreeformViewport } from "./browserViewportLayout";
import { commitViewportAndAspectRatio } from "./browserDeviceToolbarState";
import { ScreenRotationIcon } from "./ScreenRotationIcon";

const RESPONSIVE_VALUE = "responsive";
const CURATED_MOBILE_ID_SET = new Set<string>(
  CURATED_MOBILE_VIEWPORT_PRESETS.map((preset) => preset.id),
);
const OTHER_STANDARD_PRESETS = PREVIEW_VIEWPORT_PRESETS.filter(
  (preset) => !CURATED_MOBILE_ID_SET.has(preset.id),
);
const SELECT_ITEMS = [
  {
    value: RESPONSIVE_VALUE,
    label: msg("Responsive", { $context: "browser viewport preset that follows the panel size" }),
  },
  ...PREVIEW_VIEWPORT_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
];

const COLOR_SCHEME_CYCLE: readonly DesktopPreviewColorScheme[] = ["system", "light", "dark"];

function nextColorScheme(current: DesktopPreviewColorScheme): DesktopPreviewColorScheme {
  const index = COLOR_SCHEME_CYCLE.indexOf(current);
  return COLOR_SCHEME_CYCLE[(index + 1) % COLOR_SCHEME_CYCLE.length] ?? "system";
}

interface Props {
  readonly setting: Exclude<PreviewViewportSetting, { readonly _tag: "fill" }>;
  readonly width: number;
  readonly aspectRatio: number | null;
  readonly onAspectRatioChange: (aspectRatio: number | null) => void;
  readonly onChange: (setting: PreviewViewportSetting) => Promise<void>;
  readonly bezelEnabled?: boolean;
  readonly onBezelEnabledChange?: (enabled: boolean) => void;
  readonly emulatedColorScheme?: DesktopPreviewColorScheme;
  readonly onEmulatedColorSchemeChange?: (scheme: DesktopPreviewColorScheme) => void;
}

export function BrowserDeviceToolbar({
  setting,
  width,
  aspectRatio,
  onAspectRatioChange,
  onChange,
  bezelEnabled = true,
  onBezelEnabledChange,
  emulatedColorScheme = "system",
  onEmulatedColorSchemeChange,
}: Props) {
  const gt = useGT();
  const m = useMessages();
  const [pending, setPending] = useState(false);
  const [customSize, setCustomSize] = useState<{
    readonly width: string;
    readonly height: string;
    readonly axis?: "width" | "height";
  } | null>(null);
  const presentedSize = customSize ?? {
    width: String(setting.width),
    height: String(setting.height),
  };
  const selectedValue =
    setting._tag === "preset" &&
    PREVIEW_VIEWPORT_PRESETS.some((preset) => preset.id === setting.presetId)
      ? setting.presetId
      : RESPONSIVE_VALUE;
  const activePreset =
    setting._tag === "preset" ? (findPreviewViewportPreset(setting.presetId) ?? null) : null;
  const isPhoneSimulatorActive = Boolean(activePreset?.mobile);
  const typedWidth = Number(presentedSize.width);
  const typedHeight = Number(presentedSize.height);
  const { width: customWidth, height: customHeight } =
    aspectRatio === null || customSize?.axis === undefined
      ? { width: typedWidth, height: typedHeight }
      : resizeFreeformViewport(
          { width: typedWidth, height: typedHeight },
          { x: 0, y: 0 },
          1,
          customSize?.axis === "height" ? "south" : "east",
          aspectRatio,
        );
  const customValid =
    Number.isInteger(typedWidth) &&
    Number.isInteger(typedHeight) &&
    typedWidth >= PREVIEW_VIEWPORT_MIN_DIMENSION &&
    typedWidth <= PREVIEW_VIEWPORT_MAX_DIMENSION &&
    typedHeight >= PREVIEW_VIEWPORT_MIN_DIMENSION &&
    typedHeight <= PREVIEW_VIEWPORT_MAX_DIMENSION &&
    customWidth * customHeight <= PREVIEW_VIEWPORT_MAX_AREA;

  const apply = (next: PreviewViewportSetting, nextAspectRatio = aspectRatio) => {
    setPending(true);
    void commitViewportAndAspectRatio(next, nextAspectRatio, onChange, onAspectRatioChange).then(
      () => {
        setPending(false);
        setCustomSize(null);
      },
      () => setPending(false),
    );
  };

  const applyCustomSize = () => {
    if (!customValid || (customWidth === setting.width && customHeight === setting.height)) {
      setCustomSize(null);
      return;
    }
    apply({ _tag: "freeform", width: customWidth, height: customHeight });
  };

  const updateCustomDimension = (axis: "width" | "height", value: string) => {
    setCustomSize((current) => {
      const next = {
        width: axis === "width" ? value : (current?.width ?? String(setting.width)),
        height: axis === "height" ? value : (current?.height ?? String(setting.height)),
        axis,
      };
      const numeric = Number(value);
      if (
        aspectRatio === null ||
        !Number.isInteger(numeric) ||
        numeric < PREVIEW_VIEWPORT_MIN_DIMENSION ||
        numeric > PREVIEW_VIEWPORT_MAX_DIMENSION
      ) {
        return next;
      }
      const resized = resizeFreeformViewport(
        setting,
        axis === "width"
          ? { x: numeric - setting.width, y: 0 }
          : { x: 0, y: numeric - setting.height },
        1,
        axis === "width" ? "east" : "south",
        aspectRatio,
      );
      return {
        ...next,
        width: axis === "width" ? value : String(resized.width),
        height: axis === "height" ? value : String(resized.height),
      };
    });
  };

  const selectViewport = (value: string | null) => {
    if (!value) return;
    if (value === RESPONSIVE_VALUE) {
      if (setting._tag === "freeform") return;
      apply({ _tag: "freeform", width: setting.width, height: setting.height });
      return;
    }
    const preset = PREVIEW_VIEWPORT_PRESETS.find((candidate) => candidate.id === value);
    if (!preset) return;
    apply(
      resolvePreviewViewport({ mode: "preset", preset: preset.id }),
      aspectRatio === null ? null : preset.width / preset.height,
    );
  };

  const rotate = () => {
    const hasCustomSize =
      customValid && (customWidth !== setting.width || customHeight !== setting.height);
    const source = hasCustomSize
      ? ({ _tag: "freeform", width: customWidth, height: customHeight } as const)
      : setting;
    apply(
      { ...source, width: source.height, height: source.width },
      aspectRatio === null ? null : 1 / aspectRatio,
    );
  };

  const toggleAspectRatio = () => {
    onAspectRatioChange(aspectRatio === null ? customWidth / customHeight : null);
  };

  const activatePhoneSimulator = () => {
    const targetPreset =
      findPreviewViewportPreset(DEFAULT_MOBILE_SIMULATOR_PRESET_ID) ??
      CURATED_MOBILE_VIEWPORT_PRESETS[0];
    if (!targetPreset) return;
    onBezelEnabledChange?.(true);
    apply(
      resolvePreviewViewport({ mode: "preset", preset: targetPreset.id }),
      aspectRatio === null ? null : targetPreset.width / targetPreset.height,
    );
  };

  const colorSchemeLabel =
    emulatedColorScheme === "dark"
      ? "深色媒体模拟"
      : emulatedColorScheme === "light"
        ? "浅色媒体模拟"
        : "跟随宿主明暗";

  return (
    <div
      className="sticky left-0 top-0 z-50 flex items-center gap-0.5 overflow-x-auto border-b border-border/70 bg-background/95 px-1.5 shadow-xs backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ width, height: BROWSER_DEVICE_TOOLBAR_HEIGHT }}
      role="toolbar"
      aria-label={gt("Browser device toolbar")}
      data-browser-device-toolbar
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        const eventTarget = event.target;
        if (
          (nextTarget instanceof HTMLElement &&
            nextTarget.closest('[data-slot="select-positioner"]')) ||
          (eventTarget instanceof HTMLElement &&
            eventTarget.closest('[data-slot="select-positioner"]'))
        ) {
          return;
        }
        applyCustomSize();
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={isPhoneSimulatorActive ? "secondary" : "ghost"}
              size="xs"
              type="button"
              data-testid="browser-phone-simulator-shortcut"
              aria-label="手机模拟快捷模式（iPhone 16 Pro）"
              aria-pressed={isPhoneSimulatorActive}
              disabled={pending}
              onClick={activatePhoneSimulator}
              className="mr-0.5 shrink-0 gap-1 px-1.5 text-[11px]"
            />
          }
        >
          <SmartphoneIcon aria-hidden className="size-3 shrink-0" />
          {width >= 420 ? <span>手机模拟</span> : null}
        </TooltipTrigger>
        <TooltipPopup side="top">
          一键切换至 iPhone 16 Pro 真机模拟（含机身外壳与移动端触摸/UA 仿真）
        </TooltipPopup>
      </Tooltip>
      {width >= 660 ? (
        <span className="mr-0.5 shrink-0 text-2xs font-medium text-muted-foreground">
          <T>Dimensions</T>
        </span>
      ) : null}
      <Select
        modal={false}
        value={selectedValue}
        onValueChange={selectViewport}
        items={SELECT_ITEMS.map((item) => ({ ...item, label: m(item.label) }))}
        disabled={pending}
      >
        <SelectTrigger
          variant="ghost"
          size="xs"
          className={cn("shrink-0 justify-between", width >= 440 ? "w-36" : "w-24")}
          aria-label={gt("Browser device preset")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false}>
          <SelectItem value={RESPONSIVE_VALUE}>{m(SELECT_ITEMS[0]!.label)}</SelectItem>
          <SelectGroup>
            <SelectGroupLabel>精选手机模拟</SelectGroupLabel>
            {CURATED_MOBILE_VIEWPORT_PRESETS.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                <span className="flex w-full items-center justify-between gap-4">
                  <span>{preset.label}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {preset.detail}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectGroupLabel>
              <T context="group of standard device sizes">Standard</T>
            </SelectGroupLabel>
            {OTHER_STANDARD_PRESETS.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                <span className="flex w-full items-center justify-between gap-5">
                  <span>{preset.label}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {preset.detail}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>

      <form
        className="m-0 flex min-w-0 shrink-0 items-center gap-0.5 border-0 p-0"
        aria-label={gt("Viewport dimensions")}
        onSubmit={(event) => {
          event.preventDefault();
          applyCustomSize();
        }}
      >
        <Input
          nativeInput
          type="number"
          inputMode="numeric"
          size="compact"
          font="mono"
          min={PREVIEW_VIEWPORT_MIN_DIMENSION}
          max={PREVIEW_VIEWPORT_MAX_DIMENSION}
          value={presentedSize.width}
          disabled={pending}
          onFocus={() =>
            setCustomSize(
              (current) =>
                current ?? {
                  width: String(setting.width),
                  height: String(setting.height),
                },
            )
          }
          onChange={(event) => updateCustomDimension("width", event.target.value)}
          aria-label={gt("Viewport width")}
          aria-invalid={!customValid}
          className={width >= 360 ? "w-14" : "w-13"}
        />
        <span className="text-xs text-muted-foreground">×</span>
        <Input
          nativeInput
          type="number"
          inputMode="numeric"
          size="compact"
          font="mono"
          min={PREVIEW_VIEWPORT_MIN_DIMENSION}
          max={PREVIEW_VIEWPORT_MAX_DIMENSION}
          value={presentedSize.height}
          disabled={pending}
          onFocus={() =>
            setCustomSize(
              (current) =>
                current ?? {
                  width: String(setting.width),
                  height: String(setting.height),
                },
            )
          }
          onChange={(event) => updateCustomDimension("height", event.target.value)}
          aria-label={gt("Viewport height")}
          aria-invalid={!customValid}
          className={width >= 360 ? "w-14" : "w-13"}
        />
      </form>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={aspectRatio === null ? "ghost" : "secondary"}
              size="icon-xs"
              type="button"
              aria-label={
                aspectRatio === null
                  ? gt("Lock viewport aspect ratio")
                  : gt("Unlock viewport aspect ratio")
              }
              aria-pressed={aspectRatio !== null}
              disabled={pending || !customValid}
              onPointerDown={(event) => event.preventDefault()}
              onClick={toggleAspectRatio}
            />
          }
        >
          {aspectRatio === null ? (
            <Unlink2 className={cn(aspectRatio !== null && "text-foreground")} />
          ) : (
            <Link2 className={cn(aspectRatio !== null && "text-foreground")} />
          )}
        </TooltipTrigger>
        <TooltipPopup side="top">
          {aspectRatio === null ? <T>Lock aspect ratio</T> : <T>Unlock aspect ratio</T>}
        </TooltipPopup>
      </Tooltip>
      <Button
        variant="ghost"
        size="icon-xs"
        type="button"
        aria-label={gt("Rotate viewport")}
        disabled={pending}
        onClick={rotate}
      >
        <ScreenRotationIcon />
      </Button>
      {onBezelEnabledChange ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={bezelEnabled ? "secondary" : "ghost"}
                size="icon-xs"
                type="button"
                data-testid="browser-bezel-toggle"
                aria-label={bezelEnabled ? "隐藏拟真机身外壳" : "显示拟真机身外壳"}
                aria-pressed={bezelEnabled}
                disabled={pending || !activePreset || activePreset.bezelStyle === "none"}
                onClick={() => onBezelEnabledChange(!bezelEnabled)}
              />
            }
          >
            <FrameIcon aria-hidden className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">
            {bezelEnabled ? "隐藏拟真手机机身外壳" : "显示拟真手机机身外壳"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {onEmulatedColorSchemeChange ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={emulatedColorScheme !== "system" ? "secondary" : "ghost"}
                size="icon-xs"
                type="button"
                data-testid="browser-color-scheme-toggle"
                aria-label={`切换媒体明暗仿真（当前：${colorSchemeLabel}）`}
                disabled={pending}
                onClick={() => onEmulatedColorSchemeChange(nextColorScheme(emulatedColorScheme))}
              />
            }
          >
            {emulatedColorScheme === "dark" ? (
              <MoonIcon aria-hidden className="size-3.5" />
            ) : emulatedColorScheme === "light" ? (
              <SunIcon aria-hidden className="size-3.5" />
            ) : (
              <MonitorIcon aria-hidden className="size-3.5" />
            )}
          </TooltipTrigger>
          <TooltipPopup side="top">
            浅/深色媒体特征模拟：{colorSchemeLabel}（点击切换）
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {activePreset && width >= 540 ? (
        <span className="shrink-0 rounded-sm border border-border/70 bg-muted/60 px-1 py-0.5 font-mono text-[10px] font-medium text-muted-foreground tabular-nums">
          @{activePreset.deviceScaleFactor}x
        </span>
      ) : null}
      <span className="sticky right-0 ml-auto flex bg-background/95">
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          aria-label={gt("Close device toolbar")}
          disabled={pending}
          onClick={() => {
            apply({ _tag: "fill" }, null);
          }}
        >
          <X />
        </Button>
      </span>
    </div>
  );
}
