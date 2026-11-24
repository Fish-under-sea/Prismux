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
      const builtInSlashCommandItems = [
        {
          id: "slash:model",
          type: "slash-command",
          command: "model",
          label: "/model",
          description: resolveSlashCommandPresentation(
            "model",
            gt("Switch response model for this thread"),
          ).description,
        },
        ...(sideChatAvailable
          ? ([
              {
                id: "slash:side",
                type: "slash-command",
                command: "side",
                label: "/side",
                description: resolveSlashCommandPresentation(
                  "side",
                  gt("Ask a side question in a new side chat"),
                  sideChatDisabledReason,
                ).description,
                ...(sideChatDisabledReason ? { descriptionOverride: sideChatDisabledReason } : {}),
              },
              {
                id: "slash:btw",
                type: "slash-command",
                command: "btw",
                label: "/btw",
                description: resolveSlashCommandPresentation(
                  "btw",
                  gt("Same as /side"),
                  sideChatDisabledReason,
                ).description,
                ...(sideChatDisabledReason ? { descriptionOverride: sideChatDisabledReason } : {}),
              },
            ] as const)
          : []),
        ...(freshSessionAvailable
          ? ([
              {
                id: "slash:clear",
                type: "slash-command",
                command: "clear",
                label: "/clear",
                description: resolveSlashCommandPresentation(
                  "clear",
                  gt("Start a fresh session; earlier messages stay visible"),
                ).description,
              },
            ] as const)
          : []),
      ] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;
      const slashMenuSkills = getProviderSkillsForSlashMenu(
        selectedProviderSkills,
        showSkillsInSlashMenu,
      );
      const providerSlashCommandItems = getProviderSlashCommandsForSlashMenu(
        selectedProviderSlashCommands,
        slashMenuSkills,
      ).map((command) => {
        const fallbackDescription =
          command.description ?? command.input?.hint ?? gt("Run provider command");
        return {
          id: `provider-slash-command:${selectedProvider}:${command.name}`,
          type: "provider-slash-command" as const,
          provider: selectedProvider,
          command,
          label: `/${command.name}`,
          description: resolveSlashCommandPresentation(command.name, fallbackDescription)
            .description,
        };
      });
      const query = composerTrigger.query.trim().toLowerCase();
      const skillItems = slashMenuSkills.map((skill) => {
        const fallbackDescription =
          skill.shortDescription ??
          skill.description ??
          (skill.scope ? gt("{scope} skill", { scope: skill.scope }) : "");
        return {
          id: `skill:${selectedProvider}:${skill.name}`,
          type: "skill" as const,
          provider: selectedProvider,
          skill,
          label: `/skill:${skill.name}`,
          description: resolveSkillPresentation(skill, fallbackDescription).description,
        };
      });
      // T3's `/clear` replaces the provider's, which would clear a session T3 still treats as live.
      const visibleProviderSlashCommandItems = providerSlashCommandItems.filter(
        (item) =>
          (item.command.name !== "compact" || compactSlashCommandAvailable) &&
          (item.command.name !== "clear" || !freshSessionAvailable),
      );
      const slashCommandItems = slashCommandItemsForPromptPosition(
        [...builtInSlashCommandItems, ...visibleProviderSlashCommandItems, ...skillItems],
        composerTrigger.rangeStart === 0,
      );
      return buildComposerSlashMenuItems({
        items: slashCommandItems,
        query,
        skillsExpanded: slashSkillsExpanded,
      });
    }
    if (composerTrigger.kind === "skill") {
      const searchedSkills = searchProviderSkills(selectedProviderSkills, composerTrigger.query);
      const orderedSkills =
        composerTrigger.query.trim().length === 0
          ? [
              ...searchedSkills.filter(
                (skill) =>
                  classifyComposerSkillCategory(resolveProviderSkillSourceKind(skill)) ===
                  "personal",
              ),
              ...searchedSkills.filter(
                (skill) =>
                  classifyComposerSkillCategory(resolveProviderSkillSourceKind(skill)) ===
                  "builtin",
              ),
            ]
          : searchedSkills;
      return orderedSkills.map((skill) => {
        const fallbackDescription =
          skill.shortDescription ??
          skill.description ??
          (skill.scope ? gt("{scope} skill", { scope: skill.scope }) : gt("Run provider skill"));
        return {
          id: `skill:${selectedProvider}:${skill.name}`,
          type: "skill" as const,
          provider: selectedProvider,
          skill,
          label: formatProviderSkillDisplayName(skill),
          description: resolveSkillPresentation(skill, fallbackDescription).description,
        };
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
