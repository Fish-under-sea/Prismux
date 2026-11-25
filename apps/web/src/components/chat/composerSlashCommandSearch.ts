import { resolveProviderSkillSourceKind } from "@prismux/client-runtime/providerSkills";
import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
} from "@prismux/core-shared/searchRanking";

import type { ComposerCommandItem } from "./ComposerCommandMenu";
import {
  classifyComposerSkillCategory,
  isHiddenSlashCommand,
  resolveBundledSkillCommandPresentation,
  resolveSkillPresentation,
  resolveSlashCommandPresentation,
  type ComposerSkillCategory,
} from "./composerSlashCatalog";
import { scoreProviderSkill } from "../../providerSkillSearch";

export type SlashSearchItem = Extract<
  ComposerCommandItem,
  { type: "slash-command" | "provider-slash-command" | "skill" }
>;

export type ComposerSkillGroupToggleItem = Extract<
  ComposerCommandItem,
  { type: "skill-group-toggle" }
>;

function getSlashItemSkillCategory(item: SlashSearchItem): ComposerSkillCategory | null {
  if (item.type === "skill") {
    return classifyComposerSkillCategory(resolveProviderSkillSourceKind(item.skill));
  }
  if (item.type === "provider-slash-command" && item.skillCategory !== undefined) {
    return item.skillCategory;
  }
  return null;
}

function isHiddenSlashSearchItem(item: SlashSearchItem): boolean {
  if (item.type === "provider-slash-command") {
    return isHiddenSlashCommand(item.command.name);
  }
  if (item.type === "slash-command") {
    return isHiddenSlashCommand(item.command);
  }
  return false;
}

/** Provider commands, `/side`, `/btw`, `/compact`, `/browser`, and `/clear` work only at the message start. */
export function slashCommandItemsForPromptPosition(
  items: ReadonlyArray<SlashSearchItem>,
  isAtPromptStart: boolean,
): SlashSearchItem[] {
  const visible = items.filter((item) => !isHiddenSlashSearchItem(item));
  if (isAtPromptStart) {
    return visible;
  }
  return visible.filter(
    (item) =>
      item.type === "skill" ||
      (item.type === "slash-command" &&
        item.command !== "side" &&
        item.command !== "btw" &&
        item.command !== "compact" &&
        item.command !== "browser" &&
        item.command !== "clear"),
  );
}

/** Orders slash menu items: native Agent commands -> personal skills -> built-in skills. */
export function orderSlashCommandItems(items: ReadonlyArray<SlashSearchItem>): SlashSearchItem[] {
  const builtInCommands: SlashSearchItem[] = [];
  const providerCommands: SlashSearchItem[] = [];
  const personalSkills: SlashSearchItem[] = [];
  const builtinSkills: SlashSearchItem[] = [];

  for (const item of items) {
    if (isHiddenSlashSearchItem(item)) continue;
    const skillCategory = getSlashItemSkillCategory(item);
    if (skillCategory === "personal") {
      personalSkills.push(item);
      continue;
    }
    if (skillCategory === "builtin") {
      builtinSkills.push(item);
      continue;
    }
    if (item.type === "slash-command") {
      builtInCommands.push(item);
      continue;
    }
    providerCommands.push(item);
  }

  return [...builtInCommands, ...providerCommands, ...personalSkills, ...builtinSkills];
}

function stripSkillSearchPrefix(query: string): string {
  if (query.startsWith("skill:")) {
    return query.slice("skill:".length).trim();
  }
  if (query.startsWith("技能:")) {
    return query.slice("技能:".length).trim();
  }
  if (query.startsWith("技能：")) {
    return query.slice("技能：".length).trim();
  }
  return query;
}

