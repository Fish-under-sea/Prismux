import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import {
  BRAND,
  CANONICAL_PROVIDER_DISPLAY_NAMES,
  CHIEF_AGENTS_MD_DIR,
  CHIEF_AGENTS_MD_FILENAME,
  CHIEF_PROVIDER_KINDS,
  DEFAULT_CHIEF_SECRETARY_NAME,
  DIAL_MODES,
  isRetiredChiefProviderKind,
  normalizeChiefProviderKind,
  normalizeChiefReasoningEffort,
  normalizeChiefSecretaryName,
  type ChiefAgentsMdResponse,
  type ChiefProviderKind,
  type ChiefSwitchRecord,
  type ChiefSystemContext,
  type ChiefThreadSlotState,
  type DialMode,
} from "@prismux/protocol";
import { isCoreRpcUnsupportedProtocolError, type CoreRpcClient } from "../core/CoreRpcClient.js";

export const DEFAULT_CHIEF_MCP_SERVERS = [
  `${BRAND.appSlug}-memory`,
  `${BRAND.appSlug}-orchestrator`,
] as const;

export const CHIEF_MARKER_FILENAME = `.${BRAND.appSlug}-chief.json`;
export const CHIEF_README_FILENAME = "README.md";
export const CHIEF_SLOT_FILENAME = "chief-slot.json";
export const DEFAULT_CHIEF_REASONING_EFFORT = "high" as const;
export const DEFAULT_CHIEF_DIAL_MODE: DialMode = "agent";
export const DEFAULT_CHIEF_RPC_SYNC_TIMEOUT_MS = 300;
export const CHIEF_IDENTITY_HEADER_BEGIN = "<!-- prismux:chief-identity:begin -->";
export const CHIEF_IDENTITY_HEADER_END = "<!-- prismux:chief-identity:end -->";

export interface ChiefThreadManagerOptions {
  dataDir: string;
  defaultProvider?: ChiefProviderKind;
  defaultModel?: string;
  defaultReasoningEffort?: string;
  defaultSecretaryName?: string;
  defaultDialMode?: DialMode;
  rpcClient?: CoreRpcClient;
  rpcSyncTimeoutMs?: number;
}

export interface ChiefSwitchOptions {
  secretaryName?: string;
  dialMode?: DialMode;
}

interface ChiefWorkspaceMarker {
  protected: true;
  role: "chief-supervisor-workspace";
  appName: string;
  appSlug: string;
  injectedMcpServers: string[];
  createdAt: number;
  note: string;
}

function assertValidProvider(provider: unknown): ChiefProviderKind {
  if (isRetiredChiefProviderKind(provider)) {
    throw new Error(
      `Invalid Chief provider "${String(provider)}": retired provider is no longer supported. Expected a valid non-retired provider ID (builtin: ${CHIEF_PROVIDER_KINDS.join(", ")}, or a configured ACP/custom provider ID).`,
    );
  }
  const normalized = normalizeChiefProviderKind(provider);
  if (normalized === null) {
    throw new Error(
      `Invalid Chief provider "${String(provider)}". Expected a valid non-retired provider ID (builtin: ${CHIEF_PROVIDER_KINDS.join(", ")}, or a configured ACP/custom provider ID).`,
    );
  }
  return normalized;
}

function assertValidReasoningEffort(effort: unknown): string | undefined {
  const normalized = normalizeChiefReasoningEffort(effort);
  if (normalized === null) {
    throw new Error(
      `Invalid Chief reasoningEffort "${String(effort)}". Expected an alphanumeric effort token or empty.`,
    );
  }
  return normalized;
}

function assertValidSecretaryName(name: unknown): string | undefined {
  const normalized = normalizeChiefSecretaryName(name);
  if (normalized === null) {
    throw new Error(
      `Invalid Chief secretaryName "${String(name)}". Expected a non-control string up to 32 characters.`,
    );
  }
  return normalized;
}

function parseDialModeOptional(value: unknown): DialMode | undefined {
  if (typeof value === "string" && (DIAL_MODES as readonly string[]).includes(value)) {
    return value as DialMode;
  }
  return undefined;
}

