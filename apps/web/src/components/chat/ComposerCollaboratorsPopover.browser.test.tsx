import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@prismux/core-contracts";
import { FolderIcon, MonitorIcon } from "lucide-react";
import { type CSSProperties, createRef, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "@prismux/appearance/styles.css";
import "~/index.css";
import { render } from "../../../test/render";
import type { AppModelOption } from "../../modelSelection";
import { SUBSCRIPTION_WAIVER_ROUTE } from "../../prismux/SubscriptionRiskWaiverSection";
import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  ComposerPromptEditorTiptap,
  type ComposerPromptEditorHandle,
} from "../ComposerPromptEditorTiptap";
import {
  type CollaboratorProviderProbeLike,
  type CollaboratorWaiverPolicy,
  type ComposerCollaboratorSelection,
} from "./composerCollaborators.logic";
import { ComposerCollaboratorsPopoverView } from "./ComposerCollaboratorsPopover";
import { ComposerSlashCommandChip } from "./ComposerSlashCommandChip";

vi.mock(import("../../state/server"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig, DEFAULT_KEYBINDINGS } =
    await import("@prismux/core-shared/keybindings");
  return {
    ...(await original()),
    primaryServerKeybindingsAtom: Atom.make(compileResolvedKeybindingsConfig(DEFAULT_KEYBINDINGS)),
  };
});

