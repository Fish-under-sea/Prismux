import type { ProviderInteractionMode } from "@prismux/core-contracts";

/**
 * Strips leading Prismux inter-thread sender headers such as
 * `[Prismux: the agent in Prismux thread "<id>" sent this message, not the user.]`
 * before running intent detection so boilerplate metadata words ("agent", "thread")
 * never falsely trigger heavy orchestration instructions on delegated children.
 */
export function stripPrismuxSenderPrefix(prompt: string): string {
  return prompt
    .replace(
      /^\s*\[Prismux:[^\]]*sent this message, not the user\.\]\s*/iu,
      "",
    )
    .trim();
}

export interface PrismuxPromptIntentSignals {
  readonly needsDevice: boolean;
  readonly needsBrowser: boolean;
  readonly needsVisuals: boolean;
  readonly needsPullRequestLinking: boolean;
  readonly needsLinkedEnvironments: boolean;
  readonly needsDelegation: boolean;
}

const DEVICE_INTENT_RE =
  /\b(?:ios|android|iphone|ipad|simulator|emulator|simctl|idb|adb|xcodebuild|xcrun|device_list|device_open|device_screenshot|device_close|agent-device|react native|expo|flutter|mobile app|avd|udid|hostId)\b|模拟器|真机|手机端|手机模拟|设备面板|安卓|苹果手机|移动设备/iu;

const BROWSER_INTENT_RE =
  /\b(?:preview_|browser|webpage|web page|web app|localhost|127\.0\.0\.1|https?:\/\/|playwright|puppeteer|selenium|devtools|viewport|screenshot|navigate|website|browser tab|web preview|open page)\b|浏览器|网页|页面预览|预览页面|截图|网站|网址|打开网页|录屏/iu;

const VISUALS_INTENT_RE =
  /\b(?:chart|graph|plot|diagram|visuali[sz]\w*|svg|html_preview|html_render|dashboard|infographic|mermaid|trend chart|comparison chart|render html|poster|slide deck|canvas)\b|图表|可视化|画图|绘制|折线图|柱状图|饼图|流程图|架构图|趋势图|对比图|仪表盘|海报|网页预览/iu;

const PR_LINKING_INTENT_RE =
  /\b(?:pr|prs|pull request|pull_request\w*|merge|branch|git|github|gitlab|bitbucket|forgejo|azure devops|commit|push|rebase|cherry-pick|diff|review|ci|pipeline|checks|issue|issues|linear|jira|link_pull_request|watch_pull_request|link_issue|gh\s|cafe\s|worktree)\b|拉取请求|合并|分支|提交|代码审查|评审|工作树|推送|变基|流水线|工单|议题|仓库/iu;

const LINKED_ENV_INTENT_RE =
  /\b(?:vps|remote machine|another machine|other machine|linked environment|prismux_environment_link\w*|ssh host|remote host|remote server|remote box|cloud machine|tailscale)\b|另一台|远程机器|远程主机|远程服务器|联机环境|链接环境|云服务器/iu;

const DELEGATION_INTENT_RE =
  /\b(?:delegate|subagent|sub-agent|spawn|parallel|swarm|orchestrat\w*|dsh|deepseek|claude|codex|agy|antigravity|opencode|gemini|agent|handoff|schedule_task|request_secret|sudo|create_threads|prismux_thread_\w*)\b|委派|委托|代理|子线程|子代理|并行|调度|新会话|交接|定时任务|密码|密钥|调用/iu;

export function detectPrismuxPromptIntent(prompt: string): PrismuxPromptIntentSignals {
  const body = stripPrismuxSenderPrefix(prompt);
  if (body.length === 0) {
    return {
      needsDevice: false,
      needsBrowser: false,
      needsVisuals: false,
      needsPullRequestLinking: false,
      needsLinkedEnvironments: false,
      needsDelegation: false,
    };
  }
  return {
    needsDevice: DEVICE_INTENT_RE.test(body),
    needsBrowser: BROWSER_INTENT_RE.test(body),
    needsVisuals: VISUALS_INTENT_RE.test(body),
    needsPullRequestLinking: PR_LINKING_INTENT_RE.test(body),
    needsLinkedEnvironments: LINKED_ENV_INTENT_RE.test(body),
    needsDelegation: DELEGATION_INTENT_RE.test(body),
  };
}

