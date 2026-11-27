import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
} from "@prismux/core-contracts";
import { projectComposerContextForProvider } from "@prismux/core-shared/composerContextReferences";
import { scopeThreadRef } from "@prismux/client-runtime/environment";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  collapseExpandedComposerCursor,
  expandCollapsedComposerCursor,
} from "../../composer-logic";
import { splitPromptIntoComposerSegments } from "../../composer-editor-mentions";
import {
  DraftId,
  partializeComposerDraftStoreState,
  useComposerDraftStore,
} from "../../composerDraftStore";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { attachBtwReadOnlyGuardrailContext, hasUserVisibleMessageContext } from "./btwMode";
import { attachComposerCollaboratorsToContext } from "./chatViewSend";
import {
  addCollaboratorModelRow,
  attachCollaboratorsContext,
  buildCollaboratorsContextRecord,
  COLLABORATOR_WAIVER_ROUTE,
  COLLABORATORS_DIRECTIVE_CONTEXT_ID,
  evaluateCollaboratorGovernance,
  formatCollaboratorsDirective,
  getProviderCollaboratorCount,
  getRemainingCollaboratorCapacity,
  getRemainingProviderCollaboratorCapacity,
  getTotalCollaboratorCount,
  MAX_COLLABORATOR_COUNT_PER_AGENT,
  MAX_TOTAL_COLLABORATOR_COUNT,
  normalizeCollaboratorSelections,
  pruneLockedCollaborators,
  removeCollaboratorProvider,
  removeCollaboratorSelection,
  resolveCollaboratorDescriptors,
  setCollaboratorModel,
  stepCollaboratorCount,
  toggleCollaboratorSelection,
  type CollaboratorProviderProbeLike,
  type CollaboratorWaiverPolicy,
  type ComposerCollaboratorSelection,
} from "./composerCollaborators.logic";
import {
  collectLeadingSlashCommandTokens,
  isAtLeadingSlashCommandPosition,
} from "./ComposerSlashCommandChip";
import { resolveSlashCommandPresentation } from "./composerSlashCatalog";
import { buildComposerSlashTriggerItems } from "./useComposerMenuItems";

function makeProviderEntry(input: {
  instanceId: string;
  driverKind: string;
  displayName: string;
  models?: Array<{ slug: string; name: string }>;
  auth?: ServerProvider["auth"];
}): ProviderInstanceEntry {
  const instanceId = ProviderInstanceId.make(input.instanceId);
  const driverKind = ProviderDriverKind.make(input.driverKind);
  const models = input.models ?? [{ slug: "default-model", name: "Default Model" }];
  const snapshot: ServerProvider = {
    instanceId,
    driver: driverKind,
    displayName: input.displayName,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: input.auth ?? { status: "authenticated" },
    checkedAt: "2026-11-27T00:00:00.000Z",
    models: models.map((model) => ({
      slug: model.slug,
      name: model.name,
      isCustom: false,
      capabilities: null,
    })),
    slashCommands: [],
    skills: [],
  };
  return {
    instanceId,
    driverKind,
    displayName: input.displayName,
    enabled: true,
    installed: true,
    status: "ready",
    isDefault: true,
    isAvailable: true,
    snapshot,
    models: snapshot.models,
  };
}

const dshEntry = makeProviderEntry({
  instanceId: "dsh",
  driverKind: "dsh",
  displayName: "DeepSeek Harness",
  models: [
    { slug: "deepseek-reasoner", name: "DeepSeek Reasoner" },
    { slug: "deepseek-chat", name: "DeepSeek Chat" },
  ],
});

