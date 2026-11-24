import { useGT, useMessages } from "gt-react";
import {
  legacyThreadPullRequestKey,
  threadPullRequestKeyOf,
} from "@t3tools/client-runtime/thread-pull-requests";
import {
  matchComposerEnvironmentItems,
  matchComposerThreadItems,
  type ComposerEnvironmentCandidate,
  type ComposerEnvironmentItem,
} from "@t3tools/client-runtime/composerThreadItems";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import type {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  PullRequestListInput,
  ServerProvider,
  ThreadId,
  ThreadPullRequestLink,
} from "@t3tools/contracts";
import {
  composerPullRequestsFromLinks,
  filterComposerPullRequestMatches,
  withLinkedComposerPullRequestsFirst,
} from "@t3tools/shared/composerPullRequestMatches";
import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";

import type { ComposerTrigger } from "../../composer-logic";
import type { DraftId } from "../../composerDraftStore";
import { basenameOfPath } from "../../pierre-icons";
import {
  getProviderSkillsForSlashMenu,
  getProviderSlashCommandsForSlashMenu,
  resolveProviderSkillSourceKind,
} from "@t3tools/client-runtime/providerSkills";
import { searchProviderSkills } from "../../providerSkillSearch";
import { useVisibleThreadShells } from "~/state/entities";
import { useEnvironmentIdentities, useEnvironmentMachines } from "~/state/environments";
import { offersLinkedEnvironmentsAtom } from "~/state/peerLinks";
import {
  pullRequestEnvironment,
  usePullRequestList,
  type EnvironmentQueryTarget,
} from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { useComposerPathSearch, useDebouncedValue, useThreadSearch } from "~/state/queries";
import {
  matchesPullRequestQuery,
  rankPullRequestMatches,
} from "../pullRequest/pullRequestList.logic";
import type { ComposerCommandItem } from "./ComposerCommandMenu";
import { matchComposerModelItems } from "./composerModelMentions";
import type { ModelEsque } from "./providerIconUtils";
import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  classifyComposerSkillCategory,
  classifyProviderSlashCommandAsSkill,
  isEgoBrowserIdentifier,
  isHiddenSlashCommand,
  normalizeSlashCommandKey,
  resolveBundledSkillCommandPresentation,
  resolveSkillPresentation,
  resolveSlashCommandPresentation,
} from "./composerSlashCatalog";
import {
  buildComposerSlashMenuItems,
  slashCommandItemsForPromptPosition,
} from "./composerSlashCommandSearch";

const COMPOSER_PULL_REQUEST_LIST_LIMIT = 99;
const COMPOSER_PULL_REQUEST_RESULT_LIMIT = 12;
const COMPOSER_EMPTY_MACHINE_LIMIT = 3;
const MACHINE_MENTION_KEYWORDS = new Set([
  "主机",
  "机器",
  "服务器",
  "主",
  "机",
  "host",
  "machine",
  "server",
]);
const EMPTY_PULL_REQUEST_LIST_TARGETS: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>> =
  [];

function collectLinkedEnvironmentItems(input: {
  readonly environments: ReadonlyArray<ComposerEnvironmentCandidate>;
  readonly linkedEnvironments: ReadonlyMap<EnvironmentId, string>;
  readonly environmentId: EnvironmentId;
  readonly limit: number;
}): ComposerEnvironmentItem[] {
  const paired = new Set(input.environments.map((environment) => environment.environmentId));
  const linkedOnly = Array.from(input.linkedEnvironments, ([envId, label]) => ({
    environmentId: envId,
    label,
    machine: "server" as const,
  })).filter((environment) => !paired.has(environment.environmentId));

  return [...input.environments, ...linkedOnly]
    .filter((environment) => environment.environmentId !== input.environmentId)
    .slice(0, input.limit)
    .map((environment) => ({
      id: `environment:${environment.environmentId}`,
      type: "environment",
      environmentId: environment.environmentId,
      machine: environment.machine,
      label: environment.label,
      description: "已连接主机",
    }));
}