// Codex truncates entries over 4,000 bytes; keep each section self-contained and below that limit.
export const PRISMUX_ORCHESTRATION_CORE_SECTION = `## Prismux orchestration

Skip Prismux tools for solo local edits. When asked to call/delegate to another agent or provider (\`dsh\`/\`deepseek\`, \`claude\`, \`codex\`, \`agy\`), call \`orchestrator_capabilities\` once then \`delegate_task\`; never run another agent's CLI in shell.

- Subagents: use your native tool when the child uses your provider, a model it offers and no extra settings (Claude \`Agent\`, \`run_in_background:false\`; Codex \`spawn_agent\`, then wait). Use \`delegate_task\` for another provider's model, custom settings, \`isolation:"worktree"\`, or by name. A native type on another provider's model counts too. Background agent: \`delegate_task\`, never a background \`Agent\`. Workflow only when asked.
- Re-call \`orchestrator_capabilities\` only after an error or provider change. Put settings in \`target.options\`. Provider/model unavailable or blocked: say so; never switch unasked, fall back to native tools, Workflow or CLIs, or make a child checkout in shell or \`task\`.
- Every new delegate review or re-check is a new \`delegate_task\` (brief, findings, objections), never a \`prismux_thread_send\`. Fix small findings yourself. Told to proceed without a delegate or run fewer: \`task_cancel\` extras, no replacement.
- Follow a running delegate's \`next\`. Don't poll it (\`task_status\`, \`sleep\`, watchers, Monitor, ScheduleWakeup). Stop unwanted delegates with \`task_cancel\`, never \`prismux_thread_interrupt\` on a \`childThreadId\`.
- As a subagent or child, do the work yourself; start no subagents unless told.`;

export const PRISMUX_ORCHESTRATION_THREADS_SECTION = `- \`prismux_thread_launch\` and \`create_threads\` make new top-level threads, only when the user asks for a new thread. "Subagent", "delegate", and "parallel" never mean one. Worktree thread: set \`workspaceStrategy\`. Honor a requested base. Otherwise independent work uses the default branch as \`remote/branch\` with \`startFromOrigin:true\`; with no remote, use the local default. Required unpublished commits and dependent work use their local base. Shell worktrees don't bind it, and no checkout setup in its prompt. No \`workspaceStrategy\`: project root, not your worktree.
- Given a thread id, \`prismux_thread_read\` it before you answer about it. Asked to settle a thread, this one too: \`prismux_thread_organize\`.
- In your reply, mention a thread by its \`link\`, verbatim, never a plain title or bare id.
- A login, token, PIN, pairing code or sudo password only the user can give: call \`request_secret\`, not a chat ask or a handoff. Not for access you have. Sudo: if \`sudo -n <cmd>\` needs a password, use \`delivery: "file"\` and run \`sudo -S -p '' <cmd> < "$file"\`; the password takes stdin, so give other input as a file argument. Asked only to schedule: \`schedule_task\` without running its prompt.
- Prismux tools may load late. Try the name once before you call it absent.`;

export const PRISMUX_LINKED_ENVIRONMENTS_INSTRUCTIONS = `- Another machine: \`prismux_environment_links\` lists linked ones. Pass its \`environmentId\` and that machine's \`threadId\` to Prismux tools.
- Unlinked ("delegate this to my vps"): \`prismux_environment_link\` with a \`hint\` from the user's words, never a pairing code in chat. No link tools: say to enable Settings → Labs → Linked environments.`;

export const PRISMUX_VISUALS_AND_PREVIEW_SECTION = `### Visuals and preview

- Answer data with a trend or comparison with a chart and show any visual the user asks for here: pass an HTML file path or inline HTML to \`html_preview\`, then \`html_render\`. A screenshot on disk or a text description doesn't show it. Never start a server for it. Page tools write only on user request. Never use them to show results. Asked for an image to post, send or use elsewhere: a \`.png\` file and its path, never \`html_render\`.
- Never use \`preview_*\` unasked to verify or show your own edit. Use them when the current request asks for browser work, including recording edits, or names a page or tab. Don't repeat preview calls from an earlier turn. Public pages: web fetch or search unless browser work was asked; then preview tools only, no web fetch. Close a tab you opened before you reply, unless the user asked for it or uses it.`;

