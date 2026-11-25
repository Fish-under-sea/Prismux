import type { CSSProperties } from "react";
import { msg, useGT, useMessages } from "gt-react";
import {
  CollapsedAssistantReplyMode,
  DEFAULT_UNIFIED_SETTINGS,
  type EffortDisplay,
  MAX_PANEL_ANIMATION_DURATION_MS,
  MIN_PANEL_ANIMATION_DURATION_MS,
  WorkStepsCollapseTiming,
  WorkStepsDisplay,
} from "@t3tools/contracts/settings";
import * as Schema from "effect/Schema";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { AdvancedSettings } from "./AdvancedSettings";
import { PanelAnimationsPreview } from "./PanelAnimationsPreview";
import { TypographySection } from "./TypographySettings";
import { ThreadDetailsItemsRow } from "./ThreadDetailsItemsRow";
import { PrismuxAppearanceIntegration } from "../../prismux/settings/PrismuxAppearanceIntegration";

const EFFORT_DISPLAY_LABELS: Record<EffortDisplay, string> = {
  label: msg("Word", { $context: "show effort as a word" }),
  bars: msg("Bars", { $context: "show effort as bars" }),
};

const WORK_STEPS_DISPLAY_LABELS: Record<WorkStepsDisplay, string> = {
  concise: msg("Concise", { $context: "work steps display level" }),
  standard: msg("Standard", { $context: "work steps display level" }),
  detailed: msg("Detailed", { $context: "work steps display level" }),
  expanded: msg("Fully expanded", { $context: "work steps display level" }),
};

const WORK_STEPS_COLLAPSE_TIMING_LABELS: Record<WorkStepsCollapseTiming, string> = {
  "after-turn": msg("After response ends", { $context: "work steps collapse timing" }),
  "next-message": msg("On next new message", { $context: "work steps collapse timing" }),
};

const COLLAPSED_ASSISTANT_REPLY_MODE_LABELS: Record<CollapsedAssistantReplyMode, string> = {
  all: msg("All replies", { $context: "collapsed assistant replies" }),
  "final-only": msg("Final answer only", { $context: "collapsed assistant replies" }),
};

const isWorkStepsDisplay = Schema.is(WorkStepsDisplay);
const isWorkStepsCollapseTiming = Schema.is(WorkStepsCollapseTiming);
const isCollapsedAssistantReplyMode = Schema.is(CollapsedAssistantReplyMode);