export function buildComposerSlashTriggerItems(input: {
  readonly query: string;
  readonly isAtPromptStart: boolean;
  readonly sideChatAvailable: boolean;
  readonly sideChatOffered?: boolean | undefined;
  readonly sideChatDisabledReason: string | null;
  readonly freshSessionAvailable: boolean;
  readonly compactSlashCommandAvailable: boolean;
  readonly selectedProvider: ProviderDriverKind;
  readonly selectedProviderSkills: ServerProvider["skills"];
  readonly selectedProviderSlashCommands: ServerProvider["slashCommands"];
  readonly showSkillsInSlashMenu: boolean;
  readonly slashSkillsExpanded: boolean;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly labels: {
    readonly switchModel: string;
    readonly askSideQuestion: string;
    readonly compactConversation: string;
    readonly invokeBrowser: string;
    readonly freshSession: string;
    readonly runProviderCommand: string;
    readonly formatScopedSkill: (scope: string) => string;
  };
}): ComposerCommandItem[] {
  const query = input.query.trim().toLowerCase();
  const rawSlashMenuSkills = getProviderSkillsForSlashMenu(
    input.selectedProviderSkills,
    input.showSkillsInSlashMenu,
  );
  const egoBrowserSkill =
    input.selectedProviderSkills.find(
      (skill) => skill.enabled && isEgoBrowserIdentifier(skill.name),
    ) ?? null;
  const egoBrowserSlashCommand =
    input.selectedProviderSlashCommands.find((command) => isEgoBrowserIdentifier(command.name)) ??
    null;
  const nativeBrowserSlashCommand =
    input.selectedProviderSlashCommands.find(
      (command) => normalizeSlashCommandKey(command.name) === "browser",
    ) ?? null;

  // Detect cross-provider `ego-browser` for universal `/browser` promotion, and collect personal
  // skill names so user skills leaked into `slashCommands` fold cleanly under `个人技能`.
  let crossProviderEgoBrowserName: string | null = null;
  const knownPersonalSkillNames = new Set<string>();
  for (const skill of input.selectedProviderSkills) {
    if (
      !isEgoBrowserIdentifier(skill.name) &&
      classifyComposerSkillCategory(resolveProviderSkillSourceKind(skill)) === "personal"
    ) {
      knownPersonalSkillNames.add(normalizeSlashCommandKey(skill.name));
    }
  }
  for (const entry of input.instanceEntries) {
    const providerSkills = [
      ...entry.snapshot.skills,
      ...(entry.snapshot.workspaceSnapshots?.flatMap((ws) => ws.skills) ?? []),
    ];
    for (const skill of providerSkills) {
      if (isEgoBrowserIdentifier(skill.name)) {
        if (skill.enabled && crossProviderEgoBrowserName === null) {
          crossProviderEgoBrowserName = skill.name;
        }
        continue;
      }
      if (classifyComposerSkillCategory(resolveProviderSkillSourceKind(skill)) === "personal") {
        knownPersonalSkillNames.add(normalizeSlashCommandKey(skill.name));
      }
    }
    if (crossProviderEgoBrowserName === null) {
      const providerSlashCommands = [
        ...entry.snapshot.slashCommands,
        ...(entry.snapshot.workspaceSnapshots?.flatMap((ws) => ws.slashCommands) ?? []),
      ];
      const matchedEgoCommand = providerSlashCommands.find((command) =>
        isEgoBrowserIdentifier(command.name),
      );
      if (matchedEgoCommand) {
        crossProviderEgoBrowserName = matchedEgoCommand.name;
      }
    }
  }

  const browserDispatchMode = egoBrowserSkill
    ? ("ego-skill" as const)
    : egoBrowserSlashCommand
      ? ("ego-command" as const)
      : nativeBrowserSlashCommand
        ? ("native-command" as const)
        : crossProviderEgoBrowserName
          ? ("ego-skill" as const)
          : null;
  const hasBrowserControl = browserDispatchMode !== null;
  const usesEgoBrowser =
    browserDispatchMode === "ego-skill" || browserDispatchMode === "ego-command";
  const resolvedEgoBrowserName =
    egoBrowserSkill?.name ??
    egoBrowserSlashCommand?.name ??
    crossProviderEgoBrowserName ??
    "ego-browser";

  const showUniversalBtw = (input.sideChatOffered ?? input.sideChatAvailable) || input.sideChatAvailable;
  const btwDescriptionOverride =
    input.sideChatDisabledReason === null
      ? undefined
      : !input.sideChatAvailable
        ? "在不打断主线程的前提下发起旁路支线提问（发送首条消息后可用）"
        : input.sideChatDisabledReason;
  const compactDescriptionOverride = input.compactSlashCommandAvailable
    ? undefined
    : "总结并压缩当前对话历史，释放上下文窗口（有对话记录后可用）";
  const browserDescription = usesEgoBrowser
    ? "调用 ego-browser 操控真实浏览器，打开网页、填写表单、截屏与交互测试"
    : resolveSlashCommandPresentation("browser", input.labels.invokeBrowser).description;

  const builtInSlashCommandItems = [
    {
      id: "slash:model",
      type: "slash-command",
      command: "model",
      label: "/model",
      description: resolveSlashCommandPresentation("model", input.labels.switchModel).description,
    },
    ...(showUniversalBtw
      ? ([
          {
            id: "slash:btw",
            type: "slash-command",
            command: "btw",
            label: "/btw",
            description: resolveSlashCommandPresentation(
              "btw",
              input.labels.askSideQuestion,
              btwDescriptionOverride,
            ).description,
            ...(btwDescriptionOverride ? { descriptionOverride: btwDescriptionOverride } : {}),
          },
          // Keep `/side` searchable when explicitly typed without duplicating `/btw` on bare `/`.
          ...(query.length > 0 && ("side".includes(query) || "侧聊".includes(query))
            ? ([
                {
                  id: "slash:side",
                  type: "slash-command",
                  command: "side",
                  label: "/side",
                  description: resolveSlashCommandPresentation(
                    "side",
                    input.labels.askSideQuestion,
                    btwDescriptionOverride,
                  ).description,
                  ...(btwDescriptionOverride
                    ? { descriptionOverride: btwDescriptionOverride }
                    : {}),
                },
              ] as const)
            : []),
        ] as const)
      : []),
    {
      id: "slash:compact",
      type: "slash-command",
      command: "compact",
      label: "/compact",
      description: resolveSlashCommandPresentation(
        "compact",
        input.labels.compactConversation,
        compactDescriptionOverride,
      ).description,
      ...(compactDescriptionOverride ? { descriptionOverride: compactDescriptionOverride } : {}),
    },
    ...(browserDispatchMode !== null
      ? ([
          {
            id: "slash:browser",
            type: "slash-command",
            command: "browser",
            label: "/browser",
            description: browserDescription,
            descriptionOverride: browserDescription,
            browserDispatchMode,
            ...(usesEgoBrowser ? { egoBrowserSkillName: resolvedEgoBrowserName } : {}),
          },
        ] as const)
      : []),
    ...(input.freshSessionAvailable
      ? ([
          {
            id: "slash:clear",
            type: "slash-command",
            command: "clear",
            label: "/clear",
            description: resolveSlashCommandPresentation("clear", input.labels.freshSession)
              .description,
          },
        ] as const)
      : []),
  ] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;

  // Promote `ego-browser` out of the skills folder into top-level `浏览器操控`.
  const slashMenuSkills = rawSlashMenuSkills.filter((skill) => !isEgoBrowserIdentifier(skill.name));
  const providerSlashCommandItems = getProviderSlashCommandsForSlashMenu(
    input.selectedProviderSlashCommands,
    rawSlashMenuSkills,
  )
    .filter((command) => {
      const normalized = normalizeSlashCommandKey(command.name);
      if (isHiddenSlashCommand(normalized)) return false;
      if (isEgoBrowserIdentifier(normalized)) return false;
      if (normalized === "browser" && hasBrowserControl) return false;
      if (normalized === "compact") return false;
      if (normalized === "model") return false;
      if ((normalized === "btw" || normalized === "side") && showUniversalBtw) return false;
      if (normalized === "clear" && input.freshSessionAvailable) return false;
      return true;
    })
    .map((command) => {
      const fallbackDescription =
        command.description ?? command.input?.hint ?? input.labels.runProviderCommand;
      const skillCategory = classifyProviderSlashCommandAsSkill(
        command.name,
        command.description ?? "",
        knownPersonalSkillNames,
      );
      return {
        id: `provider-slash-command:${input.selectedProvider}:${command.name}`,
        type: "provider-slash-command" as const,
        provider: input.selectedProvider,
        command,
        label: `/${command.name}`,
        description:
          skillCategory !== null
            ? resolveBundledSkillCommandPresentation(
                command.name,
                fallbackDescription,
                skillCategory,
              ).description
            : resolveSlashCommandPresentation(command.name, fallbackDescription).description,
        ...(skillCategory !== null ? { skillCategory } : {}),
      };
    });
  const skillItems = slashMenuSkills.map((skill) => {
    const fallbackDescription =
      skill.shortDescription ??
      skill.description ??
      (skill.scope ? input.labels.formatScopedSkill(skill.scope) : "");
    return {
      id: `skill:${input.selectedProvider}:${skill.name}`,
      type: "skill" as const,
      provider: input.selectedProvider,
      skill,
      label: `/skill:${skill.name}`,
      description: resolveSkillPresentation(skill, fallbackDescription).description,
    };
  });
  const slashCommandItems = slashCommandItemsForPromptPosition(
    [...builtInSlashCommandItems, ...providerSlashCommandItems, ...skillItems],
    input.isAtPromptStart,
  );
  return buildComposerSlashMenuItems({
    items: slashCommandItems,
    query,
    skillsExpanded: input.slashSkillsExpanded,
  });
}