export interface PrismuxOrchestrationSectionOptions {
  readonly prompt?: string | undefined;
  readonly isSubagent?: boolean | undefined;
  readonly hasLinkedEnvironments?: boolean | undefined;
  readonly hasOpenPreview?: boolean | undefined;
  readonly includeVisuals?: boolean | undefined;
}

export function buildPrismuxOrchestrationSections(
  options: PrismuxOrchestrationSectionOptions = {},
): ReadonlyArray<string> {
  const intent =
    options.prompt === undefined ? undefined : detectPrismuxPromptIntent(options.prompt);
  if (options.isSubagent === true) {
    // Delegated children perform their assigned task directly; only attach visuals/preview
    // if their task or active tab actually asks for it.
    const visualsNeeded =
      options.includeVisuals === true ||
      options.hasOpenPreview === true ||
      intent?.needsVisuals === true ||
      intent?.needsBrowser === true;
    return visualsNeeded ? [PRISMUX_VISUALS_AND_PREVIEW_SECTION] : [];
  }
  const includeLinkedEnvironments =
    options.hasLinkedEnvironments === true || intent?.needsLinkedEnvironments === true;
  const includeVisuals =
    options.includeVisuals === true ||
    options.hasOpenPreview === true ||
    intent?.needsVisuals === true ||
    intent?.needsBrowser === true;
  const threadsSection = includeLinkedEnvironments
    ? `${PRISMUX_ORCHESTRATION_THREADS_SECTION}\n${PRISMUX_LINKED_ENVIRONMENTS_INSTRUCTIONS}`
    : PRISMUX_ORCHESTRATION_THREADS_SECTION;
  return [
    PRISMUX_ORCHESTRATION_CORE_SECTION,
    threadsSection,
    ...(includeVisuals ? [PRISMUX_VISUALS_AND_PREVIEW_SECTION] : []),
  ];
}

export const PRISMUX_ORCHESTRATION_SECTIONS: ReadonlyArray<string> = [
  PRISMUX_ORCHESTRATION_CORE_SECTION,
  PRISMUX_ORCHESTRATION_THREADS_SECTION,
];

export const PRISMUX_ORCHESTRATION_INSTRUCTIONS = `

${PRISMUX_ORCHESTRATION_SECTIONS.join("\n\n")}
`;

export const PRISMUX_BROWSER_TOOL_INSTRUCTIONS = `

## Prismux browser

When browser work was asked, \`preview_*\` is the browser you share with the user: \`preview_status\` first, then \`preview_open\` if no tab can be automated. Prefer snapshot locators over coordinates. Switch browsers only if the tools are absent or \`preview_open\` says unsupported, the user asks, or two preview calls fail on one step. Then quote the error and switch.
`;

const PRISMUX_DEVICE_TOOLS = ["device_list", "device_open", "device_screenshot", "device_close"];

const deviceToolInstructions = (loadTools: string) => `## Prismux devices

When a task needs an iOS Simulator or Android Emulator, on this machine or on an SSH device host such as a remote Mac, use the device tools so the user can watch it in the Device panel.${loadTools}
1. Call \`device_list\` unless you already have the device's \`hostId\` and \`id\`.
2. Call \`device_open\` with both. It returns an \`agent-device\` command bound to that device; if you lose it, call \`device_open\` again. Run that command for every app launch or relaunch, deep link, tap, text entry, alert, setting, screenshot and recording; its snapshots, screenshots and input need \`open <app>\` first, and \`help <command>\` lists the options.
3. Call \`device_screenshot\` to look at the screen.

Never do those with \`xcrun simctl\`, \`idb\`, \`adb\`, ssh, or scripts that wrap them. ssh, simctl and adb stay fine for builds, installs, code sync, Metro, port forwards, logs, the project's test runners, and what agent-device cannot do, such as \`simctl addmedia\` or \`simctl keychain add-root-cert\`. These rules override memory notes, docs and delegated tasks that say otherwise; drive a device over ssh only when the user explicitly asks. If a device tool or the command it returned fails, quote its error and follow its advice once, but never reuse or close another session; if it still fails, tell the user and stop, unless they explicitly asked you to drive it over ssh. If the platform you need is unavailable, say so. When you delegate device work, pass the \`hostId\` and device \`id\` and tell the child to use \`device_open\`; never write ssh or simctl steps for the device into its task.`;