export function AppearanceSettingsPanel() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const m = useMessages();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const panelAnimationDurationRatio =
    (settings.panelAnimationDurationMs - MIN_PANEL_ANIMATION_DURATION_MS) /
    (MAX_PANEL_ANIMATION_DURATION_MS - MIN_PANEL_ANIMATION_DURATION_MS);
  const panelAnimationDurationSliderStyle = {
    "--settings-slider-progress": `${panelAnimationDurationRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - panelAnimationDurationRatio}rem`,
  } as CSSProperties;

  return (
    <SettingsPageContainer>
      <PrismuxAppearanceIntegration />

      <TypographySection />

      <SettingsSection id="appearance-interface" title={gt("Interface")}>
        <ThreadDetailsItemsRow />
        <SettingsRow
          {...searchableSetting("effort-display")}
          description={gt(
            "Show reasoning effort in the composer as its name, such as High, or as bars.",
          )}
          resetAction={
            settings.effortDisplay !== DEFAULT_UNIFIED_SETTINGS.effortDisplay ? (
              <SettingResetButton
                ariaLabel={gt("Reset effort display to default")}
                onClick={() =>
                  updateSettings({ effortDisplay: DEFAULT_UNIFIED_SETTINGS.effortDisplay })
                }
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-44">
              <Select
                value={settings.effortDisplay}
                onValueChange={(value) => {
                  if (value === "bars" || value === "label")
                    updateSettings({ effortDisplay: value });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full min-w-0"
                  aria-label={gt("Effort display")}
                >
                  <SelectValue>{m(EFFORT_DISPLAY_LABELS[settings.effortDisplay])}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="bars">{gt("Bars (default)")}</SelectItem>
                  <SelectItem value="label">{m(EFFORT_DISPLAY_LABELS.label)}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <SettingsRow
          {...searchableSetting("math-rendering")}
          description={gt(
            "Typeset LaTeX math, such as $x^2$ or \\[x^2\\], in messages and Markdown previews. The composer keeps TeX source editable.",
          )}
          resetAction={
            settings.mathRenderingEnabled !== DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled ? (
              <SettingResetButton
                ariaLabel={gt("Reset math rendering to default")}
                onClick={() =>
                  updateSettings({
                    mathRenderingEnabled: DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.mathRenderingEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ mathRenderingEnabled: Boolean(checked) })
              }
              aria-label={gt("Render math")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("work-steps-display")}
          description={gt("Choose how much tool call detail to show.")}
          resetAction={
            settings.workStepsDisplay !== DEFAULT_UNIFIED_SETTINGS.workStepsDisplay ? (
              <SettingResetButton
                ariaLabel={gt("Reset work steps display to default")}
                onClick={() =>
                  updateSettings({ workStepsDisplay: DEFAULT_UNIFIED_SETTINGS.workStepsDisplay })
                }
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-44">
              <Select
                value={settings.workStepsDisplay}
                onValueChange={(value) => {
                  if (isWorkStepsDisplay(value)) {
                    updateSettings({ workStepsDisplay: value });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full min-w-0"
                  aria-label={gt("Work steps display")}
                >
                  <SelectValue>
                    {m(WORK_STEPS_DISPLAY_LABELS[settings.workStepsDisplay])}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {WorkStepsDisplay.literals.map((value) => (
                    <SelectItem key={value} value={value}>
                      {m(WORK_STEPS_DISPLAY_LABELS[value])}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <SettingsRow
          {...searchableSetting("work-steps-collapse-timing")}
          description={gt("Choose when to automatically collapse work steps.")}
          resetAction={
            settings.workStepsCollapseTiming !== DEFAULT_UNIFIED_SETTINGS.workStepsCollapseTiming ? (
              <SettingResetButton
                ariaLabel={gt("Reset work steps collapse timing to default")}
                onClick={() =>
                  updateSettings({
                    workStepsCollapseTiming: DEFAULT_UNIFIED_SETTINGS.workStepsCollapseTiming,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-44">
              <Select
                value={settings.workStepsCollapseTiming}
                onValueChange={(value) => {
                  if (isWorkStepsCollapseTiming(value)) {
                    updateSettings({ workStepsCollapseTiming: value });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full min-w-0"
                  aria-label={gt("Work steps collapse timing")}
                >
                  <SelectValue>
                    {m(WORK_STEPS_COLLAPSE_TIMING_LABELS[settings.workStepsCollapseTiming])}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {WorkStepsCollapseTiming.literals.map((value) => (
                    <SelectItem key={value} value={value}>
                      {m(WORK_STEPS_COLLAPSE_TIMING_LABELS[value])}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          }
        />
        {settings.workStepsDisplay !== "expanded" ? (
          <SettingsRow
            {...searchableSetting("collapsed-assistant-reply-mode")}
            description={gt(
              "Choose which assistant replies remain visible after work steps collapse.",
            )}
            resetAction={
              settings.collapsedAssistantReplyMode !==
              DEFAULT_UNIFIED_SETTINGS.collapsedAssistantReplyMode ? (
                <SettingResetButton
                  ariaLabel={gt("Reset replies shown when collapsed to default")}
                  onClick={() =>
                    updateSettings({
                      collapsedAssistantReplyMode:
                        DEFAULT_UNIFIED_SETTINGS.collapsedAssistantReplyMode,
                    })
                  }
                />
              ) : null
            }
            control={
              <div className="w-full sm:w-44">
                <Select
                  value={settings.collapsedAssistantReplyMode}
                  onValueChange={(value) => {
                    if (isCollapsedAssistantReplyMode(value)) {
                      updateSettings({ collapsedAssistantReplyMode: value });
                    }
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full min-w-0"
                    aria-label={gt("Replies shown when collapsed")}
                  >
                    <SelectValue>
                      {m(
                        COLLAPSED_ASSISTANT_REPLY_MODE_LABELS[
                          settings.collapsedAssistantReplyMode
                        ],
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {CollapsedAssistantReplyMode.literals.map((value) => (
                      <SelectItem key={value} value={value}>
                        {m(COLLAPSED_ASSISTANT_REPLY_MODE_LABELS[value])}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            }
          />
        ) : null}
        <AdvancedSettings
          targetIds={[
            searchableSetting("panel-animations").id,
            searchableSetting("composer-context").id,
          ]}
        >
          <SettingsRow
            {...searchableSetting("panel-animations")}
            description={gt("Set how fast panels open and close.")}
            control={
              <div className="grid w-full grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 sm:w-auto sm:grid-cols-[7rem_13rem] sm:gap-4">
                <PanelAnimationsPreview durationMs={settings.panelAnimationDurationMs} />
                <div className="flex w-full items-center gap-3">
                  <output
                    className="min-w-16 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                    htmlFor="panel-animation-duration"
                  >
                    {settings.panelAnimationDurationMs} ms
                  </output>
                  <input
                    aria-label={gt("Panel animation duration")}
                    className="settings-slider min-w-0 flex-1"
                    id="panel-animation-duration"
                    max={MAX_PANEL_ANIMATION_DURATION_MS}
                    min={MIN_PANEL_ANIMATION_DURATION_MS}
                    onChange={(event) => {
                      const panelAnimationDurationMs = Number(event.currentTarget.value);
                      if (
                        Number.isInteger(panelAnimationDurationMs) &&
                        panelAnimationDurationMs >= MIN_PANEL_ANIMATION_DURATION_MS &&
                        panelAnimationDurationMs <= MAX_PANEL_ANIMATION_DURATION_MS
                      ) {
                        updateSettings({ panelAnimationDurationMs });
                      }
                    }}
                    step={25}
                    style={panelAnimationDurationSliderStyle}
                    type="range"
                    value={settings.panelAnimationDurationMs}
                  />
                </div>
              </div>
            }
            resetAction={
              settings.panelAnimationDurationMs !==
              DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs ? (
                <SettingResetButton
                  ariaLabel={gt("Reset panel animations to default")}
                  onClick={() =>
                    updateSettings({
                      panelAnimationDurationMs: DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs,
                    })
                  }
                />
              ) : null
            }
          />
          <SettingsRow
            {...searchableSetting("composer-context")}
            description={gt(
              "Keep branch and worktree controls below the composer after a thread starts.",
            )}
            resetAction={
              settings.persistComposerContextStrip !==
              DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip ? (
                <SettingResetButton
                  ariaLabel={gt("Reset composer context to default")}
                  onClick={() =>
                    updateSettings({
                      persistComposerContextStrip:
                        DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={settings.persistComposerContextStrip}
                onCheckedChange={(checked) =>
                  updateSettings({ persistComposerContextStrip: Boolean(checked) })
                }
                aria-label={gt("Keep composer context visible in active threads")}
              />
            }
          />
        </AdvancedSettings>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