function scoreSlashCommandItem(item: SlashSearchItem, query: string): number | null {
  if (isHiddenSlashSearchItem(item)) {
    return null;
  }

  const skillCategory = getSlashItemSkillCategory(item);
  if (skillCategory !== null) {
    const presentation =
      item.type === "skill"
        ? resolveSkillPresentation(item.skill, item.description)
        : resolveBundledSkillCommandPresentation(
            item.type === "provider-slash-command" ? item.command.name : item.command,
            item.description,
            skillCategory,
          );
    if (query === "skill" || query === "技能") {
      return 0;
    }
    if (query === "个人" || query === "个人技能") {
      return presentation.category === "personal" ? 0 : null;
    }
    if (query === "自带" || query === "自带技能" || query === "系统" || query === "内置") {
      return presentation.category === "builtin" ? 0 : null;
    }

    const skillQuery = stripSkillSearchPrefix(query);
    if (!skillQuery) {
      return 0;
    }

    const scores: Array<number | null> =
      item.type === "skill"
        ? [scoreProviderSkill(item.skill, skillQuery)]
        : [
            scoreQueryMatch({
              value: presentation.nativeName.toLowerCase(),
              query: skillQuery,
              exactBase: 0,
              prefixBase: 2,
              boundaryBase: 4,
              includesBase: 6,
              fuzzyBase: 100,
              boundaryMarkers: ["-", "_", "/"],
            }),
          ];
    const originalSkillDescription = item.description.trim().toLowerCase();
    const presentationDescription = presentation.description.trim().toLowerCase();
    if (
      presentationDescription &&
      (presentation.isLocalized || item.type === "provider-slash-command")
    ) {
      scores.push(
        scoreQueryMatch({
          value: presentationDescription,
          query: skillQuery,
          exactBase: 20,
          prefixBase: 22,
          boundaryBase: 24,
          includesBase: 26,
        }),
      );
    }
    if (
      item.type === "provider-slash-command" &&
      originalSkillDescription &&
      originalSkillDescription !== presentationDescription
    ) {
      scores.push(
        scoreQueryMatch({
          value: originalSkillDescription,
          query: skillQuery,
          exactBase: 24,
          prefixBase: 26,
          boundaryBase: 28,
          includesBase: 30,
        }),
      );
    }
    scores.push(
      scoreQueryMatch({
        value: presentation.sourceBadgeLabel.toLowerCase(),
        query: skillQuery,
        exactBase: 40,
        prefixBase: 42,
        includesBase: 44,
      }),
    );

    const validScores = scores.filter((score): score is number => score !== null);
    if (validScores.length > 0) {
      return Math.min(...validScores);
    }
    return "skill".startsWith(query) || "技能".startsWith(query) ? Number.MAX_SAFE_INTEGER : null;
  }

  if (item.type === "skill") {
    return null;
  }

  const rawCommandName = item.type === "slash-command" ? item.command : item.command.name;
  const primaryValue = rawCommandName.toLowerCase();
  const presentation = resolveSlashCommandPresentation(rawCommandName, item.description);
  const localizedDescription = presentation.description.toLowerCase();
  const originalDescription = item.description.toLowerCase();

  const scores: Array<number | null> = [
    scoreQueryMatch({
      value: primaryValue,
      query,
      exactBase: 0,
      prefixBase: 2,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 100,
      boundaryMarkers: ["-", "_", "/"],
    }),
    presentation.zhTitle
      ? scoreQueryMatch({
          value: presentation.zhTitle.toLowerCase(),
          query,
          exactBase: 0,
          prefixBase: 2,
          boundaryBase: 4,
          includesBase: 6,
        })
      : null,
    ...presentation.searchAliases.map((alias) =>
      scoreQueryMatch({
        value: alias.toLowerCase(),
        query,
        exactBase: 4,
        prefixBase: 6,
        includesBase: 10,
      }),
    ),
    scoreQueryMatch({
      value: localizedDescription,
      query,
      exactBase: 20,
      prefixBase: 22,
      boundaryBase: 24,
      includesBase: 26,
    }),
    originalDescription && originalDescription !== localizedDescription
      ? scoreQueryMatch({
          value: originalDescription,
          query,
          exactBase: 24,
          prefixBase: 26,
          boundaryBase: 28,
          includesBase: 30,
        })
      : null,
  ];

  const validScores = scores.filter((score): score is number => score !== null);
  if (validScores.length === 0) {
    return null;
  }

  return Math.min(...validScores);
}

export function searchSlashCommandItems(
  items: ReadonlyArray<SlashSearchItem>,
  query: string,
): SlashSearchItem[] {
  const normalizedQuery = normalizeSearchQuery(query, { trimLeadingPattern: /^\/+/ });
  if (!normalizedQuery) {
    return orderSlashCommandItems(items);
  }

  const ranked: Array<{
    item: SlashSearchItem;
    score: number;
    tieBreaker: string;
  }> = [];

  for (const item of items) {
    const score = scoreSlashCommandItem(item, normalizedQuery);
    if (score === null) {
      continue;
    }

    const itemSkillCategory = getSlashItemSkillCategory(item);
    const skillTier =
      itemSkillCategory !== null ? (itemSkillCategory === "personal" ? "2" : "3") : null;

    insertRankedSearchResult(
      ranked,
      {
        item,
        score,
        tieBreaker:
          item.type === "slash-command"
            ? `0\u0000${item.command}`
            : item.type === "provider-slash-command"
              ? `${skillTier ?? "1"}\u0000${item.command.name}\u0000${item.provider}`
              : `${skillTier ?? "3"}\u0000${item.skill.name}\u0000${item.provider}`,
      },
      Number.POSITIVE_INFINITY,
    );
  }

  return ranked.map((entry) => entry.item);
}

/**
 * Builds the `/` command menu item list:
 * - On non-empty query: auto-expands and runs bilingual search across all tiers.
 * - On bare `/`: orders native Agent commands first, followed by a single collapsible
 *   `slash:skills-folder` row that reveals `个人技能` then `自带技能` when expanded.
 */
export function buildComposerSlashMenuItems(input: {
  readonly items: ReadonlyArray<SlashSearchItem>;
  readonly query: string;
  readonly skillsExpanded: boolean;
}): ComposerCommandItem[] {
  const normalizedQuery = normalizeSearchQuery(input.query, { trimLeadingPattern: /^\/+/ });
  if (normalizedQuery.length > 0) {
    return searchSlashCommandItems(input.items, normalizedQuery);
  }

  const ordered = orderSlashCommandItems(input.items);
  const nativeItems: SlashSearchItem[] = [];
  const personalSkills: SlashSearchItem[] = [];
  const builtinSkills: SlashSearchItem[] = [];

  for (const item of ordered) {
    const category = getSlashItemSkillCategory(item);
    if (category === null) {
      nativeItems.push(item);
      continue;
    }
    if (category === "personal") {
      personalSkills.push(item);
    } else {
      builtinSkills.push(item);
    }
  }

  const totalSkills = personalSkills.length + builtinSkills.length;
  if (totalSkills === 0) {
    return nativeItems;
  }

  const folderToggle: ComposerSkillGroupToggleItem = {
    id: "slash:skills-folder",
    type: "skill-group-toggle",
    expanded: input.skillsExpanded,
    personalCount: personalSkills.length,
    builtinCount: builtinSkills.length,
    totalCount: totalSkills,
    label: input.skillsExpanded ? "收起技能" : "技能",
    description: `个人 ${personalSkills.length} · 自带 ${builtinSkills.length}`,
  };

  if (!input.skillsExpanded) {
    return [...nativeItems, folderToggle];
  }

  return [...nativeItems, folderToggle, ...personalSkills, ...builtinSkills];
}
