import {
  STATIC_KEYBINDING_COMMANDS,
  type ClientSettings,
  type KeybindingCommand,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  type ResolvedKeybindingRule,
  type ResolvedKeybindingsConfig,
} from "@prismux/core-contracts";
import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  parseKeybindingShortcut,
  parseKeybindingWhenExpression,
  US_SHIFTED_TO_UNSHIFTED_KEYS,
} from "@prismux/core-shared/keybindings";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";
import {
  formatShortcutLabel,
  shortcutConflictKey,
  shortcutForContext,
  shortcutKeyFromEvent,
} from "../../keybindings";
import { isMacPlatform } from "../../lib/utils";
import { METRIC_OPTIONS, WINDOW_OPTIONS } from "../usage/usageShortcuts";

// Rank every usage command; mixing rank and alphabetical comparisons makes order input-dependent.
const usageCommandOrder = new Map<KeybindingCommand, number>(
  [
    "usage.open" as const,
    ...[...METRIC_OPTIONS, ...WINDOW_OPTIONS].map((option) => option.command),
  ].map((command, index) => [command, index]),
);

const firstUsageCommand = METRIC_OPTIONS[0].command;

function compareCommands(
  left: KeybindingCommand,
  right: KeybindingCommand,
  key: (command: KeybindingCommand) => string,
): number {
  const leftRank = usageCommandOrder.get(left);
  const rightRank = usageCommandOrder.get(right);
  if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
  return key(leftRank === undefined ? left : firstUsageCommand).localeCompare(
    key(rightRank === undefined ? right : firstUsageCommand),
  );
}

export type KeybindingSource = "Default" | "Custom" | "Project";

export interface KeybindingRow {
  readonly id: string;
  readonly command: KeybindingCommand;
  readonly key: string;
  readonly when: string;
  readonly source: KeybindingSource;
  readonly isUnassigned: boolean;
  readonly defaultKey: string | null;
  readonly defaultWhen: string;
  readonly binding: ResolvedKeybindingRule | null;
  readonly conflicts: ReadonlyArray<string>;
  readonly previewLabels: ReadonlyArray<string>;
}

export type WhenVariableOption = string;
export type KeybindingCommandOption = KeybindingCommand;

const CORE_WHEN_VARIABLES = [
  "terminalFocus",
  "terminalOpen",
  "previewOpen",
  "isWeb",
  "isDesktop",
  "true",
  "false",
] as const;

const DEFAULT_WHEN_VARIABLES = new Set<string>(CORE_WHEN_VARIABLES);
for (const binding of DEFAULT_RESOLVED_KEYBINDINGS) {
  collectWhenIdentifiersFromNode(binding.whenAst, DEFAULT_WHEN_VARIABLES);
}

export const DEFAULT_WHEN_VARIABLE =
  [...DEFAULT_WHEN_VARIABLES].find(
    (identifier) => identifier !== "true" && identifier !== "false",
  ) ?? "terminalFocus";
const KNOWN_WHEN_VARIABLES = new Set(DEFAULT_WHEN_VARIABLES);

export function shortcutToKeybindingParts(shortcut: KeybindingShortcut): ReadonlyArray<string> {
  const parts: string[] = [];
  if (shortcut.modKey) parts.push("mod");
  if (shortcut.metaKey) parts.push("meta");
  if (shortcut.ctrlKey) parts.push("ctrl");
  if (shortcut.altKey) parts.push("alt");
  if (shortcut.shiftKey) parts.push("shift");
  parts.push(shortcut.key === " " ? "space" : shortcut.key === "escape" ? "esc" : shortcut.key);
  return parts;
}

export function shortcutToKeybindingInput(shortcut: KeybindingShortcut): string {
  return shortcutToKeybindingParts(shortcut).join("+");
}

export function whenAstToExpression(node: KeybindingWhenNode | undefined): string {
  if (!node) return "";
  switch (node.type) {
    case "identifier":
      return node.name;
    case "not":
      return `!${wrapWhenExpression(node.node)}`;
    case "and":
      return `${wrapWhenExpression(node.left)} && ${wrapWhenExpression(node.right)}`;
    case "or":
      return `${wrapWhenExpression(node.left)} || ${wrapWhenExpression(node.right)}`;
  }
}

