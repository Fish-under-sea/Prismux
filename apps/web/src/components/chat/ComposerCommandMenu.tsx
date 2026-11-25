import type { ComposerPathSearchTarget } from "@prismux/client-runtime/state/threads";
import {
  resolveProviderSkillSourceKind,
  type ProviderSkillSourceKind,
} from "@prismux/client-runtime/providerSkills";
import {
  type EnvironmentId,
  type EnvironmentMachineKind,
  type ProjectEntry,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type PullRequestContextMetadata,
  type ScopedThreadRef,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
} from "@prismux/core-contracts";
import {
  BlocksIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MessagesSquareIcon,
} from "lucide-react";
import { msg, useGT, useMessages } from "gt-react";
import { memo, useLayoutEffect, useRef, useState } from "react";

import { type ComposerSlashCommand, type ComposerTriggerKind } from "../../composer-logic";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { PierreEntryIcon } from "./PierreEntryIcon";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { ComposerBanner } from "./ComposerBanner";
import { resolvePullRequestState } from "../pullRequest/pullRequestPresentation";
import {
  SKILL_SOURCE_ICON_BY_KIND,
  classifyComposerSkillCategory,
  resolveBundledSkillCommandPresentation,
  resolveSkillPresentation,
  resolveSkillSourceBadgeLabel,
  resolveSlashCommandPresentation,
  type ComposerSkillCategory,
  type SlashCommandIconSpec,
} from "./composerSlashCatalog";

export type ComposerCommandItem =
  | {
      id: string;
      type: "path";
      path: string;
      pathKind: ProjectEntry["kind"];
      searchTarget: ComposerPathSearchTarget;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "slash-command";
      command: ComposerSlashCommand;
      label: string;
      description: string;
      descriptionOverride?: string | undefined;
      browserDispatchMode?: "ego-skill" | "ego-command" | "native-command" | undefined;
      egoBrowserSkillName?: string | undefined;
    }
  | {
      id: string;
      type: "provider-slash-command";
      provider: ProviderDriverKind;
      command: ServerProviderSlashCommand;
      label: string;
      description: string;
      skillCategory?: ComposerSkillCategory | undefined;
    }
  | {
      id: "slash:skills-folder";
      type: "skill-group-toggle";
      expanded: boolean;
      personalCount: number;
      builtinCount: number;
      totalCount: number;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "skill";
      provider: ProviderDriverKind;
      skill: ServerProviderSkill;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "pull-request";
      pullRequest: PullRequestContextMetadata;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "thread";
      thread: ScopedThreadRef;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "environment";
      environmentId: EnvironmentId;
      machine: EnvironmentMachineKind;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "model";
      instanceId: ProviderInstanceId;
      model: string;
      driverKind: ProviderDriverKind;
      providerDisplayName: string;
      acpRegistryAgentId: string | undefined;
      acpRegistryIconUrl: string | undefined;
      label: string;
      description: string;
    };

export interface ComposerCommandMenuGroup {
  readonly key: string;
  readonly label: string | null;
  readonly items: ReadonlyArray<ComposerCommandItem>;
}

const PATH_SECTION_LABEL_BY_TYPE: Partial<Record<ComposerCommandItem["type"], string>> = {
  thread: "对话",
  model: "工作 Agent",
  environment: "已连接主机",
  path: "工作区文件",
};

