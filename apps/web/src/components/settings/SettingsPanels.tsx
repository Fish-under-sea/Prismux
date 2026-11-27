import { NotificationSettings } from "./NotificationSettings";
import { PRISMUX_REPOSITORY_URL, PRIVACY_POLICY_URL } from "../../legalLinks";
import { CheckIcon } from "lucide-react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useRef, useState } from "react";
import {
  IDLE_COMPACTION_MODES,
  type IdleCompactionMode,
  globalIdleCompaction,
  type ServerProvider,
  type SidebarProjectGroupingMode,
} from "@prismux/core-contracts";
import {
  CollapsedAssistantReplyMode,
  DEFAULT_UNIFIED_SETTINGS,
  type DiffLayout,
  type EffortDisplay,
  MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  type ResponseStreamingMode,
  type QuitConfirmationMode,
  SidebarProjectSortOrder,
  ScreenReaderAnnouncements,
  WorkStepsCollapseTiming,
  WorkStepsDisplay,
} from "@prismux/core-contracts/settings";
import { pickModelSelection } from "@prismux/core-shared/model";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import { CliCommandSettingsRow } from "./CliCommandSettingsRow";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { isElectron } from "../../env";
import {
  readAppearanceModePreference,
  readThemeHalves,
  readThemePreference,
  useTheme,
} from "../../hooks/useTheme";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useOptionalSettingsScope, useSettingsScope } from "./SettingsScopeContext";
import { scopedIdleCompaction } from "./scopedSettings";
import { ProjectDefaultsSettings } from "./ProjectDefaultsSettings";
import { ThreadDetailsItemsRow } from "./ThreadDetailsItemsRow";
import { ThreadTitleInstructionsSettings } from "./ThreadTitleInstructionsSettings";
import {
  TextGeneratorsController,
  type TextGeneratorsEnvironmentProps,
} from "./TextGeneratorsSettings";
import { SnoozePresetsRow } from "./SnoozePresetsSettings";
import { managedTelemetryOffMessage, usePrimaryManagedPolicy } from "../../state/managedPolicy";
import {
  getTextGenerationModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import { testTextGeneratorModel, useTextGenerationTargets } from "../../textGenerators";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import { isMacPlatform } from "../../lib/utils";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { ScopedSwitch } from "./ScopedSwitch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  autoSettleDaysField,
  cancelAutoSettleDaysField,
  commitAutoSettleDaysField,
  editAutoSettleDaysField,
  failAutoSettleDaysField,
  getChangedBrowserSettingLabels,
  getChangedTypographySettingLabels,
  hasChangedBackgroundActivitySettings,
  isProjectGroupingEnabled,
  projectGroupingModeFromToggle,
  readLastEnabledProjectGroupingMode,
  rememberEnabledProjectGroupingMode,
  syncAutoSettleDaysField,
} from "./SettingsPanels.logic";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSearchTarget,
  SettingsSection,
} from "./settingsLayout";
import { SettingsSegmentedTabs, type SettingsSegmentedTabItem } from "./SettingsSegmentedTabs";
import { useSearchableSetting } from "./settingsSearch";
import { nativeLanguageName, SYSTEM_LANGUAGE } from "@prismux/client-runtime/locales";
import { SUPPORTED_LOCALES } from "../../i18n/locales";
import { BackgroundActivitySettingsRow } from "./BackgroundActivitySettings";
import { AdvancedSettings } from "./AdvancedSettings";
import { PullRequestLinksOpenInAppSetting } from "./IntegrationsSettings";
import { StorageCleanupSections } from "./StorageSettings";
import { DiagnosticsSettingsSections } from "./DiagnosticsSettings";
import { ReasoningTranslationSettingsCard } from "./ReasoningTranslationSettingsCard";
import { PrismuxUpdatesSettingsPage } from "../../prismux/settings/PrismuxUpdatesSettingsPage";

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

export const CHAT_TAB_IDS = {
  composer: "composer",
  display: "display",
  threads: "threads",
} as const;

export const CHAT_TAB_HASH_ANCHORS = {
  composer: [
    "composer",
    "composer-rich-text",
    "send-shortcut",
    "follow-up-behavior",
    "skills-in-slash-menu",
    "composer-context",
    "prompt-suggestions-beta",
    "follow-ups",
  ] as const,
  display: [
    "chat-display",
    "work-steps-display",
    "work-steps-collapse-timing",
    "collapsed-assistant-reply-mode",
    "effort-display",
    "reasoning-translation",
    "math-rendering",
    "thread-details-items",
    "response-streaming",
    "side-thread-open-target",
    "proactive-panels",
    "activity",
    "screen-reader-announcements",
    "screen-reader-window-title",
  ] as const,
  threads: [
    "threads",
    "working-shelf",
    "project-defaults",
    "default-permissions",
    "new-threads",
    "auto-settle",
    "auto-settle-merged-threads",
    "auto-settle-inactive-threads",
    "days-before-auto-settle",
    "keep-threads-with-pull-requests",
    "snooze",
    "snooze-options",
    "usage-limits",
    "auto-resume-limited-threads",
    "snooze-limited-threads",
  ] as const,
} as const;

export const MAINTENANCE_TAB_IDS = {
  runtime: "runtime",
  telemetry: "telemetry",
} as const;

export const MAINTENANCE_TAB_HASH_ANCHORS = {
  runtime: [
    "background",
    "background-activity",
    "keep-awake-while-agents-work",
    "continue-threads-after-server-update",
    "git-fetch-interval",
    "storage-artifacts",
    "storage-delete-now",
  ] as const,
  telemetry: ["telemetry-export", "processes", "storage-treemap"] as const,
} as const;

const RESPONSE_STREAMING_MODE_LABELS: Record<ResponseStreamingMode, string> = {
  turn: msg("Wait for the full response"),
  paragraph: msg("Show finished paragraphs"),
};

const RESPONSE_STREAMING_MODE_DESCRIPTIONS: Record<ResponseStreamingMode, string> = {
  turn: msg("Text appears once the agent finishes its turn."),
  paragraph: msg("Each paragraph or code block appears as soon as it is complete."),
};

const SIDEBAR_PROJECT_SORT_ORDER_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: msg("Last user message"),
  created_at: msg("Created at"),
  manual: msg("Manual"),
};
const isSidebarProjectSortOrder = Schema.is(SidebarProjectSortOrder);

const TIMESTAMP_FORMAT_LABELS = {
  locale: msg("System default"),
  "12-hour": msg("12-hour"),
  "24-hour": msg("24-hour"),
};

const DIFF_LAYOUT_LABELS: Record<DiffLayout, string> = {
  stacked: msg("Stacked", { $context: "diff layout" }),
  split: msg("Split", { $context: "diff layout" }),
};

const QUIT_CONFIRMATION_MODE_LABELS: Record<QuitConfirmationMode, string> = {
  direct: msg("Direct"),
  hold: msg("Hold"),
  "double-click": msg("Double press"),
};