function makeProviderEntry(input: {
  instanceId: string;
  driverKind: string;
  displayName: string;
  models: Array<{ slug: string; name: string }>;
  auth?: ServerProvider["auth"];
}): ProviderInstanceEntry {
  const instanceId = ProviderInstanceId.make(input.instanceId);
  const driverKind = ProviderDriverKind.make(input.driverKind);
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
    models: input.models.map((model) => ({
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
    { slug: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash 1017 · Bailian Token Plan" },
    { slug: "glm5.4-max", name: "GLM5.4-Max · 付费组" },
    { slug: "deepseek-reasoner", name: "DeepSeek Reasoner" },
    { slug: "deepseek-chat", name: "DeepSeek Chat" },
  ],
});

const codexEntry = makeProviderEntry({
  instanceId: "codex",
  driverKind: "codex",
  displayName: "Codex",
  models: [
    { slug: "gpt-5.4", name: "GPT-5.4" },
    { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
  ],
});

const ollamaEntry = makeProviderEntry({
  instanceId: "ollama",
  driverKind: "ollama",
  displayName: "Ollama",
  models: [{ slug: "qwen3-coder:32b", name: "Qwen3 Coder 32B" }],
});

const agyEntry = makeProviderEntry({
  instanceId: "antigravity",
  driverKind: "antigravity",
  displayName: "Antigravity",
  models: [{ slug: "gemini-2.5-pro", name: "Gemini 2.5 Pro" }],
});

const claudeOAuthEntry = makeProviderEntry({
  instanceId: "claudeAgent",
  driverKind: "claudeAgent",
  displayName: "Claude Code",
  auth: { status: "authenticated", type: "oauth", subscriptionType: "max" },
  models: [{ slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }],
});

const ENTRIES = [dshEntry, codexEntry, ollamaEntry, agyEntry, claudeOAuthEntry] as const;

const MODEL_OPTIONS = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>(
  ENTRIES.map((entry) => [
    entry.instanceId,
    entry.models.map((model) => ({
      slug: model.slug,
      name: model.name,
      isCustom: false,
    })),
  ]),
);

const PROBES: ReadonlyArray<CollaboratorProviderProbeLike> = [
  { providerId: "dsh", authMode: "api_or_custom" },
  { providerId: "codex", authMode: "api_or_custom" },
  { providerId: "ollama", authMode: "local" },
  { providerId: "antigravity", authMode: "subscription_oauth" },
  { providerId: "claude", authMode: "subscription_oauth" },
];

const LOCKED_WAIVER: CollaboratorWaiverPolicy = {
  signed: false,
  allowAntigravityAsControlledAgent: false,
  allowExternalSubscriptionAgentsInSwarm: false,
};

function InteractiveCollaboratorsHarness({
  initialSelections = [],
  onOpenWaiver,
}: {
  readonly initialSelections?: ReadonlyArray<ComposerCollaboratorSelection>;
  readonly onOpenWaiver: (route: typeof SUBSCRIPTION_WAIVER_ROUTE) => void;
}) {
  const [selections, setSelections] =
    useState<ReadonlyArray<ComposerCollaboratorSelection>>(initialSelections);

  return (
    <div className="p-8 pt-80">
      <div className="mx-auto w-[640px] rounded-3xl border border-border/80 bg-muted/40 p-1">
        <div
          data-pmx-composer-top-tray="1"
          className="flex min-w-0 items-center justify-between gap-1 px-2 pb-1.5 pt-0.5 text-xs"
        >
          <div className="flex items-center gap-1.5 text-foreground/85">
            <span className="inline-flex h-6 items-center gap-1.5 rounded-lg px-2 font-medium">
              <FolderIcon className="size-3.5 opacity-75" />
              Prismux
            </span>
            <span className="inline-flex h-6 items-center gap-1.5 rounded-lg px-2 font-medium">
              <MonitorIcon className="size-3.5 opacity-75" />
              ROG-FISH
            </span>
          </div>
          <ComposerCollaboratorsPopoverView
            providerInstanceEntries={ENTRIES}
            modelOptionsByInstance={MODEL_OPTIONS}
            selections={selections}
            probes={PROBES}
            waiver={LOCKED_WAIVER}
            onChangeSelections={setSelections}
            onOpenWaiverSettings={onOpenWaiver}
            className="ms-auto"
          />
        </div>
        <div className="rounded-2xl border border-border/75 bg-card px-3 py-2.5 text-sm text-muted-foreground">
          Ask anything, @ to mention files, / for commands
        </div>
      </div>
    </div>
  );
}

function InteractiveSlashEditorHarness({
  initialValue = "",
  onLatestValue,
}: {
  readonly initialValue?: string;
  readonly onLatestValue: (value: string) => void;
}) {
  const [state, setState] = useState({ value: initialValue, cursor: initialValue.length });
  return (
    <div className="mx-auto w-[580px] rounded-2xl border border-border/80 bg-card p-3">
      <ComposerPromptEditorTiptap
        editorRef={createRef<ComposerPromptEditorHandle>()}
        value={state.value}
        cursor={state.cursor}
        richTextEnabled={true}
        contextRecords={new Map()}
        skills={[]}
        disabled={false}
        placeholder="Ask anything..."
        onChange={(nextValue, nextCursor) => {
          setState({ value: nextValue, cursor: nextCursor });
          onLatestValue(nextValue);
        }}
        onPaste={() => {}}
      />
    </div>
  );
}

const LIGHT_CARD_VARS: CSSProperties = {
  colorScheme: "light",
  background: "#f4f5f7",
  color: "#18181b",
  ["--background" as string]: "#ffffff",
  ["--color-background" as string]: "#ffffff",
  ["--foreground" as string]: "#18181b",
  ["--color-foreground" as string]: "#18181b",
  ["--card" as string]: "#ffffff",
  ["--color-card" as string]: "#ffffff",
  ["--card-foreground" as string]: "#18181b",
  ["--color-card-foreground" as string]: "#18181b",
  ["--muted" as string]: "#f4f4f5",
  ["--color-muted" as string]: "#f4f4f5",
  ["--muted-foreground" as string]: "#52525b",
  ["--color-muted-foreground" as string]: "#52525b",
  ["--border" as string]: "#d4d4d8",
  ["--color-border" as string]: "#d4d4d8",
  ["--pmx-accent" as string]: "#2563eb",
  ["--pmx-accent-text" as string]: "#1d4ed8",
  ["--pmx-accent-soft" as string]: "rgba(37, 99, 235, 0.11)",
  ["--pmx-accent-border" as string]: "rgba(37, 99, 235, 0.34)",
};

const DARK_CARD_VARS: CSSProperties = {
  colorScheme: "dark",
  background: "#121316",
  color: "#f4f4f5",
  ["--background" as string]: "#121316",
  ["--color-background" as string]: "#121316",
  ["--foreground" as string]: "#f4f4f5",
  ["--color-foreground" as string]: "#f4f4f5",
  ["--card" as string]: "#1b1d22",
  ["--color-card" as string]: "#1b1d22",
  ["--card-foreground" as string]: "#f4f4f5",
  ["--color-card-foreground" as string]: "#f4f4f5",
  ["--muted" as string]: "#23262e",
  ["--color-muted" as string]: "#23262e",
  ["--muted-foreground" as string]: "#a1a1aa",
  ["--color-muted-foreground" as string]: "#a1a1aa",
  ["--border" as string]: "#2e323c",
  ["--color-border" as string]: "#2e323c",
  ["--pmx-accent" as string]: "#3b82f6",
  ["--pmx-accent-text" as string]: "#93c5fd",
  ["--pmx-accent-soft" as string]: "rgba(59, 130, 246, 0.16)",
  ["--pmx-accent-border" as string]: "rgba(147, 197, 253, 0.36)",
};

const GLASS_CARD_VARS: CSSProperties = {
  colorScheme: "dark",
  background: "radial-gradient(circle at 20% 20%, #1d4e89 0%, #0f2942 48%, #091525 100%)",
  color: "#f8fafc",
  ["--background" as string]: "rgba(15, 23, 42, 0.62)",
  ["--color-background" as string]: "rgba(15, 23, 42, 0.62)",
  ["--foreground" as string]: "#f8fafc",
  ["--color-foreground" as string]: "#f8fafc",
  ["--card" as string]: "rgba(15, 23, 42, 0.68)",
  ["--color-card" as string]: "rgba(15, 23, 42, 0.68)",
  ["--card-foreground" as string]: "#f8fafc",
  ["--color-card-foreground" as string]: "#f8fafc",
  ["--muted-foreground" as string]: "#cbd5e1",
  ["--color-muted-foreground" as string]: "#cbd5e1",
  ["--border" as string]: "rgba(148, 163, 184, 0.28)",
  ["--color-border" as string]: "rgba(148, 163, 184, 0.28)",
  ["--pmx-accent" as string]: "#38bdf8",
  ["--pmx-accent-text" as string]: "#7dd3fc",
  ["--pmx-accent-soft" as string]: "rgba(56, 189, 248, 0.17)",
  ["--pmx-accent-border" as string]: "rgba(125, 211, 252, 0.42)",
};

describe("ComposerCollaboratorsPopover & inline slash-command chips (real Chrome)", () => {
  it("selects multiple agents, switches models, clamps counts, and enforces AGY/OAuth waiver locks", async () => {
    const onOpenWaiver = vi.fn();
    await using _screen = await render(
      <InteractiveCollaboratorsHarness onOpenWaiver={onOpenWaiver} />,
    );

    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-testid="composer-collaborators-trigger"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger!.dataset.pmxCollabTrigger).toBe("idle");
    expect(trigger!.textContent).toContain("邀请协作");

    // Compact top-right trigger dimensions (does not bloat composer chrome)
    const triggerRect = trigger!.getBoundingClientRect();
    expect(triggerRect.height).toBeLessThanOrEqual(28);
    expect(triggerRect.width).toBeLessThanOrEqual(120);

    await userEvent.click(trigger!);

    const popover = document.querySelector<HTMLElement>(
      '[data-testid="composer-collaborators-popover"]',
    );
    expect(popover).not.toBeNull();
    expect(popover!.getAttribute("data-pmx-glass-zone")).toBe("overlays");
    expect(popover!.getBoundingClientRect().width).toBeLessThanOrEqual(340);

    // Locked AGY & OAuth rows cannot be toggled
    const agyToggle = document.querySelector<HTMLButtonElement>(
      '[data-testid="composer-collab-toggle-antigravity"]',
    )!;
    const claudeToggle = document.querySelector<HTMLButtonElement>(
      '[data-testid="composer-collab-toggle-claudeAgent"]',
    )!;
    expect(agyToggle.disabled).toBe(true);
    expect(claudeToggle.disabled).toBe(true);

    // Select DSH + increment to 2, select Codex + switch model via custom themed dropdown (zero native <select>)
    await userEvent.click(
      document.querySelector<HTMLButtonElement>('[data-testid="composer-collab-toggle-dsh"]')!,
    );
    expect(popover!.querySelectorAll("select")).toHaveLength(0);
    await userEvent.click(
      document.querySelector<HTMLButtonElement>('[data-testid="composer-collab-inc-dsh"]')!,
    );
    await userEvent.click(
      document.querySelector<HTMLButtonElement>('[data-testid="composer-collab-toggle-codex"]')!,
    );
    const codexModelTrigger = document.querySelector<HTMLButtonElement>(
      '[data-testid="composer-collab-model-codex"]',
    )!;
    expect(codexModelTrigger.tagName).toBe("BUTTON");
    await userEvent.click(codexModelTrigger);

    const codexPopup = page.getByTestId("composer-collab-model-popup-codex");
    await expect.element(codexPopup).toBeVisible();
    await userEvent.click(
      document.querySelector<HTMLElement>(
        '[data-testid="composer-collab-model-option-codex-gpt-5.3-codex"]',
      )!,
    );

    // Parent collaborators popover remains open after selecting from nested model dropdown
    await expect.element(page.getByTestId("composer-collaborators-popover")).toBeVisible();

    expect(
      document.querySelector<HTMLElement>('[data-testid="composer-collab-count-dsh"]')?.textContent,
    ).toBe("2");
    expect(codexModelTrigger.dataset.pmxCollabModelValue).toBe("gpt-5.3-codex");
    expect(codexModelTrigger.textContent).toContain("GPT-5.3 Codex");
    expect(trigger!.dataset.pmxCollabTrigger).toBe("active");
    expect(trigger!.textContent).toContain("协作 · 3");

    // Clicking locked AGY waiver action navigates directly to waiver anchor
    await userEvent.click(
      document.querySelector<HTMLButtonElement>(
        '[data-testid="composer-collab-waiver-antigravity"]',
      )!,
    );
    expect(onOpenWaiver).toHaveBeenCalledWith(SUBSCRIPTION_WAIVER_ROUTE);

    // Reopen and clear all collaborators -> back to 0-token idle state
    await userEvent.click(trigger!);
    await userEvent.click(
      document.querySelector<HTMLButtonElement>('[data-testid="composer-collaborators-clear"]')!,
    );
    expect(trigger!.dataset.pmxCollabTrigger).toBe("idle");
    expect(trigger!.textContent).toContain("邀请协作");
  });

  it("supports adding multiple model rows under the same provider, inherits previous model, deduplicates stacked icons, and enforces caps", async () => {
    const onOpenWaiver = vi.fn();
    await using _screen = await render(
      <InteractiveCollaboratorsHarness onOpenWaiver={onOpenWaiver} />,
    );

    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-testid="composer-collaborators-trigger"]',
    )!;
    await userEvent.click(trigger);

    // Enable DSH (defaults to first model: deepseek-v4.1-flash, count 1)
    await userEvent.click(
      document.querySelector<HTMLButtonElement>('[data-testid="composer-collab-toggle-dsh"]')!,
    );
    expect(document.querySelector('[data-testid="composer-collab-remove-row-dsh-0"]')).toBeNull();

    // Switch row 0 to deepseek-reasoner
    await userEvent.click(
      document.querySelector<HTMLButtonElement>('[data-testid="composer-collab-model-dsh"]')!,
    );
    await expect.element(page.getByTestId("composer-collab-model-popup-dsh")).toBeVisible();
    await userEvent.click(
      document.querySelector<HTMLElement>(
        '[data-testid="composer-collab-model-option-dsh-deepseek-reasoner"]',
      )!,
    );

    // Click "+ 添加模型类别" -> row 1 inherits row 0's model (deepseek-reasoner) with count 1
    await userEvent.click(
      document.querySelector<HTMLButtonElement>('[data-testid="composer-collab-add-model-dsh"]')!,
    );
    const secondTrigger = document.querySelector<HTMLButtonElement>(
      '[data-testid="composer-collab-model-dsh-1"]',
    )!;
    expect(secondTrigger).not.toBeNull();
    expect(secondTrigger.dataset.pmxCollabModelValue).toBe("deepseek-reasoner");
    expect(
      document.querySelector<HTMLElement>('[data-testid="composer-collab-count-dsh-1"]')
        ?.textContent,
    ).toBe("1");

    // Trigger icon stack deduplicates DSH to 1 icon even with 2 DSH model rows
    expect(trigger.querySelectorAll('[data-pmx-collab-stack-icon="dsh"]')).toHaveLength(1);
    expect(trigger.textContent).toContain("协作 · 2");

    // Change row 1 model to GLM5.4-Max and step its count to 2 independently
    await userEvent.click(secondTrigger);
    await expect.element(page.getByTestId("composer-collab-model-popup-dsh-1")).toBeVisible();
    await userEvent.click(
      document.querySelector<HTMLElement>(
        '[data-testid="composer-collab-model-option-dsh-1-glm5.4-max"]',
      )!,
    );
    await userEvent.click(
      document.querySelector<HTMLButtonElement>('[data-testid="composer-collab-inc-dsh-1"]')!,
    );

    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="composer-collab-model-dsh"]')!
        .dataset.pmxCollabModelValue,
    ).toBe("deepseek-reasoner");
    expect(secondTrigger.dataset.pmxCollabModelValue).toBe("glm5.4-max");
    expect(
      document.querySelector<HTMLElement>('[data-testid="composer-collab-count-dsh"]')?.textContent,
    ).toBe("1");
    expect(
      document.querySelector<HTMLElement>('[data-testid="composer-collab-count-dsh-1"]')
        ?.textContent,
    ).toBe("2");
    expect(trigger.textContent).toContain("协作 · 3");
    expect(
      document.querySelector<HTMLElement>('[data-testid="composer-collaborators-popover"]')
        ?.textContent,
    ).toContain("已选 1 个代理 · 2 组模型（最多委派 3 次）");

    // Step row 1 up to reach per-agent cap 6 (1 + 5) -> both + buttons and add-model disable
    for (let index = 0; index < 3; index += 1) {
      await userEvent.click(
        document.querySelector<HTMLButtonElement>('[data-testid="composer-collab-inc-dsh-1"]')!,
      );
    }
    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="composer-collab-inc-dsh"]')!
        .disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="composer-collab-inc-dsh-1"]')!
        .disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="composer-collab-add-model-dsh"]')!
        .disabled,
    ).toBe(true);

    // Delete row 1 -> back to 1 row, single-row delete button disappears
    await userEvent.click(
      document.querySelector<HTMLButtonElement>(
        '[data-testid="composer-collab-remove-row-dsh-1"]',
      )!,
    );
    expect(document.querySelector('[data-testid="composer-collab-model-dsh-1"]')).toBeNull();
    expect(document.querySelector('[data-testid="composer-collab-remove-row-dsh-0"]')).toBeNull();
    expect(trigger.textContent).toContain("协作 · 1");

    // Top-right × removes entire provider
    await userEvent.click(
      document.querySelector<HTMLButtonElement>('[data-testid="composer-collab-remove-dsh"]')!,
    );
    expect(trigger.dataset.pmxCollabTrigger).toBe("idle");
  });

  it("renders themed custom model dropdown with >= 4.5:1 contrast across Light, Dark, and Liquid Glass modes", async () => {
    await page.viewport(1280, 820);

    type Rgba = { r: number; g: number; b: number; a: number };
    const parseColor = (raw: string): Rgba => {
      const match = raw.match(
        /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)/,
      );
      if (match) {
        return {
          r: Number(match[1]),
          g: Number(match[2]),
          b: Number(match[3]),
          a: match[4] !== undefined ? Number(match[4]) : 1,
        };
      }
      // Fallback for CSS Color 4 formats (e.g. oklch/oklab/color(srgb ...)) via 1x1 canvas pixel read
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = raw;
      ctx.fillRect(0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      return { r: data[0]!, g: data[1]!, b: data[2]!, a: data[3]! / 255 };
    };
    const compositeOver = (fg: Rgba, bg: Rgba): Rgba => {
      const a = fg.a + bg.a * (1 - fg.a);
      if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
        g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
        b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
        a,
      };
    };
    const relLum = (c: Rgba): number => {
      const chan = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
    };
    const contrastRatio = (a: Rgba, b: Rgba): number => {
      const l1 = relLum(a);
      const l2 = relLum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };

    const scenarios: ReadonlyArray<{
      readonly name: string;
      readonly dark: boolean;
      readonly glass: boolean;
      readonly backdrop: Rgba;
      readonly rootOverrides?: Readonly<Record<string, string>>;
    }> = [
      {
        name: "light",
        dark: false,
        glass: false,
        backdrop: { r: 244, g: 245, b: 247, a: 1 },
      },
      {
        name: "dark",
        dark: true,
        glass: false,
        backdrop: { r: 18, g: 19, b: 22, a: 1 },
      },
      {
        name: "dark-glass",
        dark: true,
        glass: true,
        backdrop: { r: 15, g: 41, b: 66, a: 1 },
        rootOverrides: {
          "--popover": "rgba(13, 21, 36, 0.84)",
          "--popover-foreground": "rgba(255, 255, 255, 0.96)",
          "--contrast-popover-foreground": "rgba(255, 255, 255, 0.96)",
          "--pmx-overlay-bg": "rgba(13, 21, 36, 0.84)",
          "--pmx-glass-zone-overlays-bg": "rgba(13, 21, 36, 0.84)",
          "--pmx-accent": "#38bdf8",
          "--pmx-accent-text": "#7dd3fc",
          "--pmx-accent-soft": "rgba(56, 189, 248, 0.18)",
        },
      },
      {
        name: "light-glass",
        dark: false,
        glass: true,
        backdrop: { r: 224, g: 236, b: 250, a: 1 },
        rootOverrides: {
          "--pmx-glass-tint": "#f8fafc",
          "--pmx-canvas-bg": "rgba(248, 250, 255, 0.84)",
          "--popover": "rgba(248, 250, 255, 0.84)",
          "--popover-foreground": "rgba(15, 23, 42, 0.95)",
          "--contrast-popover-foreground": "rgba(15, 23, 42, 0.95)",
          "--pmx-overlay-bg": "rgba(248, 250, 255, 0.84)",
          "--pmx-glass-zone-overlays-bg": "rgba(248, 250, 255, 0.84)",
          "--pmx-accent": "#2563eb",
          "--pmx-accent-text": "#1d4ed8",
          "--pmx-accent-soft": "rgba(37, 99, 235, 0.12)",
        },
      },
    ];

    const root = document.documentElement;
    const prevDark = root.classList.contains("dark");
    const prevGlass = root.getAttribute("data-pmx-glass");

    try {
      for (const scenario of scenarios) {
        root.classList.toggle("dark", scenario.dark);
        root.setAttribute("data-pmx-glass", scenario.glass ? "1" : "0");
        const prevProps = new Map<string, string>();
        for (const [key, value] of Object.entries(scenario.rootOverrides ?? {})) {
          prevProps.set(key, root.style.getPropertyValue(key));
          root.style.setProperty(key, value);
        }

        try {
          await using screen = await render(
            <InteractiveCollaboratorsHarness
              initialSelections={[
                {
                  id: "dsh#1",
                  providerInstanceId: dshEntry.instanceId,
                  model: "deepseek-v4.1-flash",
                  maxCount: 1,
                },
                {
                  id: "dsh#2",
                  providerInstanceId: dshEntry.instanceId,
                  model: "glm5.4-max",
                  maxCount: 2,
                },
              ]}
              onOpenWaiver={() => {}}
            />,
          );

          await userEvent.click(
            document.querySelector<HTMLButtonElement>(
              '[data-testid="composer-collaborators-trigger"]',
            )!,
          );
          await expect.element(page.getByTestId("composer-collaborators-popover")).toBeVisible();

          const modelTrigger = document.querySelector<HTMLButtonElement>(
            '[data-testid="composer-collab-model-dsh"]',
          )!;
          await userEvent.click(modelTrigger);

          const popup = page.getByTestId("composer-collab-model-popup-dsh");
          await expect.element(popup).toBeVisible();

          const popupEl = document.querySelector<HTMLElement>(
            '[data-testid="composer-collab-model-popup-dsh"]',
          )!;
          const surfaceEl = popupEl.querySelector<HTMLElement>('[data-pmx-glass-zone="overlays"]')!;
          expect(surfaceEl).not.toBeNull();

          const surfaceBg = compositeOver(
            parseColor(getComputedStyle(surfaceEl).backgroundColor),
            scenario.backdrop,
          );

          const selectedOption = document.querySelector<HTMLElement>(
            '[data-testid="composer-collab-model-option-dsh-deepseek-v4.1-flash"]',
          )!;
          const unselectedOption = document.querySelector<HTMLElement>(
            '[data-testid="composer-collab-model-option-dsh-glm5.4-max"]',
          )!;

          // Verify top-most hit-testing (not hidden behind PopoverPopup)
          const unselectedRect = unselectedOption.getBoundingClientRect();
          const hitEl = document.elementFromPoint(
            unselectedRect.left + unselectedRect.width / 2,
            unselectedRect.top + unselectedRect.height / 2,
          );
          expect(hitEl !== null && unselectedOption.contains(hitEl)).toBe(true);

          // Verify WCAG >= 4.5:1 contrast for both unselected and selected items
          const unselectedFg = compositeOver(
            parseColor(getComputedStyle(unselectedOption).color),
            surfaceBg,
          );
          const unselectedContrast = contrastRatio(unselectedFg, surfaceBg);
          expect(
            unselectedContrast,
            `${scenario.name} unselected option contrast (${unselectedContrast.toFixed(2)}:1)`,
          ).toBeGreaterThanOrEqual(4.5);

          const selectedRowBg = compositeOver(
            parseColor(getComputedStyle(selectedOption).backgroundColor),
            surfaceBg,
          );
          const selectedFg = compositeOver(
            parseColor(getComputedStyle(selectedOption).color),
            selectedRowBg,
          );
          const selectedContrast = contrastRatio(selectedFg, selectedRowBg);
          expect(
            selectedContrast,
            `${scenario.name} selected option contrast (${selectedContrast.toFixed(2)}:1)`,
          ).toBeGreaterThanOrEqual(4.5);

          expect(selectedOption.dataset.pmxCollabModelSelected).toBe("true");
          expect(unselectedOption.dataset.pmxCollabModelSelected).toBe("false");

          await screen.unmount();
        } finally {
          for (const [key, prev] of prevProps) {
            if (prev) root.style.setProperty(key, prev);
            else root.style.removeProperty(key);
          }
        }
      }
    } finally {
      root.classList.toggle("dark", prevDark);
      if (prevGlass === null) root.removeAttribute("data-pmx-glass");
      else root.setAttribute("data-pmx-glass", prevGlass);
    }
  });

  it("renders inline [⏱ goal] and [🐝 swarm] visual chips on typing and removes them cleanly", async () => {
    let latestValue = "";
    await using _screen = await render(
      <InteractiveSlashEditorHarness
        onLatestValue={(next) => {
          latestValue = next;
        }}
      />,
    );

    const editor = document.querySelector<HTMLElement>('[data-testid="composer-editor"]')!;
    expect(editor).not.toBeNull();
    await userEvent.click(editor);
    await userEvent.keyboard("/goal /swarm refactor login");

    const goalChip = editor.querySelector<HTMLElement>('[data-composer-slash-command="goal"]');
    const swarmChip = editor.querySelector<HTMLElement>('[data-composer-slash-command="swarm"]');
    expect(goalChip).not.toBeNull();
    expect(swarmChip).not.toBeNull();
    expect(swarmChip!.querySelector('[data-slash-icon="swarm-bee"]')).not.toBeNull();
    expect(latestValue).toBe("/goal /swarm refactor login");

    // Click × on swarm chip -> cleanly removed while preserving canonical /goal text
    const removeSwarm = editor.querySelector<HTMLButtonElement>(
      '[data-testid="composer-slash-chip-remove-swarm"]',
    )!;
    await userEvent.click(removeSwarm);
    expect(editor.querySelector('[data-composer-slash-command="swarm"]')).toBeNull();
    expect(editor.querySelector('[data-composer-slash-command="goal"]')).not.toBeNull();
    expect(latestValue).toBe("/goal refactor login");
  });

  it("renders Light, Dark, and Liquid Glass showcase cleanly with crisp contrast & optional PNG capture", async () => {
    await page.viewport(1280, 820);
    const hadRootDark = document.documentElement.classList.contains("dark");
    document.documentElement.classList.remove("dark");
    try {
      const presetSelections: ReadonlyArray<ComposerCollaboratorSelection> = [
        { providerInstanceId: dshEntry.instanceId, model: "deepseek-reasoner", maxCount: 2 },
        { providerInstanceId: codexEntry.instanceId, model: "gpt-5.4", maxCount: 1 },
      ];

      function ThemeCard({
        title,
        subtitle,
        mode,
        selections = presetSelections,
        popoverOpen = false,
        className = "",
      }: {
        readonly title: string;
        readonly subtitle: string;
        readonly mode: "light" | "dark" | "glass";
        readonly selections?: ReadonlyArray<ComposerCollaboratorSelection>;
        readonly popoverOpen?: boolean;
        readonly className?: string;
      }) {
        const styleVars =
          mode === "light" ? LIGHT_CARD_VARS : mode === "glass" ? GLASS_CARD_VARS : DARK_CARD_VARS;
        const isDark = mode !== "light";

        return (
          <div
            data-theme-card={mode}
            className={`${isDark ? "dark" : ""} rounded-2xl border border-border/70 p-4 text-foreground ${className}`}
            style={styleVars}
          >
            <div
              data-pmx-glass={mode === "glass" ? "1" : "0"}
              className="flex h-full flex-col justify-between"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold tracking-wide text-foreground">{title}</span>
                <span className="text-2xs text-muted-foreground">{subtitle}</span>
              </div>

              <div
                className="mt-auto rounded-3xl border border-border/75 p-1"
                style={
                  mode === "glass"
                    ? {
                        background: "rgba(15, 23, 42, 0.54)",
                        backdropFilter: "blur(18px)",
                      }
                    : mode === "light"
                      ? { background: "#ebedf0" }
                      : { background: "#181a20" }
                }
              >
                <div
                  data-pmx-composer-top-tray="1"
                  className="flex min-w-0 items-center justify-between gap-1 px-2 pb-1.5 pt-0.5 text-xs"
                >
                  <div className="flex items-center gap-1 text-foreground/85">
                    <span className="inline-flex h-6 items-center gap-1.5 rounded-lg px-2 font-medium">
                      <FolderIcon className="size-3.5 opacity-75" />
                      Prismux
                    </span>
                    <span className="inline-flex h-6 items-center gap-1.5 rounded-lg px-2 font-medium">
                      <MonitorIcon className="size-3.5 opacity-75" />
                      ROG-FISH
                    </span>
                  </div>
                  <ComposerCollaboratorsPopoverView
                    providerInstanceEntries={ENTRIES}
                    modelOptionsByInstance={MODEL_OPTIONS}
                    selections={selections}
                    probes={PROBES}
                    waiver={LOCKED_WAIVER}
                    open={popoverOpen}
                    onChangeSelections={() => {}}
                    onOpenWaiverSettings={() => {}}
                    className="ms-auto"
                  />
                </div>

                <div
                  className="rounded-2xl border border-border/75 px-3 py-2.5 text-sm text-foreground"
                  style={{
                    background:
                      mode === "glass"
                        ? "rgba(15, 23, 42, 0.68)"
                        : mode === "dark"
                          ? "#1f222a"
                          : "#ffffff",
                  }}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ComposerSlashCommandChip command="goal" onRemove={() => {}} />
                    <ComposerSlashCommandChip command="swarm" onRemove={() => {}} />
                    <span className="text-foreground">
                      协同审查并完善多智能体任务委派与视觉芯片
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      }

      await using lightScreen = await render(
        <div className="grid h-[800px] grid-cols-12 gap-4 bg-muted/60 p-5">
          <div className="col-span-6 flex flex-col gap-4">
            <ThemeCard
              title="Light Theme · 亮色模式（空闲 0 Token 态）"
              subtitle="Idle Top-Right Trigger"
              mode="light"
              selections={[]}
              className="flex-1"
            />
            <ThemeCard
              title="Light Theme · 亮色模式（已选 协作 · 3 + 内联斜杠芯片）"
              subtitle="Active Accent + Stacked Icons"
              mode="light"
              className="flex-1"
            />
          </div>
          <div className="col-span-6 flex flex-col">
            <ThemeCard
              title="Light Theme · 亮色模式（展开邀请协作浮层 · 多代理/模型/数量/AGY 锁）"
              subtitle="Open Collaborators Popover"
              mode="light"
              popoverOpen={true}
              className="h-full"
            />
          </div>
        </div>,
      );

      const openLightPopover = page.getByTestId("composer-collaborators-popover");
      await expect.element(openLightPopover).toBeVisible();

      const lightCards = Array.from(document.querySelectorAll<HTMLElement>("[data-theme-card]"));
      expect(lightCards).toHaveLength(3);
      for (const card of lightCards) {
        const trigger = card.querySelector<HTMLElement>(
          '[data-testid="composer-collaborators-trigger"]',
        );
        expect(trigger).not.toBeNull();
        expect(trigger!.getBoundingClientRect().height).toBeLessThanOrEqual(28);
        expect(card.querySelector('[data-composer-slash-command="goal"]')).not.toBeNull();
        expect(card.querySelector('[data-slash-icon="swarm-bee"]')).not.toBeNull();
      }

      const lightPopoverEl = document.querySelector<HTMLElement>(
        '[data-testid="composer-collaborators-popover"]',
      )!;
      expect(lightPopoverEl.getBoundingClientRect().width).toBeLessThanOrEqual(340);

      if (import.meta.env.VITE_CAPTURE_COLLAB_SCREENSHOT === "1") {
        await page.screenshot({ path: "w2-collab-invite-light.png" });
      }
      await lightScreen.unmount();

      // Switch root document to real Dark Mode to verify Dark + Liquid Glass natively
      document.documentElement.classList.add("dark");
      await using _darkScreen = await render(
        <div className="grid h-[800px] grid-cols-12 gap-4 bg-background p-5">
          <div className="col-span-6 flex flex-col gap-4">
            <ThemeCard
              title="Dark Theme · 暗色模式（空闲 0 Token 态）"
              subtitle="Idle Top-Right Trigger"
              mode="dark"
              selections={[]}
              className="flex-1"
            />
            <ThemeCard
              title="Liquid Glass · 液态玻璃模式（已选 协作 · 3 + 蜂王芯片）"
              subtitle="Glass Surface + Dynamic Accent"
              mode="glass"
              className="flex-1"
            />
          </div>
          <div className="col-span-6 flex flex-col">
            <ThemeCard
              title="Dark Theme · 暗色模式（展开邀请协作浮层 · 多代理/模型/数量/AGY 锁）"
              subtitle="Open Collaborators Popover"
              mode="dark"
              popoverOpen={true}
              className="h-full"
            />
          </div>
        </div>,
      );

      const openDarkPopover = page.getByTestId("composer-collaborators-popover");
      await expect.element(openDarkPopover).toBeVisible();
      const darkCards = Array.from(document.querySelectorAll<HTMLElement>("[data-theme-card]"));
      expect(darkCards).toHaveLength(3);
      for (const card of darkCards) {
        const trigger = card.querySelector<HTMLElement>(
          '[data-testid="composer-collaborators-trigger"]',
        );
        expect(trigger).not.toBeNull();
        expect(trigger!.getBoundingClientRect().height).toBeLessThanOrEqual(28);
        expect(card.querySelector('[data-composer-slash-command="goal"]')).not.toBeNull();
        expect(card.querySelector('[data-slash-icon="swarm-bee"]')).not.toBeNull();
      }

      if (import.meta.env.VITE_CAPTURE_COLLAB_SCREENSHOT === "1") {
        await page.screenshot({ path: "w2-collab-invite-dark-glass.png" });
      }
    } finally {
      if (hadRootDark) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  });
});