export function whenNodeRemoveLabel(
  node: KeybindingWhenNode,
  depth: number,
  resolve: MessageResolver = m,
): string {
  if (depth === 0) return resolve(msg("Clear all conditions"));
  if (node.type === "identifier" || (node.type === "not" && node.node.type === "identifier")) {
    return resolve(msg("Remove condition"));
  }
  return resolve(msg("Remove group and its conditions"));
}

function wrapWhenExpression(node: KeybindingWhenNode): string {
  if (node.type === "identifier" || node.type === "not") return whenAstToExpression(node);
  return `(${whenAstToExpression(node)})`;
}

export function parseWhenExpressionDraft(
  expression: string,
  resolve: MessageResolver = m,
): { ok: true; value: KeybindingWhenNode | undefined } | { ok: false; message: string } {
  const trimmed = expression.trim();
  if (trimmed.length === 0) return { ok: true, value: undefined };

  const ast = parseKeybindingWhenExpression(trimmed);
  if (!ast) {
    return {
      ok: false,
      message: resolve(msg("Use variables with !, &&, ||, and parentheses.")),
    };
  }

  return { ok: true, value: ast };
}

function sourceForBinding(binding: ResolvedKeybindingRule): KeybindingSource {
  if (String(binding.command).startsWith("script.")) {
    const source: KeybindingSource = "Project";
    return source;
  }

  const bindingKey = shortcutToKeybindingInput(binding.shortcut);
  const bindingWhen = whenAstToExpression(binding.whenAst);
  const isDefault = DEFAULT_RESOLVED_KEYBINDINGS.some(
    (entry) =>
      entry.command === binding.command &&
      shortcutToKeybindingInput(entry.shortcut) === bindingKey &&
      whenAstToExpression(entry.whenAst) === bindingWhen,
  );

  const source: KeybindingSource = isDefault ? "Default" : "Custom";
  return source;
}

interface DeduplicatedKeybindingEntry {
  readonly id: string;
  readonly command: KeybindingCommand;
  readonly key: string;
  readonly when: string;
  readonly binding: ResolvedKeybindingRule;
  readonly previewLabels: ReadonlyArray<string>;
}

function assignDefaultBindingsForEntries(
  entries: ReadonlyArray<DeduplicatedKeybindingEntry>,
): ReadonlyMap<string, ResolvedKeybindingRule> {
  const matchedDefaults = new Map<string, ResolvedKeybindingRule>();
  const entriesByCommand = new Map<KeybindingCommand, Array<DeduplicatedKeybindingEntry>>();
  for (const entry of entries) {
    const bucket = entriesByCommand.get(entry.command);
    if (bucket) bucket.push(entry);
    else entriesByCommand.set(entry.command, [entry]);
  }

  for (const [command, commandEntries] of entriesByCommand) {
    const defaults = DEFAULT_RESOLVED_KEYBINDINGS.filter((entry) => entry.command === command);
    if (defaults.length === 0) continue;

    const claimed = new Set<number>();
    const claimFirst = (
      entry: DeduplicatedKeybindingEntry,
      predicate: (candidate: ResolvedKeybindingRule) => boolean,
    ) => {
      if (matchedDefaults.has(entry.id)) return;
      for (const [index, candidate] of defaults.entries()) {
        if (claimed.has(index) || !predicate(candidate)) continue;
        claimed.add(index);
        matchedDefaults.set(entry.id, candidate);
        return;
      }
    };

    // Pass 1: exact match on both key and when (preserves untouched default rows).
    for (const entry of commandEntries) {
      claimFirst(
        entry,
        (candidate) =>
          shortcutToKeybindingInput(candidate.shortcut) === entry.key &&
          whenAstToExpression(candidate.whenAst) === entry.when,
      );
    }

    // Pass 2: unassigned default rows (when === "false") match their exact default key.
    for (const entry of commandEntries) {
      if (entry.when !== "false") continue;
      claimFirst(entry, (candidate) => shortcutToKeybindingInput(candidate.shortcut) === entry.key);
    }

    // Pass 3: customized rows with the same when expression claim remaining unclaimed defaults.
    for (const entry of commandEntries) {
      claimFirst(entry, (candidate) => whenAstToExpression(candidate.whenAst) === entry.when);
    }

    // Pass 4: customized rows with changed when expressions claim any remaining unclaimed default.
    for (const entry of commandEntries) {
      claimFirst(entry, () => true);
    }
  }

  return matchedDefaults;
}