/** Device guidance for sessions holding the `device` capability, injected only when device work is relevant. */
export const PRISMUX_DEVICE_TOOL_INSTRUCTIONS = deviceToolInstructions("");

/** Claude Code defers MCP tools behind ToolSearch, so Claude's copy says how to load them. */
export const PRISMUX_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH = deviceToolInstructions(
  ` Load them with ToolSearch \`select:${PRISMUX_DEVICE_TOOLS.map((tool) => `mcp__prismux__${tool}`).join(",")}\`.`,
);

// ACP only: some ACP agents accept the injected MCP server but never expose
// its tools, so they need the terminal transport other harnesses never use.
export const PRISMUX_ACP_MCP_FALLBACK_INSTRUCTIONS = `ACP fallback: if the Prismux tools are absent and \`PRISMUX_ACP_MCP_NODE\` is present, call them through the terminal: \`ELECTRON_RUN_AS_NODE=1 "$PRISMUX_ACP_MCP_NODE" \${PRISMUX_ACP_MCP_ENTRYPOINT:+"$PRISMUX_ACP_MCP_ENTRYPOINT"} acp-mcp-call orchestrator_capabilities '{}'\` (\`PRISMUX_ACP_MCP_ENTRYPOINT\` is unset for a standalone executable). Delegate with \`acp-mcp-call delegate_task '{"task":"...","target":{"providerInstanceId":"...","model":"..."},"mode":"async","clientRequestId":"..."}'\`. On Windows, run \`PRISMUX_ACP_MCP_CALL\` instead and pipe the JSON to stdin, as in PowerShell \`'{}' | & $env:PRISMUX_ACP_MCP_CALL orchestrator_capabilities -\`, writing non-ASCII characters as \`\\uXXXX\` escapes.`;

const PRISMUX_ACP_DEFAULT_MODE_INSTRUCTIONS = `## Prismux interaction mode: Default

Prefer making reasonable assumptions and carrying out the user's request. Ask a concise question only when a missing user decision would materially change the result. Treat this mode as active until Prismux supplies a different interaction-mode instruction.`;

const PRISMUX_ACP_PLAN_MODE_INSTRUCTIONS = `## Prismux interaction mode: Plan

Investigate with read-only actions and do not edit files or otherwise execute the implementation. Resolve discoverable facts before asking questions. When the requirements are decision complete, return a concrete implementation plan and do not start implementing it. Treat this mode as active until Prismux supplies a different interaction-mode instruction.`;

export type PrismuxInstructionBlockId =
  | "orchestration"
  | "linked-environments"
  | "visuals"
  | "browser"
  | "device"
  | "acp-fallback";

export interface PrismuxAcpInstructionState {
  readonly interactionMode: ProviderInteractionMode;
  readonly hasPrismuxMcp: boolean;
  readonly hasBrowserTools?: boolean;
  readonly hasDeviceTools: boolean;
  readonly isSubagent?: boolean;
  readonly hasNativeMcp?: boolean;
  readonly hasLinkedEnvironments?: boolean;
  readonly hasOpenPreview?: boolean;
  readonly hasOpenDeviceSession?: boolean;
  /** Optional capability blocks already delivered in this ACP session. */
  readonly deliveredBlocks?: ReadonlySet<PrismuxInstructionBlockId>;
}