export function useSettingsRestore(onRestored?: () => void) {
  const messages = useMessages();
  const gt = useGT();
  const {
    theme,
    setTheme,
    followSystem,
    setFollowSystem,
    setThemeHalf,
    clearThemeHalves,
    themeHalves,
  } = useTheme();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const isBackgroundActivityDirty = hasChangedBackgroundActivitySettings(settings);

  const changedSettingLabels = [
    ...(theme !== "system" ? [gt("Theme")] : []),
    ...(!followSystem ? [gt("Follow system")] : []),
    ...(themeHalves !== null ? [gt("Theme mix")] : []),
    ...(settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity
      ? [gt("Glass opacity")]
      : []),
    ...(settings.diffColorScheme !== DEFAULT_UNIFIED_SETTINGS.diffColorScheme
      ? [gt("Diff colors")]
      : []),
    ...(settings.effortDisplay !== DEFAULT_UNIFIED_SETTINGS.effortDisplay
      ? [gt("Effort display")]
      : []),
    ...(settings.reasoningTranslationProvider !==
    DEFAULT_UNIFIED_SETTINGS.reasoningTranslationProvider
      ? [gt("Reasoning translation")]
      : []),
    ...(settings.mathRenderingEnabled !== DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled
      ? [gt("Render math")]
      : []),
    ...(settings.workStepsDisplay !== DEFAULT_UNIFIED_SETTINGS.workStepsDisplay
      ? [gt("Work steps display")]
      : []),
    ...(settings.workStepsCollapseTiming !== DEFAULT_UNIFIED_SETTINGS.workStepsCollapseTiming
      ? [gt("Work steps collapse timing")]
      : []),
    ...(settings.collapsedAssistantReplyMode !==
    DEFAULT_UNIFIED_SETTINGS.collapsedAssistantReplyMode
      ? [gt("Replies shown when collapsed")]
      : []),
    ...(settings.panelAnimationDurationMs !== DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs
      ? [gt("Panel animations")]
      : []),
    ...(settings.environmentIdentificationMode !==
    DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode
      ? [gt("Environment identification")]
      : []),
    ...(settings.language !== DEFAULT_UNIFIED_SETTINGS.language ? [gt("Language")] : []),
    ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
      ? [gt("Time format")]
      : []),
    ...(settings.notificationMode !== DEFAULT_UNIFIED_SETTINGS.notificationMode
      ? [gt("Thread notifications")]
      : []),
    ...(settings.inAppNotificationsEnabled !== DEFAULT_UNIFIED_SETTINGS.inAppNotificationsEnabled
      ? [gt("In-app notifications")]
      : []),
    ...(settings.sidebarProjectGroupingMode !== DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode
      ? [gt("Project Grouping")]
      : []),
    ...(settings.sidebarProjectSortOrder !== DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder
      ? [gt("Project order")]
      : []),
    ...(settings.sidebarWorkingShelfEnabled !== DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled
      ? [gt("Working section")]
      : []),
    ...(settings.sidebarAutoSettleAfterDays !== DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays
      ? [gt("Auto-settle inactive threads")]
      : []),
    ...(settings.sidebarAutoSettleKeepPullRequests !==
    DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleKeepPullRequests
      ? [gt("Keep threads with a PR")]
      : []),
    ...(settings.sidebarAutoSettleOnMerge !== DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge
      ? [gt("Auto-settle merged threads")]
      : []),
    ...(settings.autoResumeLimitedThreads !== DEFAULT_UNIFIED_SETTINGS.autoResumeLimitedThreads
      ? [gt("Resume after usage limits")]
      : []),
    ...(settings.snoozeLimitedThreads !== DEFAULT_UNIFIED_SETTINGS.snoozeLimitedThreads
      ? [gt("Snooze until limits reset")]
      : []),
    ...(!Equal.equals(settings.snoozePresets, DEFAULT_UNIFIED_SETTINGS.snoozePresets)
      ? [gt("Snooze options")]
      : []),
    ...(settings.wordWrap !== DEFAULT_UNIFIED_SETTINGS.wordWrap ? [gt("Word wrap")] : []),
    ...(settings.persistComposerContextStrip !==
    DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip
      ? [gt("Composer context")]
      : []),
    ...getChangedTypographySettingLabels(settings, messages),
    ...(settings.diffFilesCollapsed !== DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed
      ? [gt("Default diff file state")]
      : []),
    ...(settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace
      ? [gt("Diff whitespace changes")]
      : []),
    ...(settings.diffLayout !== DEFAULT_UNIFIED_SETTINGS.diffLayout ? [gt("Diff layout")] : []),
    ...(settings.proactivePanelsEnabled !== DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled
      ? [gt("Open pull requests and changes panels proactively")]
      : []),
    ...(settings.showSkillsInSlashMenu !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu
      ? [gt("Show skills in slash menu")]
      : []),
    ...(settings.composerRichTextEnabled !== DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled
      ? [gt("Rich text composer")]
      : []),
    ...(settings.sendShortcut !== DEFAULT_UNIFIED_SETTINGS.sendShortcut
      ? [gt("Send shortcut")]
      : []),
    ...(settings.followUpBehavior !== DEFAULT_UNIFIED_SETTINGS.followUpBehavior
      ? [gt("Follow-up behavior")]
      : []),
    ...(settings.sideThreadOpenTarget !== DEFAULT_UNIFIED_SETTINGS.sideThreadOpenTarget
      ? [gt("Open subagents and side chats in")]
      : []),
    ...(settings.screenReaderAnnouncements !== DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements
      ? [gt("Screen reader announcements")]
      : []),
    ...(settings.screenReaderWindowTitle !== DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle
      ? [gt("Screen reader window title")]
      : []),
    ...(settings.responseStreamingMode !== DEFAULT_UNIFIED_SETTINGS.responseStreamingMode
      ? [gt("Response streaming")]
      : []),
    ...(settings.enableProviderUpdateChecks !== DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks
      ? [gt("Provider update checks")]
      : []),
    ...(settings.continueThreadsAfterServerUpdate !==
    DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate
      ? [gt("Continue threads after restarts")]
      : []),
    ...(isBackgroundActivityDirty ? [gt("Background activity")] : []),
    ...(settings.keepAwakeWhileAgentsWork !== DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork
      ? [gt("Keep awake while agents work")]
      : []),
    ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
      ? [gt("New thread mode")]
      : []),
    ...(settings.newWorktreesStartFromOrigin !==
    DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin
      ? [gt("New worktrees start from remote")]
      : []),
    ...(settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
      ? [gt("Add project base directory")]
      : []),
    ...(settings.ghqCloneLayout !== DEFAULT_UNIFIED_SETTINGS.ghqCloneLayout
      ? [gt("Clone into host folders")]
      : []),
    ...(settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin
      ? [gt("Unpin confirmation")]
      : []),
    ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
      ? [gt("Archive confirmation")]
      : []),
    ...(settings.confirmTerminalClose !== DEFAULT_UNIFIED_SETTINGS.confirmTerminalClose
      ? [gt("Terminal close confirmation")]
      : []),
    ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
      ? [gt("Delete confirmation")]
      : []),
    ...(settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit ? [gt("Quit shortcut")] : []),
    ...(isTextGenerationModelDirty ? [gt("Text generation model")] : []),
    ...(settings.defaultReasoningEffort !== DEFAULT_UNIFIED_SETTINGS.defaultReasoningEffort
      ? [gt("Default reasoning effort")]
      : []),
    ...(settings.threadTitleInstructions !== DEFAULT_UNIFIED_SETTINGS.threadTitleInstructions
      ? [gt("Thread title instructions")]
      : []),
    ...getChangedBrowserSettingLabels(settings, messages),
    ...(settings.enableAgentBrowserAccess !== DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess
      ? [gt("Agent browser access")]
      : []),
  ];

  const restoreDefaults = async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readLocalApi();
    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
      [
        gt("Restore default settings?"),
        gt("This will reset: {settings}.", { settings: changedSettingLabels.join(", ") }),
      ].join("\n"),
      { variant: "destructive" },
    );
    if (!confirmed) return;

    // Reset only dirty theme keys so storage failures cannot block other settings; re-read after confirmation
    // for safe rollback.
    let previousTheme = theme;
    try {
      previousTheme = readThemePreference();
    } catch {}
    const liveHalves = readThemeHalves();
    const needsThemeReset = previousTheme !== "system";
    const needsMixReset = liveHalves !== null;
    const needsFollowSystemReset = readAppearanceModePreference(previousTheme) !== "system";
    const notifyThemeRestoreFailure = () => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Couldn’t restore theme settings"),
          description: gt("Try again."),
        }),
      );
    };
    // Restore the base preference before the mix because restoring the base clears the mix.
    const previousHalves = liveHalves;
    const rollbackThemeState = () => {
      if (needsThemeReset) setTheme(previousTheme);
      if (previousHalves?.light) setThemeHalf("light", previousHalves.light);
      if (previousHalves?.dark) setThemeHalf("dark", previousHalves.dark);
    };
    if (needsThemeReset && !setTheme("system")) {
      notifyThemeRestoreFailure();
      return;
    }
    if (needsMixReset && !clearThemeHalves()) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    if (needsFollowSystemReset && !setFollowSystem(true)) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    updateSettings({
      diffColorScheme: DEFAULT_UNIFIED_SETTINGS.diffColorScheme,
      effortDisplay: DEFAULT_UNIFIED_SETTINGS.effortDisplay,
      reasoningTranslationProvider: DEFAULT_UNIFIED_SETTINGS.reasoningTranslationProvider,
      mathRenderingEnabled: DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled,
      workStepsDisplay: DEFAULT_UNIFIED_SETTINGS.workStepsDisplay,
      workStepsCollapseTiming: DEFAULT_UNIFIED_SETTINGS.workStepsCollapseTiming,
      collapsedAssistantReplyMode: DEFAULT_UNIFIED_SETTINGS.collapsedAssistantReplyMode,
      language: DEFAULT_UNIFIED_SETTINGS.language,
      timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
      notificationMode: DEFAULT_UNIFIED_SETTINGS.notificationMode,
      inAppNotificationsEnabled: DEFAULT_UNIFIED_SETTINGS.inAppNotificationsEnabled,
      wordWrap: DEFAULT_UNIFIED_SETTINGS.wordWrap,
      persistComposerContextStrip: DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip,
      diffFilesCollapsed: DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed,
      diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
      diffLayout: DEFAULT_UNIFIED_SETTINGS.diffLayout,
      proactivePanelsEnabled: DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled,
      showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
      composerRichTextEnabled: DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled,
      sendShortcut: DEFAULT_UNIFIED_SETTINGS.sendShortcut,
      followUpBehavior: DEFAULT_UNIFIED_SETTINGS.followUpBehavior,
      sideThreadOpenTarget: DEFAULT_UNIFIED_SETTINGS.sideThreadOpenTarget,
      screenReaderAnnouncements: DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements,
      screenReaderWindowTitle: DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle,
      environmentIdentificationMode: DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode,
      glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity,
      panelAnimationDurationMs: DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs,
      sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
      sidebarProjectSortOrder: DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder,
      sidebarWorkingShelfEnabled: DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled,
      sidebarAutoSettleAfterDays: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays,
      sidebarAutoSettleKeepPullRequests: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleKeepPullRequests,
      sidebarAutoSettleOnMerge: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge,
      autoResumeLimitedThreads: DEFAULT_UNIFIED_SETTINGS.autoResumeLimitedThreads,
      snoozeLimitedThreads: DEFAULT_UNIFIED_SETTINGS.snoozeLimitedThreads,
      snoozePresets: DEFAULT_UNIFIED_SETTINGS.snoozePresets,
      responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
      enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
      continueThreadsAfterServerUpdate: DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate,
      backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
      keepAwakeWhileAgentsWork: DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork,
      backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
      automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
      providerHealthRefreshInterval: DEFAULT_UNIFIED_SETTINGS.providerHealthRefreshInterval,
      defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
      newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
      addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
      ghqCloneLayout: DEFAULT_UNIFIED_SETTINGS.ghqCloneLayout,
      confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
      confirmTerminalClose: DEFAULT_UNIFIED_SETTINGS.confirmTerminalClose,
      confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
      confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
      confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit,
      textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
      defaultReasoningEffort: DEFAULT_UNIFIED_SETTINGS.defaultReasoningEffort,
      threadTitleInstructions: DEFAULT_UNIFIED_SETTINGS.threadTitleInstructions,
      fontFamilySans: DEFAULT_UNIFIED_SETTINGS.fontFamilySans,
      fontFamilyComposer: DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer,
      fontFamilyCode: DEFAULT_UNIFIED_SETTINGS.fontFamilyCode,
      fontFamilyTerminal: DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal,
      fontSizeInterface: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface,
      fontSizePrompt: DEFAULT_UNIFIED_SETTINGS.fontSizePrompt,
      fontSizeCode: DEFAULT_UNIFIED_SETTINGS.fontSizeCode,
      fontSizeTerminal: DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal,
      browserDefaultViewport: DEFAULT_UNIFIED_SETTINGS.browserDefaultViewport,
      browserDefaultZoomFactor: DEFAULT_UNIFIED_SETTINGS.browserDefaultZoomFactor,
      browserDefaultAppearance: DEFAULT_UNIFIED_SETTINGS.browserDefaultAppearance,
      browserRecordingFrameRate: DEFAULT_UNIFIED_SETTINGS.browserRecordingFrameRate,
      browserRecordingShowKeyPresses: DEFAULT_UNIFIED_SETTINGS.browserRecordingShowKeyPresses,
      browserRecordingShowMousePresses: DEFAULT_UNIFIED_SETTINGS.browserRecordingShowMousePresses,
      browserLinkTarget: DEFAULT_UNIFIED_SETTINGS.browserLinkTarget,
      browserSearchEngine: DEFAULT_UNIFIED_SETTINGS.browserSearchEngine,
      browserCustomSearchUrl: DEFAULT_UNIFIED_SETTINGS.browserCustomSearchUrl,
      browserAutoShowFloatingPreview: DEFAULT_UNIFIED_SETTINGS.browserAutoShowFloatingPreview,
      pullRequestLinksOpenInApp: DEFAULT_UNIFIED_SETTINGS.pullRequestLinksOpenInApp,
      enableAgentBrowserAccess: DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess,
    });
    onRestored?.();
  };

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