function keybindingRowId(command: KeybindingCommand, key: string, when: string): string {
  return `${command}\u0000${key}\u0000${when}`;
}

function conflictsWithWhen(leftWhen: string, rightWhen: string): boolean {
  if (leftWhen === "false" || rightWhen === "false") return false;
  return leftWhen.length === 0 || rightWhen.length === 0 || leftWhen === rightWhen;
}

export function keybindingConflictLabels(
  rows: ReadonlyArray<KeybindingRow>,
  input: { readonly rowId: string; readonly key: string; readonly when: string },
  platform = navigator.platform,
  resolve: MessageResolver = m,
): ReadonlyArray<string> {
  if (input.key.trim().length === 0) return [];
  const shortcut = parseKeybindingShortcut(input.key);
  if (!shortcut) return [];
  // Compare resolved chords so mod+k and ctrl+k collide where mod is Ctrl.
  const conflictKey = shortcutConflictKey(shortcut, platform);
  const conflicts: Array<string> = [];
  for (const candidate of rows) {
    if (
      candidate.id !== input.rowId &&
      candidate.binding !== null &&
      !candidate.isUnassigned &&
      shortcutConflictKey(candidate.binding.shortcut, platform) === conflictKey &&
      conflictsWithWhen(candidate.when, input.when)
    ) {
      conflicts.push(commandLabel(candidate.command, resolve));
    }
  }
  return [...new Set(conflicts)].toSorted();
}

export interface KeybindingGroup {
  readonly id: string;
  readonly title: string;
  readonly rows: ReadonlyArray<KeybindingRow>;
}

const KEYBINDING_GROUPS = [
  {
    id: "navigation",
    title: msg("Navigation"),
    prefixes: ["sidebar", "rightPanel", "commandPalette", "filePicker", "projectSearch", "editor"],
  },
  { id: "threads", title: msg("Threads"), prefixes: ["thread", "chat", "pullRequest"] },
  { id: "composer", title: msg("Composer"), prefixes: ["composer", "modelPicker"] },
  { id: "terminal", title: msg("Terminal"), prefixes: ["terminal"] },
  { id: "preview", title: msg("Preview & diff"), prefixes: ["preview", "diff"] },
  {
    id: "appearance",
    title: msg("Appearance"),
    prefixes: ["theme", "appearance", "themeEditor"],
  },
  { id: "scripts", title: msg("Project scripts"), prefixes: ["script"] },
] as const;
const OTHER_KEYBINDING_GROUP = {
  id: "other",
  title: msg("Other", { $context: "keybinding group" }),
} as const;

function keybindingGroupFor(command: KeybindingCommand): { id: string; title: string } {
  const prefix = String(command).split(".")[0] ?? "";
  return (
    KEYBINDING_GROUPS.find((group) => (group.prefixes as ReadonlyArray<string>).includes(prefix)) ??
    OTHER_KEYBINDING_GROUP
  );
}

export function groupKeybindingRows(
  rows: ReadonlyArray<KeybindingRow>,
): ReadonlyArray<KeybindingGroup> {
  const rowsByGroup = new Map<string, Array<KeybindingRow>>();
  for (const row of rows) {
    const group = keybindingGroupFor(row.command);
    const bucket = rowsByGroup.get(group.id);
    if (bucket) bucket.push(row);
    else rowsByGroup.set(group.id, [row]);
  }
  return [...KEYBINDING_GROUPS, OTHER_KEYBINDING_GROUP].flatMap((group) => {
    const groupRows = rowsByGroup.get(group.id);
    return groupRows ? [{ id: group.id, title: group.title, rows: groupRows }] : [];
  });
}