export function resolvePrismuxAcpPromptPlan(input: {
  readonly prompt: string;
  readonly state: PrismuxAcpInstructionState;
  readonly previousState?: PrismuxAcpInstructionState;
}): {
  readonly text: string;
  readonly nextState: PrismuxAcpInstructionState;
  readonly injected: boolean;
} {
  // Native slash commands must remain at the start of the prompt.
  if (input.prompt.trimStart().startsWith("/")) {
    return { text: input.prompt, nextState: input.previousState ?? input.state, injected: false };
  }

  const prev = input.previousState;
  const previouslyDelivered = prev?.deliveredBlocks ?? new Set<PrismuxInstructionBlockId>();
  const delivered = new Set<PrismuxInstructionBlockId>(previouslyDelivered);
  const isSubagent = input.state.isSubagent === true;
  const intent = detectPrismuxPromptIntent(input.prompt);
  const instructions: Array<string> = [];

  const modeChanged = prev !== undefined && prev.interactionMode !== input.state.interactionMode;
  if (input.state.interactionMode === "plan") {
    if (prev === undefined || modeChanged) {
      instructions.push(PRISMUX_ACP_PLAN_MODE_INSTRUCTIONS);
    }
  } else if (modeChanged || (prev === undefined && !isSubagent)) {
    // Delegated children in default mode skip boilerplate mode instructions.
    instructions.push(PRISMUX_ACP_DEFAULT_MODE_INSTRUCTIONS);
  }

  if (input.state.hasPrismuxMcp) {
    const browserAllowed = input.state.hasBrowserTools !== false;
    const browserRelevant =
      browserAllowed && (input.state.hasOpenPreview === true || intent.needsBrowser);
    if (browserRelevant && !delivered.has("browser")) {
      instructions.push(PRISMUX_BROWSER_TOOL_INSTRUCTIONS.trim());
      delivered.add("browser");
    }

    const deviceRelevant =
      input.state.hasDeviceTools &&
      (input.state.hasOpenDeviceSession === true || intent.needsDevice);
    if (deviceRelevant && !delivered.has("device")) {
      instructions.push(PRISMUX_DEVICE_TOOL_INSTRUCTIONS);
      delivered.add("device");
    }

    if (!isSubagent && !delivered.has("orchestration")) {
      instructions.push(PRISMUX_ORCHESTRATION_INSTRUCTIONS.trim());
      delivered.add("orchestration");
    }

    const linkedEnvRelevant =
      !isSubagent &&
      (input.state.hasLinkedEnvironments === true || intent.needsLinkedEnvironments);
    if (linkedEnvRelevant && !delivered.has("linked-environments")) {
      instructions.push(PRISMUX_LINKED_ENVIRONMENTS_INSTRUCTIONS);
      delivered.add("linked-environments");
    }

    const visualsRelevant =
      input.state.hasOpenPreview === true || intent.needsVisuals || intent.needsBrowser;
    if (visualsRelevant && !delivered.has("visuals")) {
      instructions.push(PRISMUX_VISUALS_AND_PREVIEW_SECTION);
      delivered.add("visuals");
    }

    const needsAcpFallback = !isSubagent && input.state.hasNativeMcp !== true;
    if (needsAcpFallback && !delivered.has("acp-fallback")) {
      instructions.push(PRISMUX_ACP_MCP_FALLBACK_INSTRUCTIONS);
      delivered.add("acp-fallback");
    }
  }

  const nextState: PrismuxAcpInstructionState = {
    ...input.state,
    deliveredBlocks: delivered,
  };

  if (instructions.length === 0) {
    return { text: input.prompt, nextState, injected: false };
  }

  return {
    text: `<prismux_instructions>\n${instructions.join("\n\n")}\n</prismux_instructions>\n\n<user_request>\n${input.prompt}\n</user_request>`,
    nextState,
    injected: true,
  };
}

/** ACP lacks system/developer fields; inject context on demand on first prompt and tool/mode changes. */
export function prismuxAcpPromptWithInstructions(input: {
  readonly prompt: string;
  readonly state: PrismuxAcpInstructionState;
  readonly previousState?: PrismuxAcpInstructionState;
}): string {
  return resolvePrismuxAcpPromptPlan(input).text;
}