export function buildComposerSkillTriggerItems(input: {
  readonly query: string;
  readonly selectedProvider: ProviderDriverKind;
  readonly selectedProviderSkills: ServerProvider["skills"];
  readonly labels: {
    readonly runProviderSkill: string;
    readonly formatScopedSkill: (scope: string) => string;
  };
}): ComposerCommandItem[] {
  const visibleSkills = input.selectedProviderSkills.filter(
    (skill) => !isEgoBrowserIdentifier(skill.name),
  );
  const searchedSkills = searchProviderSkills(visibleSkills, input.query);
  const orderedSkills =
    input.query.trim().length === 0
      ? [
          ...searchedSkills.filter(
            (skill) =>
              classifyComposerSkillCategory(resolveProviderSkillSourceKind(skill)) === "personal",
          ),
          ...searchedSkills.filter(
            (skill) =>
              classifyComposerSkillCategory(resolveProviderSkillSourceKind(skill)) === "builtin",
          ),
        ]
      : searchedSkills;
  return orderedSkills.map((skill) => {
    const fallbackDescription =
      skill.shortDescription ??
      skill.description ??
      (skill.scope ? input.labels.formatScopedSkill(skill.scope) : input.labels.runProviderSkill);
    return {
      id: `skill:${input.selectedProvider}:${skill.name}`,
      type: "skill" as const,
      provider: input.selectedProvider,
      skill,
      label: formatProviderSkillDisplayName(skill),
      description: resolveSkillPresentation(skill, fallbackDescription).description,
    };
  });
}