export function buildKeybindingRows(
  keybindings: ResolvedKeybindingsConfig,
  platform = navigator.platform,
  sendShortcut: ClientSettings["sendShortcut"] = "enter",
  resolve: MessageResolver = m,
): ReadonlyArray<KeybindingRow> {
  // Multiline sending can use either shortcut; settings have no active composer prompt.
  const modifierModes =
    sendShortcut === "mod-enter-multiline" ? [false, true] : [sendShortcut === "mod-enter"];
  const previewLabels = keybindings.map(() => new Set<string>());
  for (const composerRequiresModifier of modifierModes) {
    const laterBindings = new Set<string>();
    for (let index = keybindings.length - 1; index >= 0; index--) {
      const binding = keybindings[index]!;
      const when = whenAstToExpression(binding.whenAst);
      if (when === "false") continue;
      const shortcut = shortcutForContext(binding, { composerRequiresModifier });
      const key = shortcutConflictKey(shortcut, platform);
      const conditionKey = `${key}:${when === "true" ? "" : when}`;
      // Distinct conditions may still apply in other focus contexts.
      if (!laterBindings.has(`${key}:`) && !laterBindings.has(conditionKey)) {
        previewLabels[index]!.add(formatShortcutLabel(shortcut, platform));
      }
      laterBindings.add(conditionKey);
    }
  }
  const entriesById = new Map<string, DeduplicatedKeybindingEntry>();
  for (const [index, binding] of keybindings.entries()) {
    const key = shortcutToKeybindingInput(binding.shortcut);
    const when = whenAstToExpression(binding.whenAst);
    const id = keybindingRowId(binding.command, key, when);
    entriesById.set(id, {
      id,
      command: binding.command,
      key,
      when,
      binding,
      previewLabels: [...previewLabels[index]!],
    });
  }
  const deduplicatedEntries = [...entriesById.values()];
  const defaultBindingsByRowId = assignDefaultBindingsForEntries(deduplicatedEntries);
  const rows: KeybindingRow[] = deduplicatedEntries.map((entry) => {
    const defaultBinding = defaultBindingsByRowId.get(entry.id);
    return {
      id: entry.id,
      command: entry.command,
      key: entry.key,
      when: entry.when,
      source: sourceForBinding(entry.binding),
      isUnassigned:
        entry.when === "false" &&
        defaultBinding !== undefined &&
        entry.key === shortcutToKeybindingInput(defaultBinding.shortcut),
      defaultKey: defaultBinding ? shortcutToKeybindingInput(defaultBinding.shortcut) : null,
      defaultWhen: whenAstToExpression(defaultBinding?.whenAst),
      binding: entry.binding,
      conflicts: [],
      previewLabels: entry.previewLabels,
    };
  });

  const rowsWithConflicts = rows.map((row) => {
    const conflicts = keybindingConflictLabels(
      rows,
      {
        rowId: row.id,
        key: row.key,
        when: row.when,
      },
      platform,
      resolve,
    );
    return conflicts.length > 0
      ? Object.assign({}, row, { conflicts: [...new Set(conflicts)].toSorted() })
      : row;
  });

  return sortKeybindingRows(rowsWithConflicts);
}

function sortKeybindingRows(rows: ReadonlyArray<KeybindingRow>): ReadonlyArray<KeybindingRow> {
  return rows.toSorted((left, right) => {
    const commandCompare = compareCommands(left.command, right.command, (command) => command);
    if (commandCompare !== 0) return commandCompare;
    return left.key.localeCompare(right.key);
  });
}

/**
 * Ensures static commands without default rules (such as `thread.stop`) appear in Settings as
 * searchable, directly assignable Unassigned rows without altering `buildKeybindingRows`.
 */
export function withUnboundStaticKeybindingRows(
  rows: ReadonlyArray<KeybindingRow>,
  commands: ReadonlyArray<KeybindingCommand> = STATIC_KEYBINDING_COMMANDS,
): ReadonlyArray<KeybindingRow> {
  const presentCommands = new Set(rows.map((row) => row.command));
  const unboundRows: KeybindingRow[] = [];
  for (const command of commands) {
    if (presentCommands.has(command)) continue;
    unboundRows.push({
      id: keybindingRowId(command, "", ""),
      command,
      key: "",
      when: "",
      source: "Default",
      isUnassigned: true,
      defaultKey: null,
      defaultWhen: "",
      binding: null,
      conflicts: [],
      previewLabels: [],
    });
  }
  if (unboundRows.length === 0) return rows;
  return sortKeybindingRows([...rows, ...unboundRows]);
}

