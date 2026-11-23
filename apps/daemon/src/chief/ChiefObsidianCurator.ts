import { spawn } from "node:child_process";
import process from "node:process";
import {
  buildObsidianCurationPrompt,
  parseAgentCurationJson,
  type ObsidianAgentCurator
} from "@prismux/memory-core";
import {
  DEFAULT_CHIEF_SECRETARY_NAME,
  normalizeChiefProviderKind,
  type ChiefProviderKind
} from "@prismux/protocol";
import { sanitizeChildEnv } from "../t3/T3ServerSupervisor.js";
import type { ChiefThreadManager } from "./ChiefThreadManager.js";

interface CliCommandPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdinPrompt: string;
  readonly label: string;
}

function formatProviderDisplay(provider: ChiefProviderKind): string {
  switch (provider) {
    case "claude-code":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "antigravity":
      return "Antigravity";
    case "omp":
      return "oh-my-pi";
    case "gemini":
      return "Gemini CLI";
    case "opencode":
      return "OpenCode";
    case "cursor":
      return "Cursor";
    case "acp":
      return "ACP";
  }
}

function buildCliCommandPlan(
  provider: ChiefProviderKind,
  prompt: string,
  model?: string
): CliCommandPlan | null {
  const isWin = process.platform === "win32";
  const ext = (bin: string) => (isWin ? `${bin}.cmd` : bin);

  switch (provider) {
    case "claude-code":
      return {
        command: ext("claude"),
        args: [
          "-p",
          "--output-format",
          "text",
          ...(model ? ["--model", model] : [])
        ],
        stdinPrompt: prompt,
        label: "Claude Code"
      };
    case "codex":
      return {
        command: ext("codex"),
        args: [
          "exec",
          "--skip-git-repo-check",
          ...(model ? ["-m", model] : []),
          "-"
        ],
        stdinPrompt: prompt,
        label: "Codex"
      };
    case "gemini":
      return {
        command: ext("gemini"),
        args: [...(model ? ["-m", model] : []), "-p", prompt],
        stdinPrompt: "",
        label: "Gemini CLI"
      };
    default:
      return null;
  }
}

function runCliCaptureStdout(
  plan: CliCommandPlan,
  signal: AbortSignal
): Promise<string | null> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };

    const childEnv = sanitizeChildEnv(process.env);
    let child;
    try {
      child = spawn(plan.command, [...plan.args], {
        env: childEnv,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: process.platform === "win32"
      });
    } catch {
      finish(null);
      return;
    }

    const onAbort = () => {
      try {
        child.kill();
      } catch {
        // ignore kill error
      }
      finish(null);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    let stdout = "";
    const MAX_STDOUT_BYTES = 512 * 1024;
    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (stdout.length < MAX_STDOUT_BYTES) {
        stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      }
    });

    child.on("error", () => finish(null));
    child.on("close", (code) => {
      if (code !== 0 || stdout.trim().length === 0) {
        finish(null);
        return;
      }
      finish(stdout);
    });

    try {
      if (plan.stdinPrompt.length > 0) {
        child.stdin?.write(plan.stdinPrompt, "utf8");
      }
      child.stdin?.end();
    } catch {
      // ignore EPIPE if child exited quickly
    }
  });
}

/**
 * Creates a daemon-side Agent curator that attempts to invoke the active Chief CLI
 * in a sanitized child environment (`ELECTRON_RUN_AS_NODE` stripped) with strict AbortSignal
 * timeout, gracefully returning `null` so `planObsidianImport` falls back cleanly offline.
 */
export function createChiefObsidianAgentCurator(options: {
  readonly chiefManager?: ChiefThreadManager;
  readonly enableLocalCli?: boolean;
}): ObsidianAgentCurator {
  return async ({ defaultNamespace, notes, provider, model, signal }) => {
    const slot = options.chiefManager ? safeGetSlot(options.chiefManager) : null;
    const secretaryName = slot?.secretaryName ?? DEFAULT_CHIEF_SECRETARY_NAME;
    const resolvedProvider: ChiefProviderKind =
      normalizeChiefProviderKind(provider) ?? slot?.activeProvider ?? "claude-code";
    const resolvedModel = model?.trim() || slot?.model;
    const curatorLabel = `${secretaryName} · ${formatProviderDisplay(resolvedProvider)}`;

    if (options.enableLocalCli === false || process.env["PRISMUX_DISABLE_OBSIDIAN_CLI_CURATOR"] === "1") {
      return null;
    }

    const prompt = buildObsidianCurationPrompt({
      secretaryName,
      defaultNamespace,
      notes
    });

    const plan = buildCliCommandPlan(resolvedProvider, prompt, resolvedModel);
    if (!plan) {
      return null;
    }

    const rawOutput = await runCliCaptureStdout(plan, signal);
    if (!rawOutput) {
      return null;
    }

    const proposals = parseAgentCurationJson(rawOutput);
    if (!proposals || proposals.length === 0) {
      return null;
    }

    return {
      items: proposals,
      curatorLabel
    };
  };
}

function safeGetSlot(chiefManager: ChiefThreadManager) {
  try {
    return chiefManager.getSlot();
  } catch {
    return null;
  }
}