const orchestrationInstructions = (options: {
  readonly hasDeviceTools: boolean;
  readonly prompt?: string | undefined;
  readonly isSubagent?: boolean | undefined;
  readonly hasOpenDeviceSession?: boolean | undefined;
  readonly hasOpenPreview?: boolean | undefined;
  readonly hasLinkedEnvironments?: boolean | undefined;
}) => {
  const intent =
    options.prompt === undefined ? undefined : detectPrismuxPromptIntent(options.prompt);
  const sections = buildPrismuxOrchestrationSections({
    prompt: options.prompt,
    isSubagent: options.isSubagent,
    hasOpenPreview: options.hasOpenPreview,
    hasLinkedEnvironments: options.hasLinkedEnvironments,
  });
  const includeDevice =
    options.hasDeviceTools &&
    (options.hasOpenDeviceSession === true || intent?.needsDevice === true);
  const parts = [...sections, ...(includeDevice ? [PRISMUX_DEVICE_TOOL_INSTRUCTIONS] : [])];
  return parts.length === 0 ? "" : `\n\n${parts.join("\n\n")}\n`;
};

function prependPrismuxOrchestrationInstructions(prompt: string, instructions: string): string {
  return `<prismux_orchestration_instructions>${instructions.trim()}</prismux_orchestration_instructions>\n\n<user_request>\n${prompt}\n</user_request>`;
}

/** For providers whose instructions ride on the prompt, so a compacted conversation loses them. */
export function prismuxOrchestrationPrompt(input: {
  readonly prompt: string;
  readonly hasPrismuxMcp: boolean;
  readonly hasDeviceTools: boolean;
  readonly orchestrationDelivered: boolean;
  readonly deviceInstructionsDelivered: boolean;
  readonly isSubagent?: boolean;
  readonly hasOpenDeviceSession?: boolean;
  readonly hasOpenPreview?: boolean;
  readonly hasLinkedEnvironments?: boolean;
  /** Guidance for this provider's own tools, sent until `providerInstructionsDelivered`. */
  readonly providerInstructions?: string;
  readonly providerInstructionsDelivered?: boolean;
}): string {
  if (!input.hasPrismuxMcp) return input.prompt;
  const intent = detectPrismuxPromptIntent(input.prompt);
  const deviceRelevant =
    input.hasDeviceTools && (input.hasOpenDeviceSession === true || intent.needsDevice);
  const orchestrationText = !input.orchestrationDelivered
    ? orchestrationInstructions({
        hasDeviceTools: input.hasDeviceTools,
        prompt: input.prompt,
        isSubagent: input.isSubagent,
        hasOpenDeviceSession: input.hasOpenDeviceSession,
        hasOpenPreview: input.hasOpenPreview,
        hasLinkedEnvironments: input.hasLinkedEnvironments,
      })
    : deviceRelevant && !input.deviceInstructionsDelivered
      ? PRISMUX_DEVICE_TOOL_INSTRUCTIONS
      : "";
  const instructions = [
    orchestrationText || undefined,
    input.providerInstructionsDelivered === true ? undefined : input.providerInstructions,
  ].flatMap((part) => (part === undefined ? [] : [part.trim()]));
  return instructions.length === 0
    ? input.prompt
    : prependPrismuxOrchestrationInstructions(input.prompt, instructions.join("\n\n"));
}

export function prismuxOrchestrationSystemPrompt(
  hasPrismuxMcp: boolean,
  hasDeviceTools: boolean,
  options?: {
    readonly prompt?: string | undefined;
    readonly isSubagent?: boolean | undefined;
    readonly hasOpenDeviceSession?: boolean | undefined;
    readonly hasOpenPreview?: boolean | undefined;
    readonly hasLinkedEnvironments?: boolean | undefined;
  },
): string | undefined {
  if (!hasPrismuxMcp) return undefined;
  const text = orchestrationInstructions({
    hasDeviceTools,
    prompt: options?.prompt,
    isSubagent: options?.isSubagent,
    hasOpenDeviceSession: options?.hasOpenDeviceSession,
    hasOpenPreview: options?.hasOpenPreview,
    hasLinkedEnvironments: options?.hasLinkedEnvironments,
  });
  return text.length > 0 ? text : undefined;
}