export function filterKeybindingRows(
  rows: ReadonlyArray<KeybindingRow>,
  query: string,
  resolve: MessageResolver = m,
): ReadonlyArray<KeybindingRow> {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return rows;
  return rows.filter((row) => {
    return (
      row.command.toLowerCase().includes(normalizedQuery) ||
      commandLabel(row.command, resolve).toLowerCase().includes(normalizedQuery) ||
      row.key.toLowerCase().includes(normalizedQuery) ||
      row.when.toLowerCase().includes(normalizedQuery) ||
      row.source.toLowerCase().includes(normalizedQuery)
    );
  });
}

function collectWhenIdentifiersFromNode(
  node: KeybindingWhenNode | undefined,
  identifiers: Set<string>,
): void {
  if (!node) return;
  switch (node.type) {
    case "identifier":
      identifiers.add(node.name);
      return;
    case "not":
      collectWhenIdentifiersFromNode(node.node, identifiers);
      return;
    case "and":
    case "or":
      collectWhenIdentifiersFromNode(node.left, identifiers);
      collectWhenIdentifiersFromNode(node.right, identifiers);
      return;
  }
}

export function isKnownWhenVariable(identifier: string): boolean {
  return KNOWN_WHEN_VARIABLES.has(identifier);
}

export function unknownWhenVariables(node: KeybindingWhenNode | undefined): ReadonlyArray<string> {
  const identifiers = new Set<string>();
  collectWhenIdentifiersFromNode(node, identifiers);
  return [...identifiers].filter((identifier) => !isKnownWhenVariable(identifier)).toSorted();
}

export function buildWhenVariableOptions(): ReadonlyArray<WhenVariableOption> {
  return [...KNOWN_WHEN_VARIABLES].toSorted((left, right) => {
    const leftCoreIndex = CORE_WHEN_VARIABLES.indexOf(left as (typeof CORE_WHEN_VARIABLES)[number]);
    const rightCoreIndex = CORE_WHEN_VARIABLES.indexOf(
      right as (typeof CORE_WHEN_VARIABLES)[number],
    );
    if (leftCoreIndex !== -1 || rightCoreIndex !== -1) {
      return (
        (leftCoreIndex === -1 ? Number.MAX_SAFE_INTEGER : leftCoreIndex) -
        (rightCoreIndex === -1 ? Number.MAX_SAFE_INTEGER : rightCoreIndex)
      );
    }
    return left.localeCompare(right);
  });
}

export function buildKeybindingCommandOptions(
  keybindings: ResolvedKeybindingsConfig,
  resolve: MessageResolver = m,
): ReadonlyArray<KeybindingCommandOption> {
  const commands = new Set<KeybindingCommand>(STATIC_KEYBINDING_COMMANDS);
  for (const binding of keybindings) {
    commands.add(binding.command);
  }
  return [...commands].toSorted((left, right) =>
    compareCommands(left, right, (command) => commandLabel(command, resolve)),
  );
}