const codexApiEntry = makeProviderEntry({
  instanceId: "codex",
  driverKind: "codex",
  displayName: "Codex",
  models: [
    { slug: "gpt-5.4", name: "GPT-5.4" },
    { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
  ],
});

const claudeOAuthEntry = makeProviderEntry({
  instanceId: "claudeAgent",
  driverKind: "claudeAgent",
  displayName: "Claude Code",
  auth: { status: "authenticated", type: "oauth", subscriptionType: "max" },
  models: [{ slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }],
});

const agyEntry = makeProviderEntry({
  instanceId: "antigravity",
  driverKind: "antigravity",
  displayName: "Antigravity",
  models: [{ slug: "gemini-2.5-pro", name: "Gemini 2.5 Pro" }],
});

const ollamaEntry = makeProviderEntry({
  instanceId: "ollama",
  driverKind: "ollama",
  displayName: "Ollama",
  models: [{ slug: "qwen3-coder:32b", name: "Qwen3 Coder 32B" }],
});

const ALL_ENTRIES = [dshEntry, codexApiEntry, claudeOAuthEntry, agyEntry, ollamaEntry] as const;

const LOCKED_WAIVER: CollaboratorWaiverPolicy = {
  signed: false,
  allowAntigravityAsControlledAgent: false,
  allowExternalSubscriptionAgentsInSwarm: false,
};

const SIGNED_BOTH_OFF_WAIVER: CollaboratorWaiverPolicy = {
  signed: true,
  allowAntigravityAsControlledAgent: false,
  allowExternalSubscriptionAgentsInSwarm: false,
};

const SIGNED_FULL_WAIVER: CollaboratorWaiverPolicy = {
  signed: true,
  allowAntigravityAsControlledAgent: true,
  allowExternalSubscriptionAgentsInSwarm: true,
};

const DEFAULT_PROBES: ReadonlyArray<CollaboratorProviderProbeLike> = [
  { providerId: "dsh", authMode: "api_or_custom" },
  { providerId: "codex", authMode: "api_or_custom" },
  { providerId: "claude", authMode: "subscription_oauth" },
  { providerId: "antigravity", authMode: "subscription_oauth" },
  { providerId: "ollama", authMode: "local" },
];

describe("composerCollaborators.logic — 0-byte no-op & directive serialization", () => {
  it("injects strictly 0 bytes and leaves context untouched when no collaborators are selected", () => {
    expect(formatCollaboratorsDirective([], ALL_ENTRIES)).toBe("");
    expect(buildCollaboratorsContextRecord([], ALL_ENTRIES)).toBeNull();
    expect(attachCollaboratorsContext(undefined, [], ALL_ENTRIES)).toBeUndefined();

    const existing = attachBtwReadOnlyGuardrailContext(undefined);
    const untouched = attachComposerCollaboratorsToContext({
      context: existing,
      collaborators: [],
      providerInstanceEntries: ALL_ENTRIES,
      probes: DEFAULT_PROBES,
      waiver: LOCKED_WAIVER,
    });
    expect(untouched).toBe(existing);
  });

  it("serializes an ultra-lean <prismux_collaborators> block (< 250 bytes) with exact targets, models & counts", () => {
    const selections: ComposerCollaboratorSelection[] = [
      {
        providerInstanceId: dshEntry.instanceId,
        model: "deepseek-reasoner",
        maxCount: 2,
      },
      {
        providerInstanceId: codexApiEntry.instanceId,
        model: "gpt-5.4",
        maxCount: 1,
      },
    ];

    const directive = formatCollaboratorsDirective(selections, ALL_ENTRIES);
    const bytes = new TextEncoder().encode(directive).byteLength;

    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(250);
    expect(directive).toContain("<prismux_collaborators>");
    expect(directive).toContain("</prismux_collaborators>");
    expect(directive).toContain("delegate_task");
    expect(directive).toContain("Optional");
    expect(directive).toContain("never exceed max");
    expect(directive).toContain("- dsh|DeepSeek Harness|deepseek-reasoner|max=2");
    expect(directive).toContain("- codex|Codex|gpt-5.4|max=1");
  });

  it("projects invisibly via message.context while keeping user bubble text 100% clean", () => {
    const selections: ComposerCollaboratorSelection[] = [
      { providerInstanceId: dshEntry.instanceId, model: "deepseek-reasoner", maxCount: 2 },
    ];
    const context = attachComposerCollaboratorsToContext({
      context: undefined,
      collaborators: selections,
      providerInstanceEntries: ALL_ENTRIES,
      probes: DEFAULT_PROBES,
      waiver: LOCKED_WAIVER,
    });

    expect(context).toBeDefined();
    expect(context?.records).toHaveLength(1);
    expect(context?.records[0]?.contextId).toBe(COLLABORATORS_DIRECTIVE_CONTEXT_ID);
    expect(hasUserVisibleMessageContext(context)).toBe(false);

    const projected = projectComposerContextForProvider({
      text: "请帮我重构登录模块",
      records: context!.records,
    });
    expect(projected).toContain("请帮我重构登录模块");
    expect(projected).toContain("<prismux_collaborators>");
    expect(projected).toContain("- dsh|DeepSeek Harness|deepseek-reasoner|max=2");
  });
});

describe("composerCollaborators.logic — multi-agent, model & count clamping", () => {
  it("supports simultaneous multi-agent selection, model switching, and strict 1..6 per-agent / <=8 global clamping", () => {
    let state: ComposerCollaboratorSelection[] = [];
    state = toggleCollaboratorSelection(state, {
      providerInstanceId: dshEntry.instanceId,
      defaultModel: "deepseek-reasoner",
    });
    state = toggleCollaboratorSelection(state, {
      providerInstanceId: codexApiEntry.instanceId,
      defaultModel: "gpt-5.4",
    });
    expect(state).toHaveLength(2);
    expect(getTotalCollaboratorCount(state)).toBe(2);

    // Switch Codex model
    state = setCollaboratorModel(state, codexApiEntry.instanceId, "gpt-5.3-codex");
    expect(state.find((item) => item.providerInstanceId === codexApiEntry.instanceId)?.model).toBe(
      "gpt-5.3-codex",
    );

    // Increment DSH to max 6 (clamped at 6)
    for (let index = 0; index < 10; index += 1) {
      state = stepCollaboratorCount(state, dshEntry.instanceId, 1);
    }
    expect(state.find((item) => item.providerInstanceId === dshEntry.instanceId)?.maxCount).toBe(
      MAX_COLLABORATOR_COUNT_PER_AGENT,
    );

    // Total is 7 (6 + 1), Codex can step to 2 (total 8) but no further
    state = stepCollaboratorCount(state, codexApiEntry.instanceId, 1);
    state = stepCollaboratorCount(state, codexApiEntry.instanceId, 1);
    expect(
      state.find((item) => item.providerInstanceId === codexApiEntry.instanceId)?.maxCount,
    ).toBe(2);
    expect(getTotalCollaboratorCount(state)).toBe(MAX_TOTAL_COLLABORATOR_COUNT);
    expect(getRemainingCollaboratorCapacity(state)).toBe(0);

    // Cannot add a 3rd agent when total capacity is full
    const blockedAdd = toggleCollaboratorSelection(state, {
      providerInstanceId: ollamaEntry.instanceId,
      defaultModel: "qwen3-coder:32b",
    });
    expect(blockedAdd).toHaveLength(2);

    // Decrement clamps at 1
    state = stepCollaboratorCount(state, codexApiEntry.instanceId, -1);
    state = stepCollaboratorCount(state, codexApiEntry.instanceId, -1);
    expect(
      state.find((item) => item.providerInstanceId === codexApiEntry.instanceId)?.maxCount,
    ).toBe(1);

    // Remove cleanly
    state = removeCollaboratorSelection(state, dshEntry.instanceId);
    expect(state).toHaveLength(1);
    expect(state[0]?.providerInstanceId).toBe(codexApiEntry.instanceId);
  });

  it("normalizes duplicate row ids, invalid counts, and per-agent/global over-budget arrays deterministically", () => {
    const normalized = normalizeCollaboratorSelections([
      { providerInstanceId: dshEntry.instanceId, model: " deepseek-reasoner ", maxCount: 99 },
      { providerInstanceId: dshEntry.instanceId, model: "over-agent-cap", maxCount: 3 },
      { providerInstanceId: codexApiEntry.instanceId, model: "gpt-5.4", maxCount: 5 },
      { providerInstanceId: ollamaEntry.instanceId, model: "qwen3-coder:32b", maxCount: 2 },
    ]);
    expect(normalized).toEqual([
      {
        id: "dsh#1",
        providerInstanceId: dshEntry.instanceId,
        model: "deepseek-reasoner",
        maxCount: 6,
      },
      {
        id: "codex#1",
        providerInstanceId: codexApiEntry.instanceId,
        model: "gpt-5.4",
        maxCount: 2,
      },
    ]);
    expect(getTotalCollaboratorCount(normalized)).toBe(8);

    // Deduplicates duplicate explicit row ids while preserving distinct rows under the same provider
    const multiRow = normalizeCollaboratorSelections([
      {
        id: "row-a",
        providerInstanceId: dshEntry.instanceId,
        model: "deepseek-reasoner",
        maxCount: 2,
      },
      {
        id: "row-a",
        providerInstanceId: dshEntry.instanceId,
        model: "ignored-duplicate-id",
        maxCount: 2,
      },
      {
        id: "row-b",
        providerInstanceId: dshEntry.instanceId,
        model: "deepseek-chat",
        maxCount: 5,
      },
    ]);
    expect(multiRow).toEqual([
      {
        id: "row-a",
        providerInstanceId: dshEntry.instanceId,
        model: "deepseek-reasoner",
        maxCount: 2,
      },
      {
        id: "row-b",
        providerInstanceId: dshEntry.instanceId,
        model: "deepseek-chat",
        maxCount: 4,
      },
    ]);
    expect(getProviderCollaboratorCount(multiRow, dshEntry.instanceId)).toBe(
      MAX_COLLABORATOR_COUNT_PER_AGENT,
    );
  });

  it("supports multiple model rows under the same provider, inherits previous model, enforces caps, and aggregates identical models on send", () => {
    let state: ComposerCollaboratorSelection[] = [];
    state = toggleCollaboratorSelection(state, {
      providerInstanceId: dshEntry.instanceId,
      defaultModel: "deepseek-reasoner",
    });
    expect(state).toHaveLength(1);
    const firstRowId = state[0]!.id!;

    // Switch first row to deepseek-chat, then add a 2nd model row -> inherits deepseek-chat with maxCount 1
    state = setCollaboratorModel(state, firstRowId, "deepseek-chat");
    state = addCollaboratorModelRow(state, {
      providerInstanceId: dshEntry.instanceId,
      fallbackModel: "deepseek-reasoner",
    });
    expect(state).toHaveLength(2);
    const secondRowId = state[1]!.id!;
    expect(secondRowId).not.toBe(firstRowId);
    expect(state[1]).toEqual({
      id: secondRowId,
      providerInstanceId: dshEntry.instanceId,
      model: "deepseek-chat",
      maxCount: 1,
    });

    // While both rows share the same model, UI keeps 2 rows while outgoing directive aggregates counts
    state = stepCollaboratorCount(state, secondRowId, 1);
    expect(state[0]?.maxCount).toBe(1);
    expect(state[1]?.maxCount).toBe(2);
    expect(resolveCollaboratorDescriptors(state, ALL_ENTRIES)).toEqual([
      {
        providerInstanceId: dshEntry.instanceId,
        displayName: "DeepSeek Harness",
        model: "deepseek-chat",
        maxCount: 3,
      },
    ]);
    const sameModelDirective = formatCollaboratorsDirective(state, ALL_ENTRIES);
    expect(sameModelDirective).toContain("- dsh|DeepSeek Harness|deepseek-chat|max=3");
    expect(sameModelDirective.match(/- dsh\|/g)).toHaveLength(1);

    // Changing second row to a different model emits two distinct lines in outgoing directive & payload
    state = setCollaboratorModel(state, secondRowId, "deepseek-reasoner");
    expect(state[0]?.model).toBe("deepseek-chat");
    expect(state[1]?.model).toBe("deepseek-reasoner");
    const distinctDirective = formatCollaboratorsDirective(state, ALL_ENTRIES);
    expect(distinctDirective).toContain("- dsh|DeepSeek Harness|deepseek-chat|max=1");
    expect(distinctDirective).toContain("- dsh|DeepSeek Harness|deepseek-reasoner|max=2");
    const record = buildCollaboratorsContextRecord(state, ALL_ENTRIES);
    expect(record).not.toBeNull();
    expect(
      (record!.payload as { collaborators: ReadonlyArray<{ model: string; maxCount: number }> })
        .collaborators,
    ).toEqual([
      {
        providerInstanceId: dshEntry.instanceId,
        displayName: "DeepSeek Harness",
        model: "deepseek-chat",
        maxCount: 1,
      },
      {
        providerInstanceId: dshEntry.instanceId,
        displayName: "DeepSeek Harness",
        model: "deepseek-reasoner",
        maxCount: 2,
      },
    ]);

    // Stepping row 2 cannot push combined provider total past MAX_COLLABORATOR_COUNT_PER_AGENT (6)
    for (let index = 0; index < 8; index += 1) {
      state = stepCollaboratorCount(state, secondRowId, 1);
    }
    expect(state[0]?.maxCount).toBe(1);
    expect(state[1]?.maxCount).toBe(5);
    expect(getProviderCollaboratorCount(state, dshEntry.instanceId)).toBe(6);
    expect(getRemainingProviderCollaboratorCapacity(state, dshEntry.instanceId)).toBe(0);

    // Adding a 3rd row when provider is at 6 is a safe no-op
    const blockedPerAgent = addCollaboratorModelRow(state, {
      providerInstanceId: dshEntry.instanceId,
      fallbackModel: "deepseek-reasoner",
    });
    expect(blockedPerAgent).toHaveLength(2);

    // Fill remaining global slots with Codex (2), then adding a row on Codex is blocked by global cap (8)
    state = toggleCollaboratorSelection(state, {
      providerInstanceId: codexApiEntry.instanceId,
      defaultModel: "gpt-5.4",
    });
    state = addCollaboratorModelRow(state, {
      providerInstanceId: codexApiEntry.instanceId,
      fallbackModel: "gpt-5.4",
    });
    expect(getTotalCollaboratorCount(state)).toBe(MAX_TOTAL_COLLABORATOR_COUNT);
    const blockedGlobal = addCollaboratorModelRow(state, {
      providerInstanceId: codexApiEntry.instanceId,
      fallbackModel: "gpt-5.4",
    });
    expect(blockedGlobal).toHaveLength(4);

    // Removing a single row removes only that row; removing the provider removes all rows of that provider
    state = removeCollaboratorSelection(state, firstRowId);
    expect(state.filter((item) => item.providerInstanceId === dshEntry.instanceId)).toEqual([
      {
        id: secondRowId,
        providerInstanceId: dshEntry.instanceId,
        model: "deepseek-reasoner",
        maxCount: 5,
      },
    ]);
    state = removeCollaboratorProvider(state, codexApiEntry.instanceId);
    expect(state.filter((item) => item.providerInstanceId === codexApiEntry.instanceId)).toEqual(
      [],
    );
    expect(state).toHaveLength(1);
  });
});

describe("composerCollaborators.logic — unified waiver & subscription risk governance", () => {
  it("allows api_or_custom and local directly without signing waiver", () => {
    const dshGov = evaluateCollaboratorGovernance({
      entry: dshEntry,
      probes: DEFAULT_PROBES,
      waiver: LOCKED_WAIVER,
    });
    const ollamaGov = evaluateCollaboratorGovernance({
      entry: ollamaEntry,
      probes: DEFAULT_PROBES,
      waiver: LOCKED_WAIVER,
    });

    expect(dshGov.locked).toBe(false);
    expect(dshGov.authBadgeLabel).toBe("API / 本地");
    expect(ollamaGov.locked).toBe(false);
    expect(ollamaGov.authBadgeLabel).toBe("API / 本地");
  });

  it("locks personal AGY unless waiver is signed AND allowAntigravityAsControlledAgent is true", () => {
    const locked = evaluateCollaboratorGovernance({
      entry: agyEntry,
      probes: DEFAULT_PROBES,
      waiver: LOCKED_WAIVER,
    });
    expect(locked.locked).toBe(true);
    expect(locked.authBadgeLabel).toBe("个人 AGY");
    expect(locked.lockReason).toBe("agy_waiver_required");
    expect(locked.waiverRoute).toBe(COLLABORATOR_WAIVER_ROUTE);

    const signedWithoutToggle = evaluateCollaboratorGovernance({
      entry: agyEntry,
      probes: DEFAULT_PROBES,
      waiver: SIGNED_BOTH_OFF_WAIVER,
    });
    expect(signedWithoutToggle.locked).toBe(true);

    const unlocked = evaluateCollaboratorGovernance({
      entry: agyEntry,
      probes: DEFAULT_PROBES,
      waiver: SIGNED_FULL_WAIVER,
    });
    expect(unlocked.locked).toBe(false);
    expect(unlocked.lockReason).toBeNull();
  });

  it("locks external subscription_oauth unless waiver is signed AND external swarm is allowed", () => {
    const locked = evaluateCollaboratorGovernance({
      entry: claudeOAuthEntry,
      probes: DEFAULT_PROBES,
      waiver: LOCKED_WAIVER,
    });
    expect(locked.locked).toBe(true);
    expect(locked.authBadgeLabel).toBe("订阅 OAuth");
    expect(locked.lockReason).toBe("external_subscription_waiver_required");
    expect(locked.waiverRoute).toBe(COLLABORATOR_WAIVER_ROUTE);

    const signedWithoutExternal = evaluateCollaboratorGovernance({
      entry: claudeOAuthEntry,
      probes: DEFAULT_PROBES,
      waiver: SIGNED_BOTH_OFF_WAIVER,
    });
    expect(signedWithoutExternal.locked).toBe(true);

    const unlocked = evaluateCollaboratorGovernance({
      entry: claudeOAuthEntry,
      probes: DEFAULT_PROBES,
      waiver: SIGNED_FULL_WAIVER,
    });
    expect(unlocked.locked).toBe(false);
  });

  it("fail-closes locked collaborators on send when waiver is revoked", () => {
    const selections: ComposerCollaboratorSelection[] = [
      { providerInstanceId: agyEntry.instanceId, model: "gemini-2.5-pro", maxCount: 1 },
      { providerInstanceId: claudeOAuthEntry.instanceId, model: "claude-sonnet-4-6", maxCount: 1 },
      { providerInstanceId: dshEntry.instanceId, model: "deepseek-reasoner", maxCount: 2 },
    ];

    const pruned = pruneLockedCollaborators({
      selections,
      entries: ALL_ENTRIES,
      probes: DEFAULT_PROBES,
      waiver: LOCKED_WAIVER,
    });
    expect(pruned).toEqual([
      {
        id: "dsh#1",
        providerInstanceId: dshEntry.instanceId,
        model: "deepseek-reasoner",
        maxCount: 2,
      },
    ]);

    const agyOnlyContext = attachComposerCollaboratorsToContext({
      context: undefined,
      collaborators: [selections[0]!],
      providerInstanceEntries: ALL_ENTRIES,
      probes: DEFAULT_PROBES,
      waiver: LOCKED_WAIVER,
    });
    expect(agyOnlyContext).toBeUndefined();
  });
});

describe("composerDraftStore — split-pane & per-thread collaborator isolation", () => {
  const envId = EnvironmentId.make("env-local");
  const threadA = scopeThreadRef(envId, ThreadId.make("thread-split-a"));
  const threadB = scopeThreadRef(envId, ThreadId.make("thread-split-b"));
  const draftC = DraftId.make("draft-split-c");

  afterEach(() => {
    const store = useComposerDraftStore.getState();
    store.clearCollaborators(threadA);
    store.clearCollaborators(threadB);
    store.clearCollaborators(draftC);
    store.clearComposerContent(threadA);
    store.clearComposerContent(threadB);
    store.clearComposerContent(draftC);
  });

  it("isolates collaborator selections strictly per thread/draft and survives prompt clears", () => {
    const store = useComposerDraftStore.getState();
    store.setCollaborators(threadA, [
      { providerInstanceId: dshEntry.instanceId, model: "deepseek-reasoner", maxCount: 2 },
      { providerInstanceId: dshEntry.instanceId, model: "deepseek-chat", maxCount: 1 },
    ]);
    store.setCollaborators(threadB, [
      { providerInstanceId: codexApiEntry.instanceId, model: "gpt-5.4", maxCount: 1 },
    ]);

    expect(useComposerDraftStore.getState().getComposerDraft(threadA)?.collaborators).toEqual([
      {
        id: "dsh#1",
        providerInstanceId: dshEntry.instanceId,
        model: "deepseek-reasoner",
        maxCount: 2,
      },
      {
        id: "dsh#2",
        providerInstanceId: dshEntry.instanceId,
        model: "deepseek-chat",
        maxCount: 1,
      },
    ]);
    expect(useComposerDraftStore.getState().getComposerDraft(threadB)?.collaborators).toEqual([
      {
        id: "codex#1",
        providerInstanceId: codexApiEntry.instanceId,
        model: "gpt-5.4",
        maxCount: 1,
      },
    ]);
    expect(useComposerDraftStore.getState().getComposerDraft(draftC)).toBeNull();

    // Clearing prompt text after send keeps threadA collaborators active and never touches threadB
    store.setPrompt(threadA, "run task");
    store.clearComposerContent(threadA);
    expect(useComposerDraftStore.getState().getComposerDraft(threadA)?.prompt).toBe("");
    expect(useComposerDraftStore.getState().getComposerDraft(threadA)?.collaborators).toHaveLength(
      2,
    );

    const persisted = partializeComposerDraftStoreState(useComposerDraftStore.getState());
    expect(Object.keys(persisted.draftsByThreadKey).length).toBeGreaterThanOrEqual(2);

    // Clearing threadA removes only threadA's collaborators
    store.clearCollaborators(threadA);
    expect(useComposerDraftStore.getState().getComposerDraft(threadA)).toBeNull();
    expect(useComposerDraftStore.getState().getComposerDraft(threadB)?.collaborators).toHaveLength(
      1,
    );
  });
});

describe("ComposerSlashCommandChip — inline leading slash-command tokens & chaining", () => {
  it("tokenizes confirmed leading slash commands and chains /goal /swarm without false positives", () => {
    expect(collectLeadingSlashCommandTokens("/goal /swarm refactor auth")).toEqual([
      { type: "slash-command", command: "goal", source: "/goal", start: 0, end: 5 },
      { type: "slash-command", command: "swarm", source: "/swarm", start: 6, end: 12 },
    ]);

    expect(collectLeadingSlashCommandTokens("/sw")).toEqual([]);
    expect(collectLeadingSlashCommandTokens("Please inspect /etc/hosts and /swarm")).toEqual([]);
    expect(collectLeadingSlashCommandTokens("/usr/bin/node index.js")).toEqual([]);
    expect(collectLeadingSlashCommandTokens("/v1.2 release")).toEqual([]);

    expect(isAtLeadingSlashCommandPosition("/goal /sw", 6)).toBe(true);
    expect(isAtLeadingSlashCommandPosition("/goal /swarm /p", 13)).toBe(true);
    expect(isAtLeadingSlashCommandPosition("hello /sw", 6)).toBe(false);
    expect(isAtLeadingSlashCommandPosition("/goal\n/sw", 6)).toBe(false);
  });

  it("round-trips inline slash command segments and cursor mapping cleanly", () => {
    const prompt = "/goal /swarm build feature";
    const segments = splitPromptIntoComposerSegments(prompt);
    expect(segments).toEqual([
      { type: "slash-command", command: "goal", source: "/goal" },
      { type: "text", text: " " },
      { type: "slash-command", command: "swarm", source: "/swarm" },
      { type: "text", text: " build feature" },
    ]);

    // Collapsed cursor counts each chip as 1 unit while expanding back to exact canonical offsets
    expect(collapseExpandedComposerCursor(prompt, 5)).toBe(1);
    expect(collapseExpandedComposerCursor(prompt, 6)).toBe(2);
    expect(collapseExpandedComposerCursor(prompt, 12)).toBe(3);
    expect(expandCollapsedComposerCursor(prompt, 1)).toBe(5);
    expect(expandCollapsedComposerCursor(prompt, 2)).toBe(6);
    expect(expandCollapsedComposerCursor(prompt, 3)).toBe(12);

    // Presentation keeps swarm queen-bee icon and stopwatch icon for goal
    expect(resolveSlashCommandPresentation("swarm").icon).toEqual({ kind: "swarm-bee" });
    expect(resolveSlashCommandPresentation("goal").icon.kind).toBe("lucide");
  });

  it("keeps slash menu items available when chaining a second leading slash command", () => {
    const items = buildComposerSlashTriggerItems({
      query: "sw",
      isAtPromptStart: isAtLeadingSlashCommandPosition("/goal /sw", 6),
      sideChatAvailable: true,
      sideChatOffered: true,
      sideChatDisabledReason: null,
      freshSessionAvailable: true,
      compactSlashCommandAvailable: true,
      selectedProvider: ProviderDriverKind.make("antigravity"),
      selectedProviderSkills: [],
      selectedProviderSlashCommands: [
        { name: "swarm", description: "Start multi-agent swarm" },
        { name: "goal", description: "Run until goal is achieved" },
      ],
      showSkillsInSlashMenu: false,
      slashSkillsExpanded: false,
      instanceEntries: [agyEntry],
      labels: {
        switchModel: "Switch model",
        askSideQuestion: "Ask side question",
        compactConversation: "Compact",
        invokeBrowser: "Browser",
        freshSession: "Fresh session",
        runProviderCommand: "Run command",
        formatScopedSkill: (scope) => `${scope} skill`,
      },
    });

    expect(
      items.some((item) => item.type === "provider-slash-command" && item.command.name === "swarm"),
    ).toBe(true);
  });
});