export function groupComposerCommandMenuItems(
  items: ReadonlyArray<ComposerCommandItem>,
  triggerKind: ComposerTriggerKind | null,
): ComposerCommandMenuGroup[] {
  if (items.length === 0) return [];

  if (triggerKind === "path") {
    const sections: Array<{
      key: string;
      type: ComposerCommandItem["type"];
      label: string | null;
      items: ComposerCommandItem[];
    }> = [];

    for (const item of items) {
      const current = sections.at(-1);
      if (current && current.type === item.type) {
        current.items.push(item);
      } else {
        sections.push({
          key: `path-section:${item.type}:${sections.length}`,
          type: item.type,
          label: PATH_SECTION_LABEL_BY_TYPE[item.type] ?? null,
          items: [item],
        });
      }
    }

    if (sections.length <= 1) {
      return [{ key: "default", label: null, items }];
    }

    return sections.map(({ key, label, items: groupItems }) => ({
      key,
      label,
      items: groupItems,
    }));
  }

  if (triggerKind === "slash-command") {
    const hasExpandedSkillsFolder = items.some(
      (item) => item.type === "skill-group-toggle" && item.expanded,
    );
    if (!hasExpandedSkillsFolder) {
      return [{ key: "default", label: null, items }];
    }

    const sections: Array<{
      key: string;
      bucket: "commands" | "personal-skills" | "builtin-skills";
      label: string | null;
      items: ComposerCommandItem[];
    }> = [];

    for (const item of items) {
      const bucket: "commands" | "personal-skills" | "builtin-skills" =
        item.type === "skill"
          ? classifyComposerSkillCategory(resolveProviderSkillSourceKind(item.skill)) === "personal"
            ? "personal-skills"
            : "builtin-skills"
          : item.type === "provider-slash-command" && item.skillCategory !== undefined
            ? item.skillCategory === "personal"
              ? "personal-skills"
              : "builtin-skills"
            : "commands";
      const label =
        bucket === "personal-skills"
          ? "个人技能"
          : bucket === "builtin-skills"
            ? "自带技能"
            : null;
      const current = sections.at(-1);
      if (current && current.bucket === bucket) {
        current.items.push(item);
      } else {
        sections.push({
          key: `slash-section:${bucket}:${sections.length}`,
          bucket,
          label,
          items: [item],
        });
      }
    }

    return sections.map(({ key, label, items: groupItems }) => ({
      key,
      label,
      items: groupItems,
    }));
  }

  return [{ key: "default", label: null, items }];
}