const COMMAND_LABELS: Partial<Record<KeybindingCommand, string>> = {
  "workspace.focusNext": msg("Focus Next Workspace Area"),
  "workspace.focusPrevious": msg("Focus Previous Workspace Area"),
  "composer.sendAlternate": msg("Composer: Opposite Queue or Steer Action"),
  "composer.sendBackground": msg("Composer: Start in Background"),
  "composer.sendAndNewThread": msg("Composer: Send and Start New Thread"),
  "composer.dictation": msg("Composer: Start or Finish Dictation"),
  "thread.steerQueuedMessage": msg("Queue: Send First Queued Message"),
  "thread.editQueuedMessage": msg("Queue: Edit Last Queued Message"),
  "thread.copyReference": msg("Pull Request: Copy Link or Thread"),
  "sidebar.toggle": msg("Sidebar: Toggle"),
  "sidebar.collapseAllProjects": msg("Sidebar: Collapse or Expand All Projects"),
  "navigation.back": msg("Navigation: Back"),
  "navigation.forward": msg("Navigation: Forward"),
  "terminal.toggle": msg("Terminal: Toggle"),
  "terminal.split": msg("Terminal: Split"),
  "terminal.splitVertical": msg("Terminal: Split Vertical"),
  "terminal.new": msg("Terminal: New"),
  "terminal.close": msg("Terminal: Close"),
  "rightPanel.toggle": msg("Right Panel: Toggle"),
  "rightPanel.new": msg("Right Panel: New"),
  "threadPanel.toggle": msg("Thread Panel: Toggle"),
  "rightPanel.toggleMaximized": msg("Right Panel: Toggle Maximized"),
  "rightPanel.close": msg("Right Panel: Close"),
  "pullRequest.copyNumber": msg("Pull Request: Copy Number"),
  "diff.toggle": msg("Diff: Toggle"),
  "preview.toggle": msg("Preview: Toggle"),
  "preview.refresh": msg("Preview: Refresh"),
  "preview.zoomIn": msg("Preview: Zoom In"),
  "preview.zoomOut": msg("Preview: Zoom Out"),
  "preview.resetZoom": msg("Preview: Reset Zoom"),
  "commandPalette.toggle": msg("Command Palette: Toggle"),
  "filePicker.toggle": msg("File Picker: Toggle"),
  "projectSearch.toggle": msg("Project Search: Toggle"),
  "usage.open": msg("Usage: Open"),
  "theme.select": msg("Theme: Select"),
  "appearance.cycle": msg("Appearance: Cycle"),
  "themeEditor.toggle": msg("Theme Editor: Toggle"),
  "composer.stash": msg("Composer: Stash"),
  "composer.host": msg("Composer: Host"),
  "composer.cycleHost": msg("Composer: Cycle Host"),
  "composer.effort": msg("Composer: Effort"),
  "composer.increaseEffort": msg("Composer: Increase Effort"),
  "composer.decreaseEffort": msg("Composer: Decrease Effort"),
  "composer.mode": msg("Composer: Mode"),
  "composer.workspace": msg("Composer: Workspace"),
  "composer.previousWorktree": msg("Composer: Previous Worktree"),
  "composer.branch": msg("Composer: Branch"),
  "chat.new": msg("Chat: New"),
  "chat.newLocal": msg("Chat: New Local"),
  "chat.newWithoutProject": msg("Chat: New Without Project"),
  "chat.find": msg("Chat: Find"),
  "chat.citeSelection": msg("Chat: Cite Selection"),
  "chat.sideAskSelection": msg("Chat: Side Ask Selection"),
  "editor.openFavorite": msg("Editor: Open Favorite"),
  "modelPicker.toggle": msg("Model Picker: Toggle"),
  "modelPicker.previousProvider": msg("Model Picker: Previous Provider"),
  "modelPicker.nextProvider": msg("Model Picker: Next Provider"),
  "thread.stop": msg("Thread: Stop"),
  "thread.previous": msg("Thread: Previous"),
  "thread.next": msg("Thread: Next"),
  "thread.settle": msg("Thread: Settle"),
  "thread.pin": msg("Thread: Pin"),
  "thread.regenerateTitle": msg("Thread: Regenerate Title"),
  "thread.undo": msg("Thread: Undo"),
};

// Whole labels: search titles keep the encoded message, which cannot nest another one.
const USAGE_COMMAND_LABELS: Record<
  (typeof METRIC_OPTIONS)[number]["command"] | (typeof WINDOW_OPTIONS)[number]["command"],
  string
> = {
  "usage.cost": msg("Usage: Cost"),
  "usage.tokens": msg("Usage: Tokens"),
  "usage.limits": msg("Usage: Limits"),
  "usage.period.day": msg("Usage: Period: Past 24h"),
  "usage.period.week": msg("Usage: Period: 7 days"),
  "usage.period.month": msg("Usage: Period: 30 days"),
  "usage.period.quarter": msg("Usage: Period: 90 days"),
};