function assertValidDialMode(mode: unknown): DialMode {
  const parsed = parseDialModeOptional(mode);
  if (parsed === undefined) {
    throw new Error(
      `Invalid Chief dialMode "${String(mode)}". Expected one of: ${DIAL_MODES.join(", ")}.`,
    );
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildChiefIdentityHeader(secretaryName: string, agentsMdPath: string): string {
  const resolvedName = secretaryName.trim() || DEFAULT_CHIEF_SECRETARY_NAME;
  return [
    CHIEF_IDENTITY_HEADER_BEGIN,
    `# ${BRAND.appName} 主秘书身份契约 · ${resolvedName}`,
    "",
    `- **当前主秘书称呼**：\`${resolvedName}\`（用户称呼「${resolvedName}」或 \`@${resolvedName}\` 时立即识别为在呼叫自己）`,
    `- **跨引擎身份连续性**：无论底层模型或引擎在 ${CANONICAL_PROVIDER_DISPLAY_NAMES.codex} / ${CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent} / ${CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity} / Gemini 等之间如何热切换，你始终保持同一位主秘书「${resolvedName}」的身份、长期记忆与本 \`AGENTS.md\` 约定。`,
    `- **唤起与响应规则**：当用户在对话、私聊或快捷指令中称呼「${resolvedName}」或 \`@${resolvedName}\` 时，直接以「${resolvedName}」身份自然响应并推进闭环。`,
    `- **独立指令路径**：\`${agentsMdPath}\`（独立于具体项目与 Provider，切换底层引擎绝不重置）`,
    CHIEF_IDENTITY_HEADER_END,
  ].join("\n");
}

export function buildDefaultChiefAgentsMd(secretaryName: string, agentsMdPath: string): string {
  return [
    buildChiefIdentityHeader(secretaryName, agentsMdPath),
    "",
    "## 主秘书协作准则（以下正文可自由定制，修改称呼或切换底层引擎均会完整保留）",
    "",
    "- 始终遵循主人的长期偏好、跨项目决策与单文件 SQLite 混合记忆上下文。",
    "- 复杂跨工作区任务先给出清晰结论与边界拆解，再高效推进落地与验证。",
    "- 执行高风险命令、修改外部环境或对外发送消息前，严格遵守 Prismux 权限与审批门禁。",
    "",
  ].join("\n");
}

/**
 * Updates only the controlled identity header block in `~/.prismux/chief/AGENTS.md`
 * so renaming the Chief Secretary never overwrites user-authored prose below it.
 */
export function syncChiefIdentityHeader(
  existingContent: string,
  secretaryName: string,
  agentsMdPath: string,
): string {
  const nextHeader = buildChiefIdentityHeader(secretaryName, agentsMdPath);
  const normalized = existingContent.replace(/\r\n?/g, "\n");
  const beginIdx = normalized.indexOf(CHIEF_IDENTITY_HEADER_BEGIN);
  const endIdx = normalized.indexOf(CHIEF_IDENTITY_HEADER_END);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const before = normalized.slice(0, beginIdx);
    const after = normalized.slice(endIdx + CHIEF_IDENTITY_HEADER_END.length);
    return `${before}${nextHeader}${after}`;
  }
  const trimmed = normalized.trimStart();
  return trimmed.length > 0 ? `${nextHeader}\n\n${trimmed}` : `${nextHeader}\n`;
}

function writeTextAtomic(filePath: string, content: string): void {
  const parentDir = dirname(filePath);
  mkdirSync(parentDir, { recursive: true });
  const tempPath = join(parentDir, `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, content, "utf8");
    renameSync(tempPath, filePath);
  } catch (error: unknown) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failure for temp file.
    }
    throw error;
  }
}

function normalizeMcpServers(existing?: unknown): string[] {
  const result: string[] = [...DEFAULT_CHIEF_MCP_SERVERS];
  if (Array.isArray(existing)) {
    for (const item of existing) {
      if (typeof item === "string" && item.length > 0 && !result.includes(item)) {
        result.push(item);
      }
    }
  }
  return result;
}

function cloneSlotState(state: ChiefThreadSlotState): ChiefThreadSlotState {
  return {
    threadId: state.threadId,
    workspacePath: state.workspacePath,
    activeProvider: state.activeProvider,
    secretaryName: state.secretaryName ?? DEFAULT_CHIEF_SECRETARY_NAME,
    agentsMdPath: state.agentsMdPath,
    ...(state.model !== undefined ? { model: state.model } : {}),
    ...(state.reasoningEffort !== undefined ? { reasoningEffort: state.reasoningEffort } : {}),
    injectedMcpServers: [...state.injectedMcpServers],
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    switchHistory: state.switchHistory.map((record) => ({
      ...(record.fromProvider !== undefined ? { fromProvider: record.fromProvider } : {}),
      toProvider: record.toProvider,
      ...(record.model !== undefined ? { model: record.model } : {}),
      ...(record.reasoningEffort !== undefined ? { reasoningEffort: record.reasoningEffort } : {}),
      switchedAt: record.switchedAt,
    })),
  };
}

function writeFileIfAbsent(filePath: string, content: string): void {
  if (existsSync(filePath)) {
    return;
  }
  try {
    writeFileSync(filePath, content, { encoding: "utf8", flag: "wx" });
  } catch (error: unknown) {
    if (isRecord(error) && typeof error.code === "string" && error.code === "EEXIST") {
      return;
    }
    throw error;
  }
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
  const parentDir = dirname(filePath);
  mkdirSync(parentDir, { recursive: true });
  const tempPath = join(parentDir, `.${CHIEF_SLOT_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;

  try {
    writeFileSync(tempPath, serialized, "utf8");
    renameSync(tempPath, filePath);
  } catch (error: unknown) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failure for temp file.
    }
    throw error;
  }
}

function parseSwitchHistory(rawHistory: unknown): ChiefSwitchRecord[] {
  if (!Array.isArray(rawHistory)) {
    return [];
  }
  const records: ChiefSwitchRecord[] = [];
  for (const item of rawHistory) {
    if (!isRecord(item)) {
      continue;
    }
    const toProvider = normalizeChiefProviderKind(item.toProvider);
    if (toProvider === null) {
      continue;
    }
    const fromProvider = normalizeChiefProviderKind(item.fromProvider);
    const effortRaw =
      item.reasoningEffort !== undefined ? item.reasoningEffort : item.defaultEffort;
    const normalizedEffort = normalizeChiefReasoningEffort(effortRaw);
    const switchedAt =
      typeof item.switchedAt === "number" && Number.isFinite(item.switchedAt)
        ? item.switchedAt
        : Date.now();
    records.push({
      ...(fromProvider !== null ? { fromProvider } : {}),
      toProvider,
      ...(typeof item.model === "string" && item.model.length > 0 ? { model: item.model } : {}),
      ...(typeof normalizedEffort === "string" ? { reasoningEffort: normalizedEffort } : {}),
      switchedAt,
    });
  }
  return records;
}

export class ChiefThreadManager {
  readonly dataDir: string;
  readonly workspacePath: string;
  readonly chiefDirPath: string;
  readonly agentsMdPath: string;
  readonly slotFilePath: string;
  private readonly defaultProvider: ChiefProviderKind;
  private readonly defaultModel: string | undefined;
  private readonly defaultReasoningEffort: string | undefined;
  private readonly defaultSecretaryName: string;
  private readonly defaultDialMode: DialMode;
  private readonly rpcClient: CoreRpcClient | undefined;
  private readonly rpcSyncTimeoutMs: number;
  private lastSyncWarningKey: string | undefined;
  private dialMode: DialMode;
  private slot: ChiefThreadSlotState | undefined;

  constructor(options: ChiefThreadManagerOptions) {
    this.dataDir = resolve(options.dataDir);
    this.workspacePath = join(this.dataDir, BRAND.chiefWorkspaceDir);
    this.chiefDirPath = join(this.dataDir, CHIEF_AGENTS_MD_DIR);
    this.agentsMdPath = join(this.chiefDirPath, CHIEF_AGENTS_MD_FILENAME);
    this.slotFilePath = join(this.dataDir, CHIEF_SLOT_FILENAME);
    this.defaultProvider = assertValidProvider(options.defaultProvider ?? "claude-code");
    this.defaultModel = options.defaultModel;
    this.defaultReasoningEffort =
      options.defaultReasoningEffort === undefined
        ? DEFAULT_CHIEF_REASONING_EFFORT
        : assertValidReasoningEffort(options.defaultReasoningEffort);
    this.defaultSecretaryName =
      assertValidSecretaryName(options.defaultSecretaryName) ?? DEFAULT_CHIEF_SECRETARY_NAME;
    this.defaultDialMode =
      options.defaultDialMode !== undefined
        ? assertValidDialMode(options.defaultDialMode)
        : DEFAULT_CHIEF_DIAL_MODE;
    this.dialMode = this.defaultDialMode;
    this.rpcClient = options.rpcClient;
    this.rpcSyncTimeoutMs = Math.max(
      25,
      options.rpcSyncTimeoutMs ?? DEFAULT_CHIEF_RPC_SYNC_TIMEOUT_MS,
    );
  }

  /**
   * Initializes `<dataDir>/chief/AGENTS.md` with a structured identity template
   * if absent, without overwriting existing user customizations.
   */
  ensureChiefAgentsMd(secretaryName?: string): string {
    mkdirSync(this.chiefDirPath, { recursive: true });
    const resolvedName =
      secretaryName?.trim() || this.slot?.secretaryName || this.defaultSecretaryName;
    writeFileIfAbsent(
      this.agentsMdPath,
      buildDefaultChiefAgentsMd(resolvedName, this.agentsMdPath),
    );
    return this.agentsMdPath;
  }

  /**
   * Initializes and protects `<dataDir>/chief-workspace` without overwriting
   * existing user-authored files.
   */
  ensureWorkspace(): string {
    mkdirSync(this.workspacePath, { recursive: true });

    const markerPath = join(this.workspacePath, CHIEF_MARKER_FILENAME);
    const marker: ChiefWorkspaceMarker = {
      protected: true,
      role: "chief-supervisor-workspace",
      appName: BRAND.appName,
      appSlug: BRAND.appSlug,
      injectedMcpServers: [...DEFAULT_CHIEF_MCP_SERVERS],
      createdAt: Date.now(),
      note: "Protected Chief Supervisor coordination workspace. Do not delete or purge.",
    };
    writeFileIfAbsent(markerPath, `${JSON.stringify(marker, null, 2)}\n`);

    const readmePath = join(this.workspacePath, CHIEF_README_FILENAME);
    const readmeContent = [
      `# ${BRAND.appName} Chief Supervisor Workspace`,
      "",
      "This directory is the protected coordination workspace for the privileged Chief Thread Slot.",
      `Default injected loopback MCP servers: ${DEFAULT_CHIEF_MCP_SERVERS.map((s) => `\`${s}\``).join(", ")}.`,
      "Existing files in this directory are preserved across daemon restarts and provider hot-switches.",
      "",
    ].join("\n");
    writeFileIfAbsent(readmePath, readmeContent);

    return this.workspacePath;
  }

  async init(): Promise<ChiefThreadSlotState> {
    this.ensureWorkspace();

    if (existsSync(this.slotFilePath)) {
      const { slot: loaded, dialMode } = this.readSlotFromDisk();
      this.slot = loaded;
      this.dialMode = dialMode;
      this.ensureChiefAgentsMd(loaded.secretaryName);
      return cloneSlotState(loaded);
    }

    const now = Date.now();
    this.ensureChiefAgentsMd(this.defaultSecretaryName);
    const initialSlot: ChiefThreadSlotState = {
      threadId: `chief-${randomUUID()}`,
      workspacePath: this.workspacePath,
      activeProvider: this.defaultProvider,
      secretaryName: this.defaultSecretaryName,
      agentsMdPath: this.agentsMdPath,
      ...(this.defaultModel !== undefined ? { model: this.defaultModel } : {}),
      ...(this.defaultReasoningEffort !== undefined
        ? { reasoningEffort: this.defaultReasoningEffort }
        : {}),
      injectedMcpServers: [...DEFAULT_CHIEF_MCP_SERVERS],
      createdAt: now,
      updatedAt: now,
      switchHistory: [],
    };

    this.dialMode = this.defaultDialMode;
    this.persistSlotToDisk(initialSlot, this.dialMode);
    this.slot = initialSlot;
    return cloneSlotState(initialSlot);
  }

  getSlot(): ChiefThreadSlotState {
    if (this.slot === undefined) {
      throw new Error(
        "ChiefThreadManager is not initialized. Call init() before accessing the slot.",
      );
    }
    return cloneSlotState(this.slot);
  }

  getDialMode(): DialMode {
    return this.dialMode;
  }

  setDialMode(mode: DialMode): DialMode {
    const validated = assertValidDialMode(mode);
    this.dialMode = validated;
    if (this.slot !== undefined) {
      const nextSlot: ChiefThreadSlotState = {
        ...this.slot,
        updatedAt: Date.now(),
      };
      this.persistSlotToDisk(nextSlot, validated);
      this.slot = nextSlot;
    }
    return validated;
  }

  /**
   * Updates Chief Secretary profile metadata (such as custom `secretaryName`) without
   * forcing a provider switch, and synchronizes the controlled identity header in `AGENTS.md`
   * while preserving user-authored body content intact.
   */
  updateProfile(input: { secretaryName?: string }): ChiefThreadSlotState {
    if (this.slot === undefined) {
      throw new Error(
        "ChiefThreadManager is not initialized. Call init() before updating profile.",
      );
    }
    const nextName =
      assertValidSecretaryName(input.secretaryName) ??
      this.slot.secretaryName ??
      DEFAULT_CHIEF_SECRETARY_NAME;
    const now = Date.now();
    const nextSlot: ChiefThreadSlotState = {
      ...this.slot,
      secretaryName: nextName,
      agentsMdPath: this.agentsMdPath,
      updatedAt: now,
    };
    this.persistSlotToDisk(nextSlot, this.dialMode);
    this.slot = nextSlot;

    this.ensureChiefAgentsMd(nextName);
    const currentAgentsMd = readFileSync(this.agentsMdPath, "utf8");
    const synced = syncChiefIdentityHeader(currentAgentsMd, nextName, this.agentsMdPath);
    if (synced !== currentAgentsMd) {
      writeTextAtomic(this.agentsMdPath, synced);
    }

    return cloneSlotState(nextSlot);
  }

  getAgentsMd(): ChiefAgentsMdResponse {
    const secretaryName = this.slot?.secretaryName ?? this.defaultSecretaryName;
    this.ensureChiefAgentsMd(secretaryName);
    const content = readFileSync(this.agentsMdPath, "utf8");
    const stats = statSync(this.agentsMdPath);
    return {
      ok: true,
      path: this.agentsMdPath,
      content,
      updatedAt: Math.round(stats.mtimeMs),
      secretaryName,
    };
  }

  saveAgentsMd(input: { content?: string; reset?: boolean }): ChiefAgentsMdResponse {
    const secretaryName = this.slot?.secretaryName ?? this.defaultSecretaryName;
    mkdirSync(this.chiefDirPath, { recursive: true });
    let nextContent: string;
    if (input.reset === true) {
      nextContent = buildDefaultChiefAgentsMd(secretaryName, this.agentsMdPath);
    } else if (typeof input.content === "string") {
      nextContent = input.content;
    } else {
      throw new Error("Either content (string) or reset=true must be provided.");
    }
    writeTextAtomic(this.agentsMdPath, nextContent);
    const stats = statSync(this.agentsMdPath);
    return {
      ok: true,
      path: this.agentsMdPath,
      content: nextContent,
      updatedAt: Math.round(stats.mtimeMs),
      secretaryName,
    };
  }

  /**
   * Builds the engine-agnostic Chief runtime system context combining the active custom
   * calling-name recognition contract with the live independent `~/.prismux/chief/AGENTS.md`.
   */
  buildChiefSystemContext(): ChiefSystemContext {
    const slot = this.getSlot();
    const secretaryName = slot.secretaryName ?? DEFAULT_CHIEF_SECRETARY_NAME;
    const agentsMd = this.getAgentsMd();
    const systemPrompt = [
      `[Prismux Chief Identity] 你当前担任 ${BRAND.appName} 24h 主秘书，你的称呼是「${secretaryName}」。`,
      `当用户称呼「${secretaryName}」或「@${secretaryName}」时，立即识别为在呼叫你本人；无论底层引擎如何切换（当前引擎：${slot.activeProvider}${slot.model ? ` / ${slot.model}` : ""}），你始终继承同一份独立指令与长期记忆。`,
      `[Independent Chief AGENTS.md: ${agentsMd.path}]`,
      agentsMd.content.trim(),
    ].join("\n\n");

    return {
      secretaryName,
      agentsMdPath: agentsMd.path,
      agentsMdContent: agentsMd.content,
      activeProvider: slot.activeProvider,
      ...(slot.model !== undefined ? { model: slot.model } : {}),
      systemPrompt,
    };
  }

  async switchProvider(
    provider: ChiefProviderKind,
    model?: string,
    reasoningEffort?: string | null,
    options?: ChiefSwitchOptions,
  ): Promise<ChiefThreadSlotState> {
    if (this.slot === undefined) {
      throw new Error(
        "ChiefThreadManager is not initialized. Call init() before switching providers.",
      );
    }

    const nextProvider = assertValidProvider(provider);
    const normalizedModel = model !== undefined && model.length > 0 ? model : undefined;
    const normalizedEffort = assertValidReasoningEffort(reasoningEffort);
    const requestedSecretaryName = assertValidSecretaryName(options?.secretaryName);
    const nextDialMode =
      options?.dialMode !== undefined ? assertValidDialMode(options.dialMode) : this.dialMode;
    const nextSecretaryName =
      requestedSecretaryName ?? this.slot.secretaryName ?? DEFAULT_CHIEF_SECRETARY_NAME;
    const now = Date.now();

    const switchRecord: ChiefSwitchRecord = {
      fromProvider: this.slot.activeProvider,
      toProvider: nextProvider,
      ...(normalizedModel !== undefined ? { model: normalizedModel } : {}),
      ...(normalizedEffort !== undefined ? { reasoningEffort: normalizedEffort } : {}),
      switchedAt: now,
    };

    const nextSlot: ChiefThreadSlotState = {
      threadId: this.slot.threadId,
      workspacePath: this.slot.workspacePath,
      activeProvider: nextProvider,
      secretaryName: nextSecretaryName,
      agentsMdPath: this.agentsMdPath,
      ...(normalizedModel !== undefined ? { model: normalizedModel } : {}),
      ...(normalizedEffort !== undefined ? { reasoningEffort: normalizedEffort } : {}),
      injectedMcpServers: normalizeMcpServers(this.slot.injectedMcpServers),
      createdAt: this.slot.createdAt,
      updatedAt: now,
      switchHistory: [...this.slot.switchHistory, switchRecord],
    };

    this.dialMode = nextDialMode;
    this.persistSlotToDisk(nextSlot, nextDialMode);
    this.slot = nextSlot;

    // Ensure independent AGENTS.md exists and never resets on provider switch;
    // only update the controlled identity header when secretaryName explicitly changed.
    this.ensureChiefAgentsMd(nextSecretaryName);
    if (requestedSecretaryName !== undefined) {
      const currentAgentsMd = readFileSync(this.agentsMdPath, "utf8");
      const synced = syncChiefIdentityHeader(currentAgentsMd, nextSecretaryName, this.agentsMdPath);
      if (synced !== currentAgentsMd) {
        writeTextAtomic(this.agentsMdPath, synced);
      }
    }

    await this.syncChiefThreadBestEffort(nextSlot);

    return cloneSlotState(nextSlot);
  }

  private async syncChiefThreadBestEffort(slot: ChiefThreadSlotState): Promise<void> {
    const rpcClient = this.rpcClient;
    if (rpcClient?.isConnected() !== true) {
      return;
    }
    if (
      typeof rpcClient.isLegacyMethodAvailable === "function" &&
      !rpcClient.isLegacyMethodAvailable("chief.ensureThread")
    ) {
      return;
    }

    let timeoutTimer: NodeJS.Timeout | undefined;
    try {
      const syncPromise = rpcClient.ensureChiefThread(
        slot.workspacePath,
        slot.activeProvider,
        slot.model,
        this.rpcSyncTimeoutMs,
      );
      // Guard against late rejections if a custom mock client ignores timeoutMs.
      syncPromise.catch(() => undefined);

      const outcome = await Promise.race<"ok" | "timeout">([
        syncPromise.then(() => "ok" as const),
        new Promise<"timeout">((resolveTimeout) => {
          timeoutTimer = setTimeout(() => resolveTimeout("timeout"), this.rpcSyncTimeoutMs + 50);
        }),
      ]);
      if (outcome === "timeout") {
        this.logChiefSyncDegraded(
          slot.activeProvider,
          "timeout",
          `Core RPC chief.ensureThread exceeded ${this.rpcSyncTimeoutMs}ms`,
        );
      } else {
        this.lastSyncWarningKey = undefined;
      }
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      const key = isCoreRpcUnsupportedProtocolError(error)
        ? `unsupported:${error.code}`
        : `error:${error instanceof Error ? error.name : "unknown"}`;
      this.logChiefSyncDegraded(slot.activeProvider, key, reason);
    } finally {
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
      }
    }
  }

  private logChiefSyncDegraded(provider: ChiefProviderKind, key: string, reason: string): void {
    if (this.lastSyncWarningKey === key) {
      return;
    }
    this.lastSyncWarningKey = key;
    console.warn(
      `[prismux-daemon] Chief slot persisted locally (provider=${provider}); optional Core RPC chief.ensureThread sync degraded: ${reason}`,
    );
  }

  private persistSlotToDisk(slot: ChiefThreadSlotState, dialMode: DialMode): void {
    writeJsonAtomic(this.slotFilePath, {
      ...slot,
      dialMode,
    });
  }

  private readSlotFromDisk(): { slot: ChiefThreadSlotState; dialMode: DialMode } {
    const rawText = readFileSync(this.slotFilePath, "utf8");
    const parsed: unknown = JSON.parse(rawText);
    if (!isRecord(parsed)) {
      throw new Error(`Corrupted Chief slot state at ${this.slotFilePath}: expected JSON object.`);
    }

    const threadId =
      typeof parsed.threadId === "string" && parsed.threadId.length > 0
        ? parsed.threadId
        : `chief-${randomUUID()}`;
    const workspacePath =
      typeof parsed.workspacePath === "string" && parsed.workspacePath.length > 0
        ? parsed.workspacePath
        : this.workspacePath;
    const activeProvider =
      normalizeChiefProviderKind(parsed.activeProvider) ?? this.defaultProvider;
    const parsedSecretaryName = normalizeChiefSecretaryName(parsed.secretaryName);
    const secretaryName =
      typeof parsedSecretaryName === "string" ? parsedSecretaryName : this.defaultSecretaryName;
    const dialMode = parseDialModeOptional(parsed.dialMode) ?? this.defaultDialMode;
    const model =
      typeof parsed.model === "string" && parsed.model.length > 0 ? parsed.model : undefined;
    const rawEffort =
      parsed.reasoningEffort !== undefined ? parsed.reasoningEffort : parsed.defaultEffort;
    const parsedEffort = normalizeChiefReasoningEffort(rawEffort);
    const reasoningEffort = typeof parsedEffort === "string" ? parsedEffort : undefined;
    const now = Date.now();
    const createdAt =
      typeof parsed.createdAt === "number" && Number.isFinite(parsed.createdAt)
        ? parsed.createdAt
        : now;
    const updatedAt =
      typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
        ? parsed.updatedAt
        : createdAt;

    return {
      slot: {
        threadId,
        workspacePath,
        activeProvider,
        secretaryName,
        agentsMdPath: this.agentsMdPath,
        ...(model !== undefined ? { model } : {}),
        ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
        injectedMcpServers: normalizeMcpServers(parsed.injectedMcpServers),
        createdAt,
        updatedAt,
        switchHistory: parseSwitchHistory(parsed.switchHistory),
      },
      dialMode,
    };
  }
}