export const ComposerCommandMenu = memo(function ComposerCommandMenu(props: {
  listId: string;
  items: ComposerCommandItem[];
  resolvedTheme: "light" | "dark";
  isLoading: boolean;
  triggerKind: ComposerTriggerKind | null;
  emptyStateText?: string;
  activeItemId: string | null;
  onHighlightedItemChange: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const listRef = useRef<HTMLDivElement>(null);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- scrolls the highlighted menu item's DOM node into view
  useLayoutEffect(() => {
    if (!props.activeItemId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-composer-item-id="${CSS.escape(props.activeItemId)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [props.activeItemId]);

  const groups = groupComposerCommandMenuItems(props.items, props.triggerKind);

  return (
    <Command
      autoHighlight={false}
      mode="none"
      onItemHighlighted={(highlightedValue) => {
        props.onHighlightedItemChange(
          typeof highlightedValue === "string" ? highlightedValue : null,
        );
      }}
    >
      <ComposerBanner.Surface
        ref={listRef}
        className="flex min-h-0 w-full flex-col overflow-hidden pb-(--chat-composer-attachment-overlap) **:data-[slot=command-item]:rounded-lg **:data-[slot=scroll-area-scrollbar]:data-[orientation=vertical]:my-4"
        data-composer-command-drawer="true"
      >
        {props.items.length > 0 ? (
          <CommandList
            id={props.listId}
            aria-label={
              props.triggerKind ? m(LISTBOX_LABEL_BY_TRIGGER[props.triggerKind]) : undefined
            }
            className="max-h-72 min-h-0 scroll-pb-6"
          >
            {groups.map((group) => (
              <CommandGroup key={group.key}>
                {group.label ? (
                  <CommandGroupLabel data-composer-section-label={group.label}>
                    {group.label}
                  </CommandGroupLabel>
                ) : null}
                {group.items.map((item) => (
                  <ComposerCommandMenuItem
                    key={item.id}
                    optionId={composerSuggestionOptionId(props.listId, item.id)}
                    item={item}
                    triggerKind={props.triggerKind}
                    resolvedTheme={props.resolvedTheme}
                    isActive={props.activeItemId === item.id}
                    onHighlight={props.onHighlightedItemChange}
                    onSelect={props.onSelect}
                  />
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        ) : (
          <div className="px-5 pt-3.5 pb-7">
            <p className="text-secondary-label text-xs">
              {props.isLoading
                ? props.triggerKind === "skill" || props.triggerKind === "slash-command"
                  ? gt("Searching workspace skills...")
                  : props.triggerKind === "pull-request"
                    ? gt("Finding pull request...")
                    : gt("Searching workspace files...")
                : (props.emptyStateText ??
                  (props.triggerKind === "skill"
                    ? gt("No skills found. Try / to browse provider commands.")
                    : props.triggerKind === "path"
                      ? gt("No matching files or folders.")
                      : gt("No matching command.")))}
            </p>
          </div>
        )}
      </ComposerBanner.Surface>
    </Command>
  );
});

/** 1:1 native Antigravity `/swarm` pixel queen bee icon (crisp pixel SVG, used exclusively for `/swarm`). */
function SwarmQueenBeeIcon() {
  return (
    <svg
      aria-hidden="true"
      data-slash-icon="swarm-bee"
      viewBox="5 7 18 13"
      shapeRendering="crispEdges"
      className="size-4 shrink-0"
    >
      {/* Ruby-tipped queen crown */}
      <rect x="9" y="7" width="1" height="1" fill="#FFE9A6" />
      <rect x="7" y="8" width="1" height="1" fill="#FFE9A6" />
      <rect x="9" y="8" width="1" height="1" fill="#FFE9A6" />
      <rect x="11" y="8" width="1" height="1" fill="#FFE9A6" />
      <rect x="7" y="9" width="1" height="1" fill="#C98A2B" />
      <rect x="8" y="9" width="1" height="1" fill="#F7CE5B" />
      <rect x="9" y="9" width="1" height="1" fill="#E4566A" />
      <rect x="10" y="9" width="1" height="1" fill="#F7CE5B" />
      <rect x="11" y="9" width="1" height="1" fill="#C98A2B" />
      {/* Translucent wing */}
      <rect x="16" y="9" width="4" height="1" fill="rgba(140,160,192,0.9)" />
      <rect x="15" y="10" width="6" height="1" fill="rgba(140,160,192,0.9)" />
      {/* Body outline & stinger */}
      <rect x="12" y="9" width="2" height="1" fill="#451c1e" />
      <rect x="14" y="9" width="1" height="1" fill="#b1502f" />
      <rect x="15" y="9" width="1" height="1" fill="#451c1e" />
      <rect x="7" y="10" width="2" height="1" fill="#b1502f" />
      <rect x="6" y="11" width="1" height="1" fill="#b1502f" />
      <rect x="19" y="11" width="1" height="1" fill="#451c1e" />
      <rect x="5" y="12" width="1" height="2" fill="#b1502f" />
      <rect x="5" y="14" width="1" height="3" fill="#451c1e" />
      <rect x="20" y="12" width="1" height="5" fill="#451c1e" />
      <rect x="21" y="14" width="2" height="1" fill="#451c1e" />
      <rect x="6" y="17" width="1" height="1" fill="#451c1e" />
      <rect x="19" y="17" width="1" height="1" fill="#451c1e" />
      <rect x="7" y="18" width="2" height="1" fill="#451c1e" />
      <rect x="17" y="18" width="2" height="1" fill="#451c1e" />
      <rect x="9" y="19" width="8" height="1" fill="#451c1e" />
      {/* Golden honey body & dark stripes */}
      <rect x="9" y="10" width="3" height="1" fill="#f8e081" />
      <rect x="12" y="10" width="2" height="1" fill="#5c4a3d" />
      <rect x="14" y="10" width="1" height="1" fill="#e9c349" />
      <rect x="7" y="11" width="2" height="1" fill="#f8e081" />
      <rect x="9" y="11" width="3" height="1" fill="#fef5cd" />
      <rect x="12" y="11" width="2" height="1" fill="#5c4a3d" />
      <rect x="14" y="11" width="1" height="1" fill="#f8e081" />
      <rect x="15" y="11" width="1" height="1" fill="#e9c349" />
      <rect x="16" y="11" width="2" height="1" fill="#392423" />
      <rect x="18" y="11" width="1" height="1" fill="#b1502f" />
      <rect x="6" y="12" width="1" height="3" fill="#e9c349" />
      <rect x="7" y="12" width="5" height="1" fill="#f8e081" />
      <rect x="9" y="12" width="1" height="1" fill="#fef5cd" />
      <rect x="12" y="12" width="2" height="1" fill="#5c4a3d" />
      <rect x="14" y="12" width="2" height="4" fill="#e9c349" />
      <rect x="16" y="12" width="2" height="2" fill="#392423" />
      <rect x="18" y="12" width="1" height="1" fill="#e9c349" />
      <rect x="19" y="12" width="1" height="5" fill="#b1502f" />
      <rect x="7" y="13" width="6" height="1" fill="#f8e081" />
      <rect x="8" y="13" width="1" height="1" fill="#FFFFFF" />
      <rect x="9" y="13" width="1" height="1" fill="#221116" />
      <rect x="13" y="13" width="1" height="4" fill="#392423" />
      <rect x="18" y="13" width="1" height="5" fill="#b1502f" />
      <rect x="7" y="14" width="6" height="3" fill="#e9c349" />
      <rect x="8" y="14" width="2" height="1" fill="#221116" />
      <rect x="16" y="14" width="1" height="1" fill="#392423" />
      <rect x="17" y="14" width="1" height="4" fill="#221116" />
      <rect x="6" y="15" width="1" height="1" fill="rgba(255,128,150,0.45)" />
      <rect x="7" y="15" width="1" height="1" fill="rgba(255,128,150,0.65)" />
      <rect x="16" y="15" width="1" height="4" fill="#221116" />
      <rect x="6" y="16" width="1" height="1" fill="#b1502f" />
      <rect x="12" y="16" width="1" height="1" fill="#392423" />
      <rect x="14" y="16" width="2" height="3" fill="#b1502f" />
      <rect x="7" y="17" width="5" height="1" fill="#b1502f" />
      <rect x="12" y="17" width="2" height="2" fill="#221116" />
      <rect x="9" y="18" width="3" height="1" fill="#b1502f" />
    </svg>
  );
}

function SlashCommandLeadingIcon(props: { icon: SlashCommandIconSpec }) {
  if (props.icon.kind === "swarm-bee") {
    return <SwarmQueenBeeIcon />;
  }
  if (props.icon.kind === "emoji") {
    return (
      <span
        aria-hidden="true"
        data-slash-icon="emoji"
        className="inline-flex size-4 shrink-0 items-center justify-center text-sm leading-none"
      >
        {props.icon.emoji}
      </span>
    );
  }
  const Icon = props.icon.icon;
  return (
    <Icon
      aria-hidden="true"
      data-slash-icon="lucide"
      className="size-4 shrink-0 text-secondary-label"
    />
  );
}

const ComposerCommandMenuItem = memo(function ComposerCommandMenuItem(props: {
  optionId: string;
  item: ComposerCommandItem;
  triggerKind: ComposerTriggerKind | null;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
  onHighlight: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const m = useMessages();
  const isBundledSkillCommand =
    props.item.type === "provider-slash-command" && props.item.skillCategory !== undefined;
  const slashInputHint =
    props.item.type === "provider-slash-command" && !isBundledSkillCommand
      ? props.item.command.input?.hint?.trim() || null
      : null;
  const slashPresentation =
    props.item.type === "slash-command"
      ? resolveSlashCommandPresentation(
          props.item.command,
          props.item.description,
          props.item.descriptionOverride,
        )
      : props.item.type === "provider-slash-command" && !isBundledSkillCommand
        ? resolveSlashCommandPresentation(props.item.command.name, props.item.description)
        : null;
  const skillPresentation =
    props.item.type === "skill"
      ? resolveSkillPresentation(props.item.skill, props.item.description)
      : props.item.type === "provider-slash-command" && props.item.skillCategory !== undefined
        ? resolveBundledSkillCommandPresentation(
            props.item.command.name,
            props.item.description,
            props.item.skillCategory,
          )
        : null;
  const pullRequestPresentation =
    props.item.type === "pull-request" ? resolvePullRequestState(props.item.pullRequest, m) : null;
  const displayedDescription =
    slashPresentation?.description ?? skillPresentation?.description ?? props.item.description;
  const descriptionRef = useRef<HTMLSpanElement>(null);
  const [descriptionTruncated, setDescriptionTruncated] = useState(false);
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- measures the rendered description so only cut-off text gets a tooltip
  useLayoutEffect(() => {
    const description = descriptionRef.current;
    setDescriptionTruncated(
      props.isActive && !!description && description.scrollWidth > description.clientWidth,
    );
  }, [props.isActive]);

  const skillsToggleItem = props.item.type === "skill-group-toggle" ? props.item : null;

  return (
    <CommandItem
      render={<div id={props.optionId} />}
      aria-selected={props.isActive}
      aria-expanded={skillsToggleItem ? skillsToggleItem.expanded : undefined}
      value={props.item.id}
      data-composer-item-id={props.item.id}
      data-composer-skills-toggle={skillsToggleItem ? "1" : undefined}
      active={props.isActive}
      onMouseMove={() => {
        if (!props.isActive) props.onHighlight(props.item.id);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onSelect(props.item);
      }}
    >
      {slashPresentation ? <SlashCommandLeadingIcon icon={slashPresentation.icon} /> : null}
      {skillsToggleItem ? (
        <BlocksIcon aria-hidden="true" className="size-4 shrink-0 text-secondary-label" />
      ) : null}
      {skillPresentation ? (
        <skillPresentation.icon
          aria-hidden="true"
          data-skill-icon="lucide"
          className="size-4 shrink-0 text-secondary-label"
        />
      ) : null}
      {props.item.type === "path" ? (
        <PierreEntryIcon
          pathValue={props.item.path}
          kind={props.item.pathKind}
          theme={props.resolvedTheme}
        />
      ) : null}
      {props.item.type === "thread" ? (
        <MessagesSquareIcon aria-hidden="true" className="size-4 shrink-0 text-secondary-label" />
      ) : null}
      {props.item.type === "environment" ? (
        <EnvironmentMachineIcon
          kind={props.item.machine}
          aria-hidden="true"
          className="size-4 shrink-0 text-secondary-label"
        />
      ) : null}
      {props.item.type === "model" ? (
        <ProviderInstanceIcon
          driverKind={props.item.driverKind}
          displayName={props.item.providerDisplayName}
          instanceId={props.item.instanceId}
          acpRegistryAgentId={props.item.acpRegistryAgentId}
          acpRegistryIconUrl={props.item.acpRegistryIconUrl}
          className="size-4 shrink-0"
          iconClassName="size-4"
        />
      ) : null}
      {pullRequestPresentation ? (
        <pullRequestPresentation.Icon
          role="img"
          aria-label={pullRequestPresentation.label}
          className={cn("size-4 shrink-0", pullRequestPresentation.toneClassName)}
        />
      ) : null}

      {slashPresentation ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {slashPresentation.zhTitle ? (
            <span className="inline-flex max-w-[52%] shrink-0 items-baseline gap-1.5 truncate">
              <span className="shrink-0 font-sans text-xs font-medium text-foreground">
                {slashPresentation.zhTitle}
              </span>
              <span className="truncate font-mono text-2xs text-secondary-label/85">
                {slashPresentation.nativeName}
              </span>
              {slashInputHint ? (
                <span
                  data-slash-input-hint="1"
                  className="truncate font-mono text-2xs text-secondary-label/65"
                >
                  {slashInputHint}
                </span>
              ) : null}
              {slashPresentation.description ? (
                <span aria-hidden="true" className="-ms-1 shrink-0 text-secondary-label text-xs">
                  ：
                </span>
              ) : null}
            </span>
          ) : (
            <span className="inline-flex max-w-[45%] shrink-0 items-baseline gap-1.5 truncate">
              <span className="truncate font-mono text-xs font-medium text-foreground">
                {slashPresentation.nativeName}
              </span>
              {slashInputHint ? (
                <span
                  data-slash-input-hint="1"
                  className="truncate font-mono text-2xs text-secondary-label/65"
                >
                  {slashInputHint}
                </span>
              ) : null}
              {slashPresentation.description ? (
                <span aria-hidden="true" className="-ms-1 shrink-0 text-secondary-label text-xs">
                  ：
                </span>
              ) : null}
            </span>
          )}
          <Tooltip open={descriptionTruncated}>
            <TooltipTrigger
              tabIndex={-1}
              render={
                <span
                  ref={descriptionRef}
                  className="min-w-0 flex-1 truncate text-left text-secondary-label text-xs"
                />
              }
            >
              {slashPresentation.description}
            </TooltipTrigger>
            <TooltipPopup>{slashPresentation.description}</TooltipPopup>
          </Tooltip>
        </span>
      ) : skillsToggleItem ? (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 font-sans text-xs font-medium text-foreground">
            {skillsToggleItem.label}
          </span>
          <span className="min-w-0 flex-1 truncate text-left text-secondary-label text-xs">
            {skillsToggleItem.description}
          </span>
          {skillsToggleItem.expanded ? (
            <ChevronDownIcon
              aria-hidden="true"
              className="ms-auto size-4 shrink-0 text-secondary-label"
            />
          ) : (
            <ChevronRightIcon
              aria-hidden="true"
              className="ms-auto size-4 shrink-0 text-secondary-label"
            />
          )}
        </span>
      ) : skillPresentation ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="inline-flex max-w-[48%] shrink-0 items-baseline gap-1.5 truncate">
            <span className="shrink-0 font-sans text-xs font-medium text-foreground">技能</span>
            <span className="truncate font-mono text-2xs text-secondary-label/85">
              {skillPresentation.nativeName}
            </span>
            {skillPresentation.description ? (
              <span aria-hidden="true" className="-ms-1 shrink-0 text-secondary-label text-xs">
                ：
              </span>
            ) : null}
          </span>
          <Tooltip open={descriptionTruncated}>
            <TooltipTrigger
              tabIndex={-1}
              render={
                <span
                  ref={descriptionRef}
                  className="min-w-0 flex-1 truncate text-left text-secondary-label text-xs"
                />
              }
            >
              {skillPresentation.description}
            </TooltipTrigger>
            <TooltipPopup>{skillPresentation.description}</TooltipPopup>
          </Tooltip>
          <SkillSourceBadge kind={skillPresentation.sourceKind} />
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 max-w-[45%] shrink-0 truncate font-sans text-xs font-medium">
            {props.item.label}
          </span>
          <Tooltip open={descriptionTruncated}>
            <TooltipTrigger
              tabIndex={-1}
              render={
                <span
                  ref={descriptionRef}
                  className="min-w-0 flex-1 truncate text-left text-secondary-label text-xs"
                />
              }
            >
              {displayedDescription}
            </TooltipTrigger>
            <TooltipPopup>{displayedDescription}</TooltipPopup>
          </Tooltip>
          {props.item.type === "thread" ? (
            <Badge className="ms-auto" variant="secondary">
              对话
            </Badge>
          ) : null}
          {props.item.type === "model" ? (
            <Badge className="ms-auto" variant="secondary">
              工作 Agent
            </Badge>
          ) : null}
          {props.item.type === "environment" ? (
            <Badge className="ms-auto" variant="secondary">
              主机
            </Badge>
          ) : null}
        </span>
      )}
    </CommandItem>
  );
});

export function composerSuggestionOptionId(listId: string, itemId: string): string {
  // JSON escapes lone UTF-16 surrogates before URI encoding without losing identity.
  return `${listId}-${encodeURIComponent(JSON.stringify(itemId))}`;
}

const LISTBOX_LABEL_BY_TRIGGER: Record<ComposerTriggerKind, string> = {
  path: msg("Files and folders"),
  "pull-request": msg("Pull requests"),
  "slash-command": msg("Commands"),
  skill: msg("Skills"),
};

function SkillSourceBadge(props: { kind: ProviderSkillSourceKind }) {
  const Icon = SKILL_SOURCE_ICON_BY_KIND[props.kind];
  const label = resolveSkillSourceBadgeLabel(props.kind);
  return (
    <Badge className="ms-auto" variant="secondary">
      <Icon aria-hidden="true" className="text-current" />
      {label}
    </Badge>
  );
}