const LATE_COMMAND_LABELS: Partial<Record<KeybindingCommand, string>> = {
  "view.reopenClosed": msg("Reopen Closed Tab"),
  "preview.focusUrl": msg("Preview: Focus URL"),
  "preview.find": msg("Preview: Find on Page"),
};

export function commandLabel(command: KeybindingCommand, resolve: MessageResolver = m): string {
  const label = COMMAND_LABELS[command];
  if (label) return resolve(label);
  const usageLabel = USAGE_COMMAND_LABELS[command as keyof typeof USAGE_COMMAND_LABELS];
  if (usageLabel) return resolve(usageLabel);
  const lateLabel = LATE_COMMAND_LABELS[command];
  if (lateLabel) return resolve(lateLabel);
  const raw = String(command);
  if (raw.startsWith("thread.jump.")) {
    return resolve(msg("Thread: Jump: {n}", { n: raw.slice("thread.jump.".length) }));
  }
  if (raw.startsWith("modelPicker.jump.")) {
    return resolve(msg("Model Picker: Jump: {n}", { n: raw.slice("modelPicker.jump.".length) }));
  }
  if (raw.startsWith("script.") && raw.endsWith(".run")) {
    return resolve(
      msg("Run Script: {name}", {
        name: titleCaseCommandSegment(raw.slice("script.".length, -".run".length)),
      }),
    );
  }
  return raw.split(".").map(titleCaseCommandSegment).join(": ");
}

function titleCaseCommandSegment(segment: string): string {
  const words: Array<string> = [];
  for (const part of segment.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[-_\s]+/)) {
    if (part.length > 0) {
      words.push(part.slice(0, 1).toUpperCase() + part.slice(1));
    }
  }
  return words.join(" ");
}

function recordedLayoutShortcutKey(
  event: Pick<KeyboardEvent, "key" | "code" | "shiftKey" | "altKey">,
): string {
  const physicalKey = shortcutKeyFromEvent(event);
  const layoutKey = event.key.toLowerCase();
  if (event.altKey || layoutKey.length !== 1) return physicalKey;
  // Normalize only US shifted glyphs at their US position. Other layouts can
  // produce the same glyph without Shift or at a different position.
  const unshiftedKey = event.shiftKey ? US_SHIFTED_TO_UNSHIFTED_KEYS.get(layoutKey) : undefined;
  return unshiftedKey === physicalKey ? physicalKey : layoutKey;
}

function normalizeShortcutKeyToken(key: string): string | null {
  const normalized = key.toLowerCase();
  if (
    normalized === "meta" ||
    normalized === "control" ||
    normalized === "ctrl" ||
    normalized === "shift" ||
    normalized === "alt" ||
    normalized === "option"
  ) {
    return null;
  }
  if (normalized === " ") return "space";
  if (normalized === "escape") return "esc";
  if (normalized === "arrowup") return "arrowup";
  if (normalized === "arrowdown") return "arrowdown";
  if (normalized === "arrowleft") return "arrowleft";
  if (normalized === "arrowright") return "arrowright";
  if (normalized.length === 1) return normalized;
  if (/^f\d{1,2}$/.test(normalized)) return normalized;
  if (normalized === "enter" || normalized === "tab" || normalized === "backspace") {
    return normalized;
  }
  if (normalized === "delete" || normalized === "home" || normalized === "end") {
    return normalized;
  }
  if (normalized === "pageup" || normalized === "pagedown") return normalized;
  return null;
}

export function keybindingFromKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  platform: string,
  options?: {
    readonly layoutCharacter?: boolean;
  },
): string | null {
  const keyToken = normalizeShortcutKeyToken(
    options?.layoutCharacter ? recordedLayoutShortcutKey(event) : shortcutKeyFromEvent(event),
  );
  if (!keyToken) return null;

  const parts: string[] = [];
  if (isMacPlatform(platform)) {
    if (event.metaKey) parts.push("mod");
    if (event.ctrlKey) parts.push("ctrl");
  } else {
    if (event.ctrlKey) parts.push("mod");
    if (event.metaKey) parts.push("meta");
  }
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(keyToken);
  return parts.join("+");
}