/** Builds the @, /, $ and # suggestion lists, running the searches each trigger needs. */
export function useComposerMenuItems({
  composerTrigger,
  environmentId,
  linkedEnvironments,
  gitCwd,
  activeThreadId,
  pullRequestProjectId,
  pullRequestRepository,
  threadPullRequests,
  sideChatAvailable,
  sideChatOffered,
  sideChatDisabledReason,
  freshSessionAvailable,
  compactSlashCommandAvailable,
  selectedProvider,
  selectedProviderSkills,
  selectedProviderSlashCommands,
  showSkillsInSlashMenu,
  slashSkillsExpanded = false,
  workspaceSkillsScanning,
  questionAttachmentTarget,
  modelMentions,
}: {
  readonly composerTrigger: ComposerTrigger | null;
  readonly environmentId: EnvironmentId;
  readonly linkedEnvironments: ReadonlyMap<EnvironmentId, string>;
  readonly gitCwd: string | null;
  readonly activeThreadId: ThreadId | null;
  readonly pullRequestProjectId: ProjectId | null;
  readonly pullRequestRepository: string | null;
  readonly threadPullRequests: ReadonlyArray<ThreadPullRequestLink> | undefined;
  readonly sideChatAvailable: boolean;
  readonly sideChatOffered?: boolean | undefined;
  readonly sideChatDisabledReason: string | null;
  readonly freshSessionAvailable: boolean;
  readonly compactSlashCommandAvailable: boolean;
  readonly selectedProvider: ProviderDriverKind;
  readonly selectedProviderSkills: ServerProvider["skills"];
  readonly selectedProviderSlashCommands: ServerProvider["slashCommands"];
  readonly showSkillsInSlashMenu: boolean;
  readonly slashSkillsExpanded?: boolean;
  readonly workspaceSkillsScanning: boolean;
  readonly questionAttachmentTarget: DraftId | null;
  readonly modelMentions: {
    readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
    readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  };
}) {
  const gt = useGT();
  const messages = useMessages();
  // Thread mentions rank by recency as of when the composer mounted.
  const [now] = useState(() => Date.now());
  const composerTriggerKind = composerTrigger?.kind ?? null;
  const pathTriggerQuery = composerTrigger?.kind === "path" ? composerTrigger.query : "";
  const pullRequestTriggerQuery =
    composerTrigger?.kind === "pull-request" ? composerTrigger.query : "";
  const pullRequestTextQuery =
    composerTriggerKind === "pull-request" &&
    pullRequestTriggerQuery.length > 0 &&
    !/^\d+$/u.test(pullRequestTriggerQuery)
      ? pullRequestTriggerQuery
      : null;
  const debouncedPullRequestTextQuery = useDebouncedValue(pullRequestTextQuery, 180);
  const settledPullRequestTextQuery =
    pullRequestTextQuery === debouncedPullRequestTextQuery ? pullRequestTextQuery : null;
  const isPathTrigger = composerTriggerKind === "path";
  const environmentThreadShells = useVisibleThreadShells(isPathTrigger);
  // Mounts older settled threads matching the mention, here and on linked machines, which shells
  // may leave out.
  useThreadSearch(
    isPathTrigger ? [environmentId, ...linkedEnvironments.keys()] : [],
    pathTriggerQuery,
    { titlesOnly: true },
  );
  // The user's machines feed `@` machine matches; the catalog summary is cheap and stable.
  const environmentIdentities = useEnvironmentIdentities();
  const environmentMachines = useEnvironmentMachines();
  const offersMachines = useAtomValue(offersLinkedEnvironmentsAtom(environmentId));
  const mentionableEnvironments = environmentIdentities.map((identity) => ({
    ...identity,
    machine: environmentMachines.get(identity.environmentId) ?? ("server" as const),
  }));
  const workspaceEntries = useComposerPathSearch(
    {
      environmentId,
      cwd: isPathTrigger ? gitCwd : null,
      query: isPathTrigger ? pathTriggerQuery : null,
    },
    messages,
  );

  const pullRequestListTargets =
    composerTriggerKind !== "pull-request" ||
    pullRequestProjectId === null ||
    (pullRequestTextQuery !== null && settledPullRequestTextQuery === null)
      ? EMPTY_PULL_REQUEST_LIST_TARGETS
      : [
          {
            environmentId,
            input: {
              state: "all" as const,
              projectId: pullRequestProjectId,
              limit: COMPOSER_PULL_REQUEST_LIST_LIMIT,
              ...(settledPullRequestTextQuery === null
                ? {}
                : { query: settledPullRequestTextQuery }),
            },
          },
        ];
  const pullRequestLookup = usePullRequestList(pullRequestListTargets);
  const pullRequestTriggerNumber = (() => {
    if (composerTrigger?.kind !== "pull-request" || composerTrigger.query.length === 0) {
      return null;
    }
    const number = Number(composerTrigger.query);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  })();
  const debouncedPullRequestNumber = useDebouncedValue(pullRequestTriggerNumber, 180);
  const settledPullRequestNumber =
    pullRequestTriggerNumber === debouncedPullRequestNumber ? pullRequestTriggerNumber : null;
  const recentHasExactPullRequest =
    settledPullRequestNumber !== null &&
    pullRequestLookup.data?.entries.some(
      (entry) =>
        entry.projectId === pullRequestProjectId &&
        entry.repository.trim().toLowerCase() === pullRequestRepository?.trim().toLowerCase() &&
        entry.number === settledPullRequestNumber,
    ) === true;
  const exactPullRequestLookup = useEnvironmentQuery(
    settledPullRequestNumber === null ||
      pullRequestProjectId === null ||
      pullRequestRepository === null ||
      recentHasExactPullRequest
      ? null
      : pullRequestEnvironment.detail({
          environmentId,
          input: {
            projectId: pullRequestProjectId,
            repository: pullRequestRepository,
            number: settledPullRequestNumber,
          },
        }),
  );

  const linkedPullRequests =
    pullRequestProjectId === null
      ? []
      : composerPullRequestsFromLinks(threadPullRequests ?? [], pullRequestProjectId);

  const items = ((): ComposerCommandItem[] => {
    if (!composerTrigger) return [];
    if (composerTrigger.kind === "path") {
      const trimmedPathQuery = composerTrigger.query.trim();
      const normalizedPathQuery = trimmedPathQuery.toLowerCase();
      const environmentItems =
        questionAttachmentTarget === null && offersMachines
          ? trimmedPathQuery.length === 0 || MACHINE_MENTION_KEYWORDS.has(normalizedPathQuery)
            ? collectLinkedEnvironmentItems({
                environments: mentionableEnvironments,
                linkedEnvironments,
                environmentId,
                limit: COMPOSER_EMPTY_MACHINE_LIMIT,
              })
            : matchComposerEnvironmentItems(
                {
                  environments: mentionableEnvironments,
                  linkedEnvironments,
                  environmentId,
                  query: composerTrigger.query,
                },
                messages,
              )
          : [];
      return [
        ...matchComposerThreadItems(
          {
            shells: environmentThreadShells,
            environmentId,
            linkedEnvironments,
            excludeThreadId: activeThreadId,
            query: composerTrigger.query,
            now,
            includeRecentOnEmptyQuery: true,
          },
          messages,
        ),
        ...matchComposerModelItems({
          instanceEntries: modelMentions.instanceEntries,
          modelOptionsByInstance: modelMentions.modelOptionsByInstance,
          query: composerTrigger.query,
          includeReadyAgentsOnEmptyQuery: true,
        }),
        // An answer to an agent's question carries thread links, not machines.
        ...environmentItems,
        ...workspaceEntries.entries.map((entry) => ({
          id: `path:${entry.kind}:${entry.path}`,
          type: "path" as const,
          path: entry.path,
          pathKind: entry.kind,
          searchTarget: workspaceEntries.searchedTarget,
          label: basenameOfPath(entry.path).normalize("NFC"),
          description: entry.path
            .slice(0, Math.max(0, entry.path.lastIndexOf("/")))
            .normalize("NFC"),
        })),
      ];
    }
    if (composerTrigger.kind === "slash-command") {
      return buildComposerSlashTriggerItems({
        query: composerTrigger.query,
        isAtPromptStart: composerTrigger.rangeStart === 0,
        sideChatAvailable,
        sideChatOffered,
        sideChatDisabledReason,
        freshSessionAvailable,
        compactSlashCommandAvailable,
        selectedProvider,
        selectedProviderSkills,
        selectedProviderSlashCommands,
        showSkillsInSlashMenu,
        slashSkillsExpanded,
        instanceEntries: modelMentions.instanceEntries,
        labels: {
          switchModel: gt("Switch response model for this thread"),
          askSideQuestion: gt("Ask a side question in a new side chat"),
          compactConversation: gt("Summarize the conversation and reduce context usage"),
          invokeBrowser: gt("Invoke a browser agent for web tasks."),
          freshSession: gt("Start a fresh session; earlier messages stay visible"),
          runProviderCommand: gt("Run provider command"),
          formatScopedSkill: (scope) => gt("{scope} skill", { scope }),
        },
      });
    }
    if (composerTrigger.kind === "skill") {
      return buildComposerSkillTriggerItems({
        query: composerTrigger.query,
        selectedProvider,
        selectedProviderSkills,
        labels: {
          runProviderSkill: gt("Run provider skill"),
          formatScopedSkill: (scope) => gt("{scope} skill", { scope }),
        },
      });
    }
    if (
      composerTrigger.kind === "pull-request" &&
      pullRequestProjectId !== null &&
      pullRequestRepository !== null
    ) {
      const exactPullRequest =
        exactPullRequestLookup.data?.number === pullRequestTriggerNumber
          ? [
              {
                ...exactPullRequestLookup.data,
                // Only the host: the URL's full repository path would not match the project's selector.
                host: legacyThreadPullRequestKey(exactPullRequestLookup.data).host,
              },
            ]
          : [];
      const matches = /^\d*$/u.test(composerTrigger.query)
        ? filterComposerPullRequestMatches({
            keyOf: threadPullRequestKeyOf,
            entries: [...exactPullRequest, ...(pullRequestLookup.data?.entries ?? [])],
            linked: linkedPullRequests,
            projectId: pullRequestProjectId,
            repository: pullRequestRepository,
            query: composerTrigger.query,
            limit: COMPOSER_PULL_REQUEST_RESULT_LIMIT,
          })
        : withLinkedComposerPullRequestsFirst({
            keyOf: threadPullRequestKeyOf,
            matches: rankPullRequestMatches(
              (pullRequestLookup.data?.entries ?? []).filter((entry) => {
                if (
                  entry.projectId !== pullRequestProjectId ||
                  entry.repository.trim().toLowerCase() !==
                    pullRequestRepository.trim().toLowerCase()
                ) {
                  return false;
                }
                const provider = pullRequestLookup.data?.providers.find(
                  (candidate) => candidate.host === entry.host,
                );
                return (
                  provider?.searchesOnHost === true ||
                  matchesPullRequestQuery(entry, composerTrigger.query)
                );
              }),
              composerTrigger.query,
            ),
            linked: linkedPullRequests,
            query: composerTrigger.query,
            limit: COMPOSER_PULL_REQUEST_RESULT_LIMIT,
          });
      return matches.map((pullRequest) => ({
        id: `pull-request:${pullRequest.projectId}:${threadPullRequestKeyOf(pullRequest)}`,
        type: "pull-request",
        pullRequest: {
          number: pullRequest.number,
          title: pullRequest.title,
          url: pullRequest.url,
          headBranch: pullRequest.headBranch,
          baseBranch: pullRequest.baseBranch,
          state: pullRequest.state,
          isDraft: pullRequest.isDraft,
        },
        label: `#${pullRequest.number}`,
        description:
          pullRequest.repository.trim().toLowerCase() === pullRequestRepository.trim().toLowerCase()
            ? pullRequest.title
            : `${pullRequest.repository} · ${pullRequest.title}`,
      }));
    }
    return [];
  })();
  const isLoading =
    (composerTriggerKind === "path" && workspaceEntries.isPending) ||
    ((composerTriggerKind === "skill" || composerTriggerKind === "slash-command") &&
      workspaceSkillsScanning) ||
    (composerTriggerKind === "pull-request" &&
      pullRequestProjectId !== null &&
      pullRequestRepository !== null &&
      (pullRequestLookup.isPending ||
        pullRequestTextQuery !== debouncedPullRequestTextQuery ||
        pullRequestTriggerNumber !== debouncedPullRequestNumber ||
        exactPullRequestLookup.isPending));
  const emptyState = (() => {
    if (composerTriggerKind === "skill") {
      return gt("No skills found. Try / to browse provider commands.");
    }
    if (composerTriggerKind === "pull-request") {
      if (pullRequestProjectId === null || pullRequestRepository === null) {
        return gt("Pull requests are not available for this project.");
      }
      if (
        pullRequestLookup.error !== null ||
        pullRequestLookup.data?.errors.some((error) => error.projectId === pullRequestProjectId)
      ) {
        return gt("Pull requests could not be read for this project.");
      }
      return composerTrigger?.query
        ? gt("No pull request matches {query}.", { query: composerTrigger.query })
        : gt("No pull requests found in this repository.");
    }
    return composerTriggerKind === "path"
      ? gt("No matching files or folders.")
      : gt("No matching command.");
  })();

  return { items, isLoading, emptyState };
}