const AUTO_SETTLE_DEFAULT_DAYS = DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays ?? 7;

function AutoSettleDaysInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (days: number, options: { onFailed: () => void }) => void;
}) {
  const gt = useGT();
  const [stored, setField] = useState(() => autoSettleDaysField(value));
  const field = syncAutoSettleDaysField(stored, value);
  if (field !== stored) setField(field);

  const commit = () => {
    const next = commitAutoSettleDaysField(field);
    setField(next.field);
    if (next.submit === null) return;
    const { revision } = next.field;
    onCommit(next.submit, {
      onFailed: () => setField((current) => failAutoSettleDaysField(current, revision)),
    });
  };

  return (
    <Input
      size="sm"
      type="number"
      min={MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS}
      max={MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS}
      className="w-full sm:w-24"
      value={field.draft}
      onChange={(event) => setField(editAutoSettleDaysField(field, event.target.value))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") commit();
        if (event.key === "Escape" && field.dirty) {
          // An unhandled Escape closes the settings page, and the blur that follows would save.
          event.preventDefault();
          event.stopPropagation();
          setField(cancelAutoSettleDaysField(field));
        }
      }}
      aria-label={gt("Days of inactivity before auto-settle")}
    />
  );
}

export function GeneralSettingsPanel() {
  const gt = useGT();
  const m = useMessages();
  const setting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const lastEnabledProjectGroupingMode = useRef<SidebarProjectGroupingMode>(
    readLastEnabledProjectGroupingMode(),
  );
  const languageValue = SUPPORTED_LOCALES.includes(settings.language)
    ? settings.language
    : SYSTEM_LANGUAGE;

  return (
    <SettingsPageContainer>
      <SettingsSection id="display" title={gt("Display")}>
        <SettingsRow
          {...setting("language")}
          description={<T>System default follows your browser or OS language.</T>}
          resetAction={
            settings.language !== DEFAULT_UNIFIED_SETTINGS.language ? (
              <SettingResetButton
                ariaLabel={gt("Reset language to default")}
                onClick={() =>
                  updateSettings({
                    language: DEFAULT_UNIFIED_SETTINGS.language,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={languageValue}
              onValueChange={(value) => {
                if (value) {
                  updateSettings({ language: value });
                }
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-48" aria-label={gt("Language")}>
                <SelectValue>
                  {languageValue === SYSTEM_LANGUAGE
                    ? m(TIMESTAMP_FORMAT_LABELS.locale)
                    : nativeLanguageName(languageValue)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value={SYSTEM_LANGUAGE}>
                  {m(TIMESTAMP_FORMAT_LABELS.locale)}
                </SelectItem>
                {SUPPORTED_LOCALES.map((locale) => (
                  <SelectItem hideIndicator key={locale} value={locale}>
                    {nativeLanguageName(locale)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...setting("time-format")}
          description={<T>System default follows your browser or OS clock preference.</T>}
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                ariaLabel={gt("Reset time format to default")}
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-48"
                aria-label={gt("Timestamp format")}
              >
                <SelectValue>{m(TIMESTAMP_FORMAT_LABELS[settings.timestampFormat])}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {m(TIMESTAMP_FORMAT_LABELS.locale)}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {m(TIMESTAMP_FORMAT_LABELS["12-hour"])}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {m(TIMESTAMP_FORMAT_LABELS["24-hour"])}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection id="sidebar" title={gt("Sidebar")}>
        <SettingsRow
          {...setting("project-grouping")}
          description={<T>Combine matching repositories across environments.</T>}
          resetAction={
            settings.sidebarProjectGroupingMode !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode ? (
              <SettingResetButton
                ariaLabel={gt("Reset project grouping to default")}
                onClick={() =>
                  updateSettings({
                    sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={isProjectGroupingEnabled(settings.sidebarProjectGroupingMode)}
              onCheckedChange={(checked) => {
                if (!checked && settings.sidebarProjectGroupingMode !== "separate") {
                  lastEnabledProjectGroupingMode.current = settings.sidebarProjectGroupingMode;
                  rememberEnabledProjectGroupingMode(settings.sidebarProjectGroupingMode);
                }
                updateSettings({
                  sidebarProjectGroupingMode: projectGroupingModeFromToggle(
                    checked,
                    lastEnabledProjectGroupingMode.current,
                  ),
                });
              }}
              aria-label={gt("Project grouping")}
            />
          }
        />
        <SettingsRow
          {...setting("project-order")}
          description={<T>Order of projects in the sidebar project picker and command palette.</T>}
          resetAction={
            settings.sidebarProjectSortOrder !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder ? (
              <SettingResetButton
                ariaLabel={gt("Reset project order to default")}
                onClick={() =>
                  updateSettings({
                    sidebarProjectSortOrder: DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sidebarProjectSortOrder}
              onValueChange={(value) => {
                if (isSidebarProjectSortOrder(value)) {
                  updateSettings({ sidebarProjectSortOrder: value });
                }
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-48" aria-label={gt("Project order")}>
                <SelectValue>
                  {m(SIDEBAR_PROJECT_SORT_ORDER_LABELS[settings.sidebarProjectSortOrder])}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {SidebarProjectSortOrder.literals.map((sortOrder) => (
                  <SelectItem hideIndicator key={sortOrder} value={sortOrder}>
                    {m(SIDEBAR_PROJECT_SORT_ORDER_LABELS[sortOrder])}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection id="notifications" title={gt("Notifications")}>
        <NotificationSettings />
        <SettingsRow
          {...setting("in-app-notifications")}
          description={
            <T>
              Show a toast when another thread finishes, fails, or needs input or approval while
              this app has focus.
            </T>
          }
          control={
            <Switch
              checked={settings.inAppNotificationsEnabled}
              onCheckedChange={(checked) => updateSettings({ inAppNotificationsEnabled: checked })}
              aria-label={gt("In-app notifications")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="confirmations" title={gt("Confirmations")}>
        <SettingsRow
          {...setting("unpin-confirmation")}
          description={<T>Ask before unpinning a thread from the pinned section.</T>}
          resetAction={
            settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin ? (
              <SettingResetButton
                ariaLabel={gt("Reset unpin confirmation to default")}
                onClick={() =>
                  updateSettings({
                    confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadUnpin}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadUnpin: Boolean(checked) })
              }
              aria-label={gt("Confirm thread unpinning")}
            />
          }
        />
        <SettingsRow
          {...setting("archive-confirmation")}
          description={
            <T>Require a second click on the inline archive action before a thread is archived.</T>
          }
          resetAction={
            settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
              <SettingResetButton
                ariaLabel={gt("Reset archive confirmation to default")}
                onClick={() =>
                  updateSettings({
                    confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadArchive}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadArchive: Boolean(checked) })
              }
              aria-label={gt("Confirm thread archiving")}
            />
          }
        />
        <SettingsRow
          {...setting("delete-confirmation")}
          description={<T>Ask before deleting a thread and its chat history.</T>}
          resetAction={
            settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
              <SettingResetButton
                ariaLabel={gt("Reset delete confirmation to default")}
                onClick={() =>
                  updateSettings({
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadDelete}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadDelete: Boolean(checked) })
              }
              aria-label={gt("Confirm thread deletion")}
            />
          }
        />
        <SettingsRow
          {...setting("terminal-close-confirmation")}
          description={<T>Ask before closing terminals and stopping their running processes.</T>}
          resetAction={
            settings.confirmTerminalClose !== DEFAULT_UNIFIED_SETTINGS.confirmTerminalClose ? (
              <SettingResetButton
                ariaLabel={gt("Reset terminal close confirmation to default")}
                onClick={() =>
                  updateSettings({
                    confirmTerminalClose: DEFAULT_UNIFIED_SETTINGS.confirmTerminalClose,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmTerminalClose}
              onCheckedChange={(checked) =>
                updateSettings({ confirmTerminalClose: Boolean(checked) })
              }
              aria-label={gt("Confirm terminal closing")}
            />
          }
        />
        {isElectron ? (
          <SettingsRow
            {...setting("quit-confirmation")}
            description={<T>Hold mode also quits on two quick presses.</T>}
            resetAction={
              settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit ? (
                <SettingResetButton
                  ariaLabel={gt("Reset quit shortcut behavior to default")}
                  onClick={() =>
                    updateSettings({ confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.confirmQuit}
                onValueChange={(value) => {
                  if (value === "direct" || value === "hold" || value === "double-click") {
                    updateSettings({ confirmQuit: value });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-48"
                  aria-label={gt("Quit shortcut behavior")}
                >
                  <SelectValue>
                    {m(QUIT_CONFIRMATION_MODE_LABELS[settings.confirmQuit])}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {Object.entries(QUIT_CONFIRMATION_MODE_LABELS).map(([value, label]) => (
                    <SelectItem hideIndicator key={value} value={value}>
                      {m(label)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function ChatSettingsPanel() {
  const setting = useSearchableSetting();
  const messages = useMessages();
  const gt = useGT();
  const modifierLabel = isMacPlatform(navigator.platform) ? "⌘" : "Ctrl";
  const sendShortcutOptions = [
    { value: "enter", label: "Enter" },
    {
      value: "mod-enter-multiline",
      label: gt("{modifierLabel} + Enter for multiline prompts", { modifierLabel }),
    },
    { value: "mod-enter", label: gt("{modifierLabel} + Enter always", { modifierLabel }) },
  ] as const;
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixedResponseStreamingMode = useScopedSettingsMixed(["responseStreamingMode"]);

  const tabs: ReadonlyArray<SettingsSegmentedTabItem> = [
    {
      id: CHAT_TAB_IDS.composer,
      label: gt("Composer & sending"),
      hashAnchors: CHAT_TAB_HASH_ANCHORS.composer,
      content: (
        <SettingsSection id="composer" title={gt("Composer")}>
          <SettingsRow
            {...setting("composer-rich-text")}
            description={gt("Show formatted Markdown as you type.")}
            resetAction={
              settings.composerRichTextEnabled !==
              DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled ? (
                <SettingResetButton
                  ariaLabel={gt("Reset rich text composer to default")}
                  onClick={() =>
                    updateSettings({
                      composerRichTextEnabled: DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={settings.composerRichTextEnabled}
                onCheckedChange={(checked) =>
                  updateSettings({ composerRichTextEnabled: Boolean(checked) })
                }
                aria-label={gt("Rich text composer")}
              />
            }
          />
          <SettingsRow
            {...setting("send-shortcut")}
            description={gt("Choose when Enter sends a prompt or inserts a new line")}
            resetAction={
              settings.sendShortcut !== DEFAULT_UNIFIED_SETTINGS.sendShortcut ? (
                <SettingResetButton
                  ariaLabel={gt("Reset send shortcut to default")}
                  onClick={() =>
                    updateSettings({ sendShortcut: DEFAULT_UNIFIED_SETTINGS.sendShortcut })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.sendShortcut}
                onValueChange={(value) => {
                  const option = sendShortcutOptions.find((option) => option.value === value);
                  if (option) updateSettings({ sendShortcut: option.value });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-60"
                  aria-label={gt("Send shortcut")}
                >
                  <SelectValue>
                    {
                      sendShortcutOptions.find((option) => option.value === settings.sendShortcut)
                        ?.label
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {sendShortcutOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <span className="flex items-center justify-between gap-4">
                        {option.label}
                        {settings.sendShortcut === option.value && <CheckIcon aria-hidden="true" />}
                      </span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
          <SettingsRow
            {...setting("follow-up-behavior")}
            description={
              settings.sendShortcut === "mod-enter-multiline"
                ? gt(
                    "Queue follow-ups while the agent runs or steer the current run. Press {modifier} + Enter for single-line prompts or {modifier} + Shift + Enter for multiline prompts to do the opposite for one message.",
                    { modifier: modifierLabel },
                  )
                : settings.sendShortcut === "mod-enter"
                  ? gt(
                      "Queue follow-ups while the agent runs or steer the current run. Press {modifier} + Shift + Enter to do the opposite for one message.",
                      { modifier: modifierLabel },
                    )
                  : gt(
                      "Queue follow-ups while the agent runs or steer the current run. Press {modifier} + Enter to do the opposite for one message.",
                      { modifier: modifierLabel },
                    )
            }
            resetAction={
              settings.followUpBehavior !== DEFAULT_UNIFIED_SETTINGS.followUpBehavior ? (
                <SettingResetButton
                  ariaLabel={gt("Reset follow-up behavior to default")}
                  onClick={() =>
                    updateSettings({
                      followUpBehavior: DEFAULT_UNIFIED_SETTINGS.followUpBehavior,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.followUpBehavior}
                onValueChange={(value) => {
                  if (value === "queue" || value === "steer") {
                    updateSettings({ followUpBehavior: value });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-56"
                  aria-label={gt("Follow-up behavior")}
                >
                  <SelectValue>
                    {settings.followUpBehavior === "queue" ? gt("Queue") : gt("Steer")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="queue">
                    <T>Queue</T>
                  </SelectItem>
                  <SelectItem value="steer">
                    <T>Steer</T>
                  </SelectItem>
                </SelectPopup>
              </Select>
            }
          />
          <SettingsRow
            serverScoped
            {...setting("prompt-suggestions-beta")}
            settingKeys={["promptSuggestionsEnabled"]}
            description={gt(
              "Show a predicted next message in the empty composer after a Claude or Codex turn. Tab uses it.",
            )}
            control={
              <ScopedSwitch
                settingKeys={["promptSuggestionsEnabled"]}
                checked={settings.promptSuggestionsEnabled}
                onCheckedChange={(checked) =>
                  updateSettings({ promptSuggestionsEnabled: Boolean(checked) })
                }
                aria-label={gt("Suggest next prompt")}
              />
            }
          />
          <AdvancedSettings
            targetIds={[setting("skills-in-slash-menu").id, setting("composer-context").id]}
          >
            <SettingsRow
              {...setting("skills-in-slash-menu")}
              description={gt(
                "Also include skills in the / command menu. Skills always appear when you type $.",
              )}
              resetAction={
                settings.showSkillsInSlashMenu !==
                DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu ? (
                  <SettingResetButton
                    ariaLabel={gt("Reset skills in slash menu to default")}
                    onClick={() =>
                      updateSettings({
                        showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
                      })
                    }
                  />
                ) : null
              }
              control={
                <Switch
                  checked={settings.showSkillsInSlashMenu}
                  onCheckedChange={(checked) =>
                    updateSettings({ showSkillsInSlashMenu: Boolean(checked) })
                  }
                  aria-label={gt("Show skills in slash menu")}
                />
              }
            />
            <SettingsRow
              {...setting("composer-context")}
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
      ),
    },
    {
      id: CHAT_TAB_IDS.display,
      label: gt("Reading & display"),
      hashAnchors: CHAT_TAB_HASH_ANCHORS.display,
      content: (
        <>
          <SettingsSection id="chat-display" title={gt("Interface")}>
            <SettingsRow
              {...setting("work-steps-display")}
              description={gt("Choose how much tool call detail to show.")}
              resetAction={
                settings.workStepsDisplay !== DEFAULT_UNIFIED_SETTINGS.workStepsDisplay ? (
                  <SettingResetButton
                    ariaLabel={gt("Reset work steps display to default")}
                    onClick={() =>
                      updateSettings({
                        workStepsDisplay: DEFAULT_UNIFIED_SETTINGS.workStepsDisplay,
                      })
                    }
                  />
                ) : null
              }
              control={
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
                    className="w-full sm:w-48"
                    aria-label={gt("Work steps display")}
                  >
                    <SelectValue>
                      {messages(WORK_STEPS_DISPLAY_LABELS[settings.workStepsDisplay])}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {WorkStepsDisplay.literals.map((value) => (
                      <SelectItem key={value} value={value}>
                        {messages(WORK_STEPS_DISPLAY_LABELS[value])}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />
            <SettingsRow
              {...setting("work-steps-collapse-timing")}
              description={gt("Choose when to automatically collapse work steps.")}
              resetAction={
                settings.workStepsCollapseTiming !==
                DEFAULT_UNIFIED_SETTINGS.workStepsCollapseTiming ? (
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
                    className="w-full sm:w-48"
                    aria-label={gt("Work steps collapse timing")}
                  >
                    <SelectValue>
                      {messages(
                        WORK_STEPS_COLLAPSE_TIMING_LABELS[settings.workStepsCollapseTiming],
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {WorkStepsCollapseTiming.literals.map((value) => (
                      <SelectItem key={value} value={value}>
                        {messages(WORK_STEPS_COLLAPSE_TIMING_LABELS[value])}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />
            {settings.workStepsDisplay !== "expanded" ? (
              <SettingsRow
                {...setting("collapsed-assistant-reply-mode")}
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
                      className="w-full sm:w-48"
                      aria-label={gt("Replies shown when collapsed")}
                    >
                      <SelectValue>
                        {messages(
                          COLLAPSED_ASSISTANT_REPLY_MODE_LABELS[
                            settings.collapsedAssistantReplyMode
                          ],
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {CollapsedAssistantReplyMode.literals.map((value) => (
                        <SelectItem key={value} value={value}>
                          {messages(COLLAPSED_ASSISTANT_REPLY_MODE_LABELS[value])}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                }
              />
            ) : null}
            <SettingsRow
              {...setting("effort-display")}
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
                <Select
                  value={settings.effortDisplay}
                  onValueChange={(value) => {
                    if (value === "bars" || value === "label")
                      updateSettings({ effortDisplay: value });
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full sm:w-48"
                    aria-label={gt("Effort display")}
                  >
                    <SelectValue>
                      {messages(EFFORT_DISPLAY_LABELS[settings.effortDisplay])}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    <SelectItem value="bars">{gt("Bars (default)")}</SelectItem>
                    <SelectItem value="label">{messages(EFFORT_DISPLAY_LABELS.label)}</SelectItem>
                  </SelectPopup>
                </Select>
              }
            />
            <ReasoningTranslationSettingsCard />
            <SettingsRow
              {...setting("math-rendering")}
              description={gt(
                "Typeset LaTeX math, such as $x^2$ or \\[x^2\\], in messages and Markdown previews.",
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
            <ThreadDetailsItemsRow />
          </SettingsSection>

          <SettingsSection id="follow-ups" title={gt("Display")}>
            <SettingsRow
              {...setting("side-thread-open-target")}
              description={
                settings.sideThreadOpenTarget === "panel"
                  ? gt(
                      "Where a click opens a subagent, a side chat, or a thread on a linked environment. {modifier}-click or middle-click opens it in the main view instead.",
                      { modifier: modifierLabel },
                    )
                  : gt(
                      "Where a click opens a subagent, a side chat, or a thread on a linked environment. {modifier}-click or middle-click opens it in the side panel instead.",
                      { modifier: modifierLabel },
                    )
              }
              resetAction={
                settings.sideThreadOpenTarget !== DEFAULT_UNIFIED_SETTINGS.sideThreadOpenTarget ? (
                  <SettingResetButton
                    ariaLabel={gt("Reset where subagents and side chats open to default")}
                    onClick={() =>
                      updateSettings({
                        sideThreadOpenTarget: DEFAULT_UNIFIED_SETTINGS.sideThreadOpenTarget,
                      })
                    }
                  />
                ) : null
              }
              control={
                <Select
                  value={settings.sideThreadOpenTarget}
                  onValueChange={(value) => {
                    if (value === "panel" || value === "main") {
                      updateSettings({ sideThreadOpenTarget: value });
                    }
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full sm:w-48"
                    aria-label={gt("Open subagents and side chats in")}
                  >
                    <SelectValue>
                      {settings.sideThreadOpenTarget === "panel"
                        ? gt("Side panel")
                        : gt("Main view")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    <SelectItem value="panel">
                      <T>Side panel</T>
                    </SelectItem>
                    <SelectItem value="main">
                      <T>Main view</T>
                    </SelectItem>
                  </SelectPopup>
                </Select>
              }
            />
            <SettingsRow
              serverScoped
              settingKeys={["responseStreamingMode"]}
              {...setting("response-streaming")}
              description={
                mixedResponseStreamingMode
                  ? gt("The selected targets use different streaming modes.")
                  : messages(RESPONSE_STREAMING_MODE_DESCRIPTIONS[settings.responseStreamingMode])
              }
              resetAction={
                settings.responseStreamingMode !==
                DEFAULT_UNIFIED_SETTINGS.responseStreamingMode ? (
                  <SettingResetButton
                    ariaLabel={gt("Reset response streaming to default")}
                    onClick={() =>
                      updateSettings({
                        responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
                      })
                    }
                  />
                ) : null
              }
              control={
                <Select
                  value={mixedResponseStreamingMode ? null : settings.responseStreamingMode}
                  onValueChange={(value) => {
                    if (value === "turn" || value === "paragraph") {
                      updateSettings({ responseStreamingMode: value });
                    }
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full sm:w-60"
                    aria-label={gt("Response streaming")}
                  >
                    <SelectValue>
                      {(value: ResponseStreamingMode | null) =>
                        value === null
                          ? gt("Mixed")
                          : messages(RESPONSE_STREAMING_MODE_LABELS[value])
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    <SelectItem hideIndicator value="turn">
                      {messages(RESPONSE_STREAMING_MODE_LABELS.turn)}
                    </SelectItem>
                    <SelectItem hideIndicator value="paragraph">
                      {messages(RESPONSE_STREAMING_MODE_LABELS.paragraph)}
                    </SelectItem>
                  </SelectPopup>
                </Select>
              }
            />
            <SettingsRow
              {...setting("proactive-panels")}
              description={gt(
                "Open linked pull requests first. Otherwise, open Changes for edits to at least 3 files or 50 lines.",
              )}
              resetAction={
                settings.proactivePanelsEnabled !==
                DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled ? (
                  <SettingResetButton
                    ariaLabel={gt("Reset proactive panels to default")}
                    onClick={() =>
                      updateSettings({
                        proactivePanelsEnabled: DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled,
                      })
                    }
                  />
                ) : null
              }
              control={
                <Switch
                  checked={settings.proactivePanelsEnabled}
                  onCheckedChange={(checked) =>
                    updateSettings({ proactivePanelsEnabled: Boolean(checked) })
                  }
                  aria-label={gt("Open pull requests and changes panels proactively")}
                />
              }
            />
            <AdvancedSettings
              targetIds={[
                setting("screen-reader-announcements").id,
                setting("screen-reader-window-title").id,
              ]}
            >
              <ScreenReaderAnnouncementsRow />
              <ScreenReaderWindowTitleRow />
            </AdvancedSettings>
          </SettingsSection>
        </>
      ),
    },
    {
      id: CHAT_TAB_IDS.threads,
      label: gt("Threads & default behavior"),
      hashAnchors: CHAT_TAB_HASH_ANCHORS.threads,
      content: (
        <div id="threads" className="flex flex-col gap-7">
          <ThreadsSettingsSections />
        </div>
      ),
    },
  ];

  return (
    <SettingsPageContainer
      searchTargetFallbacks={{
        snooze: "snooze-options",
        "usage-limits": "auto-resume-limited-threads",
      }}
    >
      <SettingsSegmentedTabs
        tabs={tabs}
        defaultTabId={CHAT_TAB_IDS.composer}
        ariaLabel={gt("Chat and thread settings sections")}
      />
    </SettingsPageContainer>
  );
}

const SCREEN_READER_ANNOUNCEMENTS_LABELS: Record<ScreenReaderAnnouncements, string> = {
  status: msg("Status only"),
  messages: msg("Status and messages"),
  everything: msg("Everything"),
};

const isScreenReaderAnnouncements = Schema.is(ScreenReaderAnnouncements);

function ScreenReaderAnnouncementsRow() {
  const messages = useMessages();
  const setting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...setting("screen-reader-announcements")}
      description={gt(
        "What a screen reader hears from the open thread: a turn starting, needing you, and ending. Status and messages adds what the agent writes before its last message. Everything adds each step.",
      )}
      resetAction={
        settings.screenReaderAnnouncements !==
        DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements ? (
          <SettingResetButton
            ariaLabel={gt("Reset screen reader announcements to default")}
            onClick={() =>
              updateSettings({
                screenReaderAnnouncements: DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements,
              })
            }
          />
        ) : null
      }
      control={
        <Select
          value={settings.screenReaderAnnouncements}
          onValueChange={(value) => {
            if (isScreenReaderAnnouncements(value)) {
              updateSettings({ screenReaderAnnouncements: value });
            }
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-48"
            aria-label={gt("Screen reader announcements")}
          >
            <SelectValue>
              {messages(SCREEN_READER_ANNOUNCEMENTS_LABELS[settings.screenReaderAnnouncements])}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {ScreenReaderAnnouncements.literals.map((value) => (
              <SelectItem key={value} value={value}>
                {messages(SCREEN_READER_ANNOUNCEMENTS_LABELS[value])}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function ScreenReaderWindowTitleRow() {
  const setting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...setting("screen-reader-window-title")}
      description={gt(
        "Start the window title with the thread's status, like Needs approval, and its name, so screen readers read them first when you switch apps. Taskbars, shared screens, and time trackers see it too.",
      )}
      resetAction={
        settings.screenReaderWindowTitle !== DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle ? (
          <SettingResetButton
            ariaLabel={gt("Reset screen reader window title to default")}
            onClick={() =>
              updateSettings({
                screenReaderWindowTitle: DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle,
              })
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.screenReaderWindowTitle}
          onCheckedChange={(checked) => updateSettings({ screenReaderWindowTitle: checked })}
          aria-label={gt("Screen reader window title")}
        />
      }
    />
  );
}

function DiffColorsSettingsRow() {
  const setting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...setting("diff-color-scheme")}
      description={gt("Choose colors for additions and deletions, including change counts.")}
      resetAction={
        settings.diffColorScheme !== DEFAULT_UNIFIED_SETTINGS.diffColorScheme ? (
          <SettingResetButton
            ariaLabel={gt("Reset diff colors to default")}
            onClick={() =>
              updateSettings({ diffColorScheme: DEFAULT_UNIFIED_SETTINGS.diffColorScheme })
            }
          />
        ) : null
      }
      control={
        <Select
          value={settings.diffColorScheme}
          onValueChange={(value) => {
            if (value === "red-green" || value === "blue-orange")
              updateSettings({ diffColorScheme: value });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-48" aria-label={gt("Diff colors")}>
            <span
              aria-hidden="true"
              className={
                settings.diffColorScheme === "blue-orange"
                  ? "flex shrink-0 flex-row-reverse gap-1"
                  : "flex shrink-0 gap-1"
              }
            >
              <span className="size-2 rounded-full bg-diff-deletion" />
              <span className="size-2 rounded-full bg-diff-addition" />
            </span>
            <SelectValue>
              {settings.diffColorScheme === "blue-orange" ? gt("Blue & orange") : gt("Red & green")}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem value="red-green">
              <T>Red & green (default)</T>
            </SelectItem>
            <SelectItem value="blue-orange">
              <T>Blue & orange</T>
            </SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );
}

export function DiffsSettingsSections() {
  const messages = useMessages();
  const setting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  return (
    <>
      <SettingsSection id="diffs-display" title={gt("Diffs")}>
        <SettingsRow
          {...setting("diff-layout")}
          description={gt(
            "Show diffs stacked or side by side. The toggle in the diff toolbar changes this too.",
          )}
          resetAction={
            settings.diffLayout !== DEFAULT_UNIFIED_SETTINGS.diffLayout ? (
              <SettingResetButton
                ariaLabel={gt("Reset diff layout to default")}
                onClick={() => updateSettings({ diffLayout: DEFAULT_UNIFIED_SETTINGS.diffLayout })}
              />
            ) : null
          }
          control={
            <Select
              value={settings.diffLayout}
              onValueChange={(value) => {
                if (value === "stacked" || value === "split") {
                  updateSettings({ diffLayout: value });
                }
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-48" aria-label={gt("Diff layout")}>
                <SelectValue>{messages(DIFF_LAYOUT_LABELS[settings.diffLayout])}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="stacked">
                  {messages(DIFF_LAYOUT_LABELS.stacked)}
                </SelectItem>
                <SelectItem hideIndicator value="split">
                  {messages(DIFF_LAYOUT_LABELS.split)}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...setting("hide-whitespace-changes")}
          description={gt("Set whether the diff panel ignores whitespace-only edits by default.")}
          resetAction={
            settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace ? (
              <SettingResetButton
                ariaLabel={gt("Reset diff whitespace changes to default")}
                onClick={() =>
                  updateSettings({
                    diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffIgnoreWhitespace}
              onCheckedChange={(checked) =>
                updateSettings({ diffIgnoreWhitespace: Boolean(checked) })
              }
              aria-label={gt("Hide whitespace changes by default")}
            />
          }
        />
        <SettingsRow
          {...setting("default-diff-file-state")}
          description={gt(
            "Start with files expanded or collapsed when opening diffs or a pull request's Code tab.",
          )}
          resetAction={
            settings.diffFilesCollapsed !== DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed ? (
              <SettingResetButton
                ariaLabel={gt("Reset default diff file state to default")}
                onClick={() =>
                  updateSettings({
                    diffFilesCollapsed: DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.diffFilesCollapsed ? "collapsed" : "expanded"}
              onValueChange={(value) => {
                if (value === "expanded" || value === "collapsed") {
                  updateSettings({ diffFilesCollapsed: value === "collapsed" });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-48"
                aria-label={gt("Default diff file state")}
              >
                <SelectValue>
                  {settings.diffFilesCollapsed ? gt("Collapsed") : gt("Expanded")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="expanded">
                  <T>Expanded</T>
                </SelectItem>
                <SelectItem hideIndicator value="collapsed">
                  <T>Collapsed</T>
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <DiffColorsSettingsRow />
      </SettingsSection>

      <SettingsSection id="pull-requests" title={gt("Pull requests")}>
        <PullRequestLinksOpenInAppSetting />
      </SettingsSection>
    </>
  );
}

export function DiffsSettingsPanel() {
  return (
    <SettingsPageContainer>
      <DiffsSettingsSections />
    </SettingsPageContainer>
  );
}

/** The Providers panel can render without a settings scope, as its tests do; this row needs one. */
export function ProviderUpdateChecksRow() {
  return useOptionalSettingsScope() === null ? null : <ScopedProviderUpdateChecksRow />;
}

function ScopedProviderUpdateChecksRow() {
  const setting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsRow
      serverScoped
      settingKeys={["enableProviderUpdateChecks"]}
      {...setting("provider-update-checks")}
      description={gt(
        "Check installed provider CLIs for newer available versions and fetch model catalog updates. When off, new models may not appear.",
      )}
      resetAction={
        settings.enableProviderUpdateChecks !==
        DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks ? (
          <SettingResetButton
            ariaLabel={gt("Reset provider update checks to default")}
            onClick={() =>
              updateSettings({
                enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
              })
            }
          />
        ) : null
      }
      control={
        <ScopedSwitch
          settingKeys={["enableProviderUpdateChecks"]}
          checked={settings.enableProviderUpdateChecks}
          onCheckedChange={(checked) =>
            updateSettings({ enableProviderUpdateChecks: Boolean(checked) })
          }
          aria-label={gt("Check provider versions")}
        />
      }
    />
  );
}

/** The Providers panel can render without a settings scope, as its tests do; this row needs one. */
export function CompactIdleThreadsRow() {
  return useOptionalSettingsScope() === null ? null : <ScopedCompactIdleThreadsRow />;
}

const IDLE_COMPACTION_MODE_LABELS: Record<IdleCompactionMode, string> = {
  onReturn: msg("When you return"),
  beforeCacheExpires: msg("Before the cache expires (beta)"),
  off: msg("Never", { $context: "idle thread compaction mode" }),
};

function ScopedCompactIdleThreadsRow() {
  const setting = useSearchableSetting();
  const gt = useGT();
  const messages = useMessages();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { targets } = useSettingsScope();
  const idleCompaction = scopedIdleCompaction(targets.length > 0 ? targets : [{ settings }]);

  return (
    <SettingsRow
      serverScoped
      settingKeys={["idleCompaction", "compactIdleThreads"]}
      mixed={idleCompaction.mixed}
      {...setting("compact-idle-threads")}
      description={gt(
        "When to compact an idle Claude thread over 200,000 tokens: after you return, just before its prompt cache expires, or never. Each Claude provider can override this.",
      )}
      resetAction={
        globalIdleCompaction(settings) !== globalIdleCompaction(DEFAULT_UNIFIED_SETTINGS) ? (
          <SettingResetButton
            ariaLabel={gt("Reset compact idle threads to default")}
            onClick={() =>
              updateSettings({ idleCompaction: globalIdleCompaction(DEFAULT_UNIFIED_SETTINGS) })
            }
          />
        ) : null
      }
      control={
        <Select
          value={idleCompaction.mixed ? null : globalIdleCompaction(settings)}
          onValueChange={(value) => {
            const mode = IDLE_COMPACTION_MODES.find((candidate) => candidate.value === value);
            if (mode) updateSettings({ idleCompaction: mode.value });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-48"
            aria-label={gt("Compact idle threads")}
          >
            <SelectValue>
              {(value: string | null) =>
                value === null
                  ? gt("Mixed")
                  : IDLE_COMPACTION_MODES.some((mode) => mode.value === value)
                    ? messages(IDLE_COMPACTION_MODE_LABELS[value as IdleCompactionMode])
                    : undefined
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {IDLE_COMPACTION_MODES.map((mode) => (
              <SelectItem
                hideIndicator
                key={mode.value}
                value={mode.value}
                // A server from before modes has only the on/off switch, so it cannot store "Never".
                disabled={mode.value === "off" && !idleCompaction.neverAvailable}
              >
                {messages(IDLE_COMPACTION_MODE_LABELS[mode.value])}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

/** The Agent configurator panel can render without a settings scope, as its tests do; this section needs one. */
export function TextGenerationSettingsSection({
  textGeneratorsEnvironment,
}: {
  readonly textGeneratorsEnvironment?: TextGeneratorsEnvironmentProps | null | undefined;
} = {}) {
  return useOptionalSettingsScope() === null ? null : (
    <ScopedTextGenerationSettingsSection textGeneratorsEnvironment={textGeneratorsEnvironment} />
  );
}

const NO_TEXT_GENERATION_AGENT_PROVIDERS: ReadonlyArray<ServerProvider> = [];

function ScopedTextGenerationSettingsSection({
  textGeneratorsEnvironment,
}: {
  readonly textGeneratorsEnvironment?: TextGeneratorsEnvironmentProps | null | undefined;
}) {
  const setting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { environment, connectedEnvironments, target } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const hasServerTargets = connectedEnvironments.length > 0;

  // Text generation is strictly standalone API text generators (never coding agents).
  const textGenerationTargets = useTextGenerationTargets({
    environmentId,
    settings,
    providers: NO_TEXT_GENERATION_AGENT_PROVIDERS,
    projectId: target?.projectId ?? null,
    selections: [settings.textGenerationModelSelection],
  });
  const textGenerationProviders = textGenerationTargets.providers;
  const textGenerationModelSelection = resolveAppModelSelectionState(
    settings,
    textGenerationProviders,
  );
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const textGenModel = textGenerationModelSelection.model;
  const textGenerationModelInstanceEntries = textGenerationTargets.entries;
  const hasTextGenerationProvider = textGenerationModelInstanceEntries.some(
    (entry) => entry.enabled && entry.isAvailable,
  );
  const textGenInstanceEntry = textGenerationModelInstanceEntries.find(
    (entry) => entry.instanceId === textGenInstanceId,
  );
  const textGenerationModelOptionsByInstance = getTextGenerationModelOptionsByInstance(
    settings,
    textGenerationProviders,
    textGenInstanceId,
    textGenModel,
  );
  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const textGenerationModelDisabledReason = useScopedModelDisabledReason(
    settings,
    textGenerationModelInstanceEntries,
    true,
  );
  const mixedTextGenerationModel = useScopedSettingsMixed(["textGenerationModelSelection"]);

  const [testingModel, setTestingModel] = useState(false);
  const [testResult, setTestResult] = useState<{
    readonly key: string;
    readonly error: string | null;
  } | null>(null);
  const testKey = `${textGenInstanceId}:${textGenModel}`;
  const shownTestResult = testResult?.key === testKey ? testResult : null;
  const canTestSelectedApi =
    environmentId !== null &&
    textGenInstanceEntry !== undefined &&
    textGenModel.length > 0 &&
    Object.hasOwn(settings.textGenerators, textGenInstanceId);
  const handleTestSelectedApi = async () => {
    if (!environmentId || !canTestSelectedApi || testingModel) return;
    setTestingModel(true);
    const error = await testTextGeneratorModel(environmentId, textGenInstanceId, textGenModel);
    setTestingModel(false);
    setTestResult({ key: testKey, error });
  };

  const renderSection = (parts?: {
    readonly addAction: ReactNode;
    readonly generatorRows: ReadonlyArray<ReactNode>;
    readonly generatorCount: number;
    readonly hasEnabledGenerator: boolean;
  }) => {
    const modelRow = (
      <SettingsRow
        serverScoped
        settingKeys={["textGenerationModelSelection"]}
        {...setting("text-generation-model")}
        description={
          hasTextGenerationProvider
            ? gt("For thread titles and other generated text. Source control has its own setting.")
            : gt(
                "Add a model API to write thread titles, commit messages, and other short text without starting a coding agent.",
              )
        }
        status={
          shownTestResult?.error ? (
            <span role="alert" className="text-destructive">
              {shownTestResult.error}
            </span>
          ) : shownTestResult ? (
            <span role="status">
              <T>
                <Var>{textGenModel}</Var> answered. It works.
              </T>
            </span>
          ) : undefined
        }
        resetAction={
          hasServerTargets && hasTextGenerationProvider && isTextGenerationModelDirty ? (
            <SettingResetButton
              ariaLabel={gt("Reset text generation model to default")}
              onClick={() =>
                updateSettings({
                  textGenerationModelSelection:
                    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                })
              }
            />
          ) : null
        }
        control={
          !hasServerTargets ? (
            <span className="text-sm text-muted-foreground">
              <T>Connect an environment to choose its text generation model.</T>
            </span>
          ) : !hasTextGenerationProvider ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-xs text-muted-foreground">
                {parts && parts.generatorCount > 0
                  ? gt("No text generation providers available.")
                  : gt("No text generators yet")}
              </span>
              {parts && parts.generatorCount === 0 ? parts.addAction : null}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                environmentId={environmentId}
                activeInstanceId={textGenInstanceId}
                model={textGenModel}
                lockedProvider={null}
                instanceEntries={textGenerationModelInstanceEntries}
                modelOptionsByInstance={textGenerationModelOptionsByInstance}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                {...(mixedTextGenerationModel ? { triggerLabel: gt("Mixed") } : {})}
                getModelDisabledReason={textGenerationModelDisabledReason}
                onInstanceModelChange={(instanceId, model) => {
                  const reason = textGenerationModelDisabledReason(instanceId, model);
                  if (reason) {
                    toastManager.add({
                      type: "error",
                      title: gt("Text generation model not saved"),
                      description: reason,
                    });
                    return;
                  }
                  updateSettings({
                    textGenerationModelSelection: pickModelSelection(
                      textGenerationModelSelection,
                      instanceId,
                      model,
                    ),
                  });
                }}
              />
              {canTestSelectedApi ? (
                <Button
                  size="xs"
                  variant="outline"
                  aria-busy={testingModel}
                  disabled={testingModel}
                  onClick={() => void handleTestSelectedApi()}
                >
                  <span className="relative">
                    <span className={testingModel ? "invisible" : undefined}>
                      <T>Test</T>
                    </span>
                    {testingModel ? (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <Spinner />
                      </span>
                    ) : null}
                  </span>
                </Button>
              ) : null}
            </div>
          )
        }
      />
    );

    return (
      <SettingsSection id="text-generation" title={gt("Text generation")}>
        {parts && parts.generatorCount === 0 ? (
          <SettingsSearchTarget {...setting("text-generators")}>{modelRow}</SettingsSearchTarget>
        ) : (
          modelRow
        )}
        {parts && parts.generatorCount > 0 ? (
          <SettingsSearchTarget
            {...setting("text-generators")}
            className="divide-y divide-border/50"
          >
            <div className="flex items-center justify-between gap-3 bg-muted/15 px-3 py-2 sm:px-4">
              <span className="text-xs font-medium text-muted-foreground">
                {gt("Text generators")}
              </span>
              {parts.addAction}
            </div>
            {parts.generatorRows}
          </SettingsSearchTarget>
        ) : null}
        <AdvancedSettings targetIds={[setting("thread-title-instructions").id]}>
          <ThreadTitleInstructionsSettings />
        </AdvancedSettings>
      </SettingsSection>
    );
  };

  if (textGeneratorsEnvironment) {
    return (
      <TextGeneratorsController
        key={`text-generators:${textGeneratorsEnvironment.environmentId}`}
        {...textGeneratorsEnvironment}
      >
        {(parts) => renderSection(parts)}
      </TextGeneratorsController>
    );
  }

  return renderSection();
}

export function ThreadsSettingsSections() {
  const setting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { connectedEnvironments, scope } = useSettingsScope();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const hasServerTargets = connectedEnvironments.length > 0;
  const supportsAutoSettlementScope = connectedEnvironments.every(
    (target) => target.serverConfig?.environment.capabilities.threadAutoSettlementScope === true,
  );

  const workingShelfRow = (
    <SettingsRow
      {...setting("working-shelf")}
      description={
        <T>
          Fold working and monitoring threads into a Working section. They return to the top of the
          inbox when they need you.
        </T>
      }
      resetAction={
        settings.sidebarWorkingShelfEnabled !==
        DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled ? (
          <SettingResetButton
            ariaLabel={gt("Reset working section to default")}
            onClick={() =>
              updateSettings({
                sidebarWorkingShelfEnabled: DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled,
              })
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.sidebarWorkingShelfEnabled}
          onCheckedChange={(checked) =>
            updateSettings({ sidebarWorkingShelfEnabled: Boolean(checked) })
          }
          aria-label={gt("Working section")}
        />
      }
    />
  );

  return (
    <>
      <ProjectDefaultsSettings category="general" extraRows={workingShelfRow} />

      <SettingsSection id="auto-settle" title={gt("Auto-settle, snooze & rate limits")}>
        {hasServerTargets ? (
          <>
            <SettingsRow
              serverScoped
              settingKeys={["sidebarAutoSettleOnMerge"]}
              {...setting("auto-settle-merged-threads")}
              description={gt(
                "Settle a thread when its pull request merges. Closed pull requests still settle automatically.",
              )}
              resetAction={
                settings.sidebarAutoSettleOnMerge !==
                DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge ? (
                  <SettingResetButton
                    ariaLabel={gt("Reset auto-settle on merge to default")}
                    onClick={() =>
                      updateSettings({
                        sidebarAutoSettleOnMerge: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge,
                      })
                    }
                  />
                ) : null
              }
              control={
                <ScopedSwitch
                  settingKeys={["sidebarAutoSettleOnMerge"]}
                  checked={settings.sidebarAutoSettleOnMerge}
                  onCheckedChange={(checked) =>
                    updateSettings({ sidebarAutoSettleOnMerge: Boolean(checked) })
                  }
                  aria-label={gt("Auto-settle merged threads")}
                />
              }
            />

            <SettingsRow
              serverScoped
              settingKeys={["sidebarAutoSettleAfterDays"]}
              {...setting("auto-settle-inactive-threads")}
              description={gt(
                "Sidebar threads with no activity for this long settle automatically.",
              )}
              resetAction={
                settings.sidebarAutoSettleAfterDays !==
                DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays ? (
                  <SettingResetButton
                    ariaLabel={gt("Reset auto-settle to default")}
                    onClick={() =>
                      updateSettings({
                        sidebarAutoSettleAfterDays:
                          DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays,
                      })
                    }
                  />
                ) : null
              }
              control={
                <ScopedSwitch
                  settingKeys={["sidebarAutoSettleAfterDays"]}
                  checked={settings.sidebarAutoSettleAfterDays !== null}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      sidebarAutoSettleAfterDays: checked ? AUTO_SETTLE_DEFAULT_DAYS : null,
                    })
                  }
                  aria-label={gt("Auto-settle inactive threads")}
                />
              }
            />
            {settings.sidebarAutoSettleAfterDays !== null ? (
              <SettingsRow
                serverScoped
                settingKeys={["sidebarAutoSettleAfterDays"]}
                title={setting("days-before-auto-settle").title}
                description={gt("Any new activity un-settles a thread automatically.")}
                control={
                  <AutoSettleDaysInput
                    value={settings.sidebarAutoSettleAfterDays}
                    onCommit={(days, options) =>
                      updateSettings({ sidebarAutoSettleAfterDays: days }, options)
                    }
                  />
                }
              />
            ) : null}
            {settings.sidebarAutoSettleAfterDays !== null && supportsAutoSettlementScope ? (
              <SettingsRow
                serverScoped
                settingKeys={["sidebarAutoSettleKeepPullRequests"]}
                title={gt("Keep threads with a PR")}
                description={gt(
                  "Inactivity does not settle threads with a pull request. Merge and close still do.",
                )}
                control={
                  <ScopedSwitch
                    settingKeys={["sidebarAutoSettleKeepPullRequests"]}
                    checked={settings.sidebarAutoSettleKeepPullRequests}
                    onCheckedChange={(checked) =>
                      updateSettings({ sidebarAutoSettleKeepPullRequests: checked })
                    }
                    aria-label={gt("Keep threads with a PR")}
                  />
                }
              />
            ) : null}
          </>
        ) : null}

        {!isProjectScope ? <SnoozePresetsRow /> : null}

        <SettingsRow
          serverScoped
          {...setting("auto-resume-limited-threads")}
          description={gt(
            "Automatically resume threads when their usage limits reset. You can cancel auto-resume in each thread.",
          )}
          settingKeys={["autoResumeLimitedThreads"]}
          control={
            <ScopedSwitch
              settingKeys={["autoResumeLimitedThreads"]}
              checked={settings.autoResumeLimitedThreads}
              onCheckedChange={(checked) =>
                updateSettings({ autoResumeLimitedThreads: Boolean(checked) })
              }
              aria-label={gt("Resume after usage limits")}
            />
          }
        />
        <SettingsRow
          serverScoped
          {...setting("snooze-limited-threads")}
          description={gt(
            "Snooze threads until their usage limits reset. Enable auto-resume to continue the agent after the reset.",
          )}
          settingKeys={["snoozeLimitedThreads"]}
          control={
            <ScopedSwitch
              settingKeys={["snoozeLimitedThreads"]}
              checked={settings.snoozeLimitedThreads}
              onCheckedChange={(checked) =>
                updateSettings({ snoozeLimitedThreads: Boolean(checked) })
              }
              aria-label={gt("Snooze until limits reset")}
            />
          }
        />
      </SettingsSection>
    </>
  );
}

export function ThreadsSettingsPanel() {
  return (
    <SettingsPageContainer>
      <ThreadsSettingsSections />
    </SettingsPageContainer>
  );
}

export function MaintenanceSettingsPanel() {
  const setting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { connectedEnvironments } = useSettingsScope();
  const hasServerTargets = connectedEnvironments.length > 0;

  const tabs: ReadonlyArray<SettingsSegmentedTabItem> = [
    {
      id: MAINTENANCE_TAB_IDS.runtime,
      label: gt("Background & cleanup"),
      hashAnchors: MAINTENANCE_TAB_HASH_ANCHORS.runtime,
      content: (
        <>
          <SettingsSection id="background" title={gt("Background & recovery")}>
            <BackgroundActivitySettingsRow />
            <SettingsRow
              serverScoped
              settingKeys={["keepAwakeWhileAgentsWork"]}
              {...setting("keep-awake-while-agents-work")}
              description={gt(
                "Stop the computer from going to sleep while agents are working, and let it sleep once they finish. Closing a laptop lid still puts it to sleep.",
              )}
              resetAction={
                settings.keepAwakeWhileAgentsWork !==
                DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork ? (
                  <SettingResetButton
                    ariaLabel={gt("Reset keep awake while agents work to default")}
                    onClick={() =>
                      updateSettings({
                        keepAwakeWhileAgentsWork: DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork,
                      })
                    }
                  />
                ) : null
              }
              control={
                <ScopedSwitch
                  settingKeys={["keepAwakeWhileAgentsWork"]}
                  checked={settings.keepAwakeWhileAgentsWork}
                  onCheckedChange={(checked) =>
                    updateSettings({ keepAwakeWhileAgentsWork: Boolean(checked) })
                  }
                  aria-label={gt("Keep awake while agents work")}
                />
              }
            />
            <SettingsRow
              {...setting("continue-threads-after-server-update")}
              serverScoped
              settingKeys={["continueThreadsAfterServerUpdate"]}
              description={gt(
                "Automatically resume interrupted threads after an update, crash, or machine restart on the selected environments.",
              )}
              status={
                !hasServerTargets
                  ? gt("All selected connected environments must support restart continuation.")
                  : undefined
              }
              resetAction={
                hasServerTargets &&
                settings.continueThreadsAfterServerUpdate !==
                  DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate ? (
                  <SettingResetButton
                    ariaLabel={gt("Reset continue threads after restarts to default")}
                    onClick={() =>
                      updateSettings({
                        continueThreadsAfterServerUpdate:
                          DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate,
                      })
                    }
                  />
                ) : null
              }
              control={
                <ScopedSwitch
                  settingKeys={["continueThreadsAfterServerUpdate"]}
                  checked={settings.continueThreadsAfterServerUpdate}
                  disabled={!hasServerTargets}
                  onCheckedChange={(checked) =>
                    updateSettings({ continueThreadsAfterServerUpdate: Boolean(checked) })
                  }
                  aria-label={gt("Continue threads after restarts")}
                />
              }
            />
          </SettingsSection>

          <StorageCleanupSections />
        </>
      ),
    },
    {
      id: MAINTENANCE_TAB_IDS.telemetry,
      label: gt("Performance & storage"),
      hashAnchors: MAINTENANCE_TAB_HASH_ANCHORS.telemetry,
      content: (
        <div id="processes">
          <DiagnosticsSettingsSections />
        </div>
      ),
    },
  ];

  return (
    <SettingsPageContainer width="full">
      <SettingsSegmentedTabs
        tabs={tabs}
        defaultTabId={MAINTENANCE_TAB_IDS.runtime}
        ariaLabel={gt("Maintenance and diagnostics sections")}
      />
    </SettingsPageContainer>
  );
}

export function AboutSettingsPanel() {
  const setting = useSearchableSetting();
  const gt = useGT();
  const messages = useMessages();
  const primaryPolicy = usePrimaryManagedPolicy();
  // The Welcome page sets up this computer, so it needs one.
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const hasDesktopBridge = typeof window !== "undefined" && Boolean(window.desktopBridge);
  const telemetryOff = managedTelemetryOffMessage(primaryPolicy, messages);
  return (
    <SettingsPageContainer width="readable">
      {primaryPolicy ? (
        <SettingsSection id="about" title={gt("Organization")}>
          <SettingsRow
            title={gt("Organization")}
            description={gt(
              "This environment is managed by {organization}. Some settings and features follow its policy.",
              { organization: primaryPolicy.organization },
            )}
            control={
              primaryPolicy.supportUrl ? (
                <Button
                  render={
                    <a href={primaryPolicy.supportUrl} target="_blank" rel="noreferrer noopener" />
                  }
                  size="sm"
                  variant="outline"
                >
                  <T>Get help</T>
                </Button>
              ) : null
            }
          />
        </SettingsSection>
      ) : null}

      <div id={setting("app-version").id} tabIndex={-1}>
        <PrismuxUpdatesSettingsPage embedded />
      </div>

      <SettingsSection id="about-access" title={gt("Tools & help")}>
        {hasDesktopBridge ? <CliCommandSettingsRow /> : null}
        {primaryEnvironmentId === null ? null : (
          <SettingsRow
            {...setting("welcome-page")}
            description={gt(
              "Reopen the Prismux welcome guide to set up agents or import existing projects.",
            )}
            control={
              <Button size="sm" variant="outline" render={<Link to="/welcome" />}>
                <T>Reopen onboarding</T>
              </Button>
            }
          />
        )}
        <SettingsRow
          title={gt("Project repository")}
          description={gt("Prismux source code, releases, and issue tracker on GitHub.")}
          control={
            <Button
              render={<a href={PRISMUX_REPOSITORY_URL} target="_blank" rel="noreferrer noopener" />}
              size="sm"
              variant="outline"
            >
              <T>Open GitHub</T>
            </Button>
          }
        />
        <SettingsRow
          {...setting("privacy-policy")}
          description={
            telemetryOff === undefined
              ? gt("How we handle your data, including local-first privacy commitments in Prismux.")
              : gt("How we handle your data. {telemetryOff}", { telemetryOff })
          }
          control={
            <Button
              render={<a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer noopener" />}
              size="sm"
              variant="outline"
            >
              <T>View policy</T>
            </Button>
          }
        />
        <SettingsRow
          {...setting("open-source-licenses")}
          description={gt("Notices for dependencies, assets, and optional tools used by Prismux.")}
          control={
            <Button
              render={<Link to="/settings/open-source-licenses" />}
              size="sm"
              variant="outline"
            >
              <T>View licenses</T>
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
