import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  ExternalLinkIcon,
  PaletteIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";

import { openSafeExternalHttpsFromAnchor } from "../../../components/settings/prismuxProviderMeta";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import {
  createBackdropDismissGuardState,
  recordBackdropPointerDown,
  shouldDismissOnBackdropClick,
} from "../../../components/ui/dialog-styles";
import { Textarea } from "../../../components/ui/textarea";
import { cn } from "../../../lib/utils";

export const PLUGIN_DEVELOPMENT_GUIDE_REPO_PATH = "docs/plugins/plugin-development-guide.md";
export const PLUGIN_HOOKS_AND_THEME_REPO_PATH = "docs/plugins/official-hooks-and-theme-tokens.md";

export const PLUGIN_DEVELOPMENT_GUIDE_URL =
  "https://github.com/Fish-under-sea/Prismux/blob/main/docs/plugins/plugin-development-guide.md";
export const PLUGIN_HOOKS_AND_THEME_URL =
  "https://github.com/Fish-under-sea/Prismux/blob/main/docs/plugins/official-hooks-and-theme-tokens.md";

export const PLUGIN_REQUIREMENT_PLACEHOLDER_BLOCK =
  "【我的插件创作需求】\n（请在此替换为你想实现的功能、交互与配置项）";

export interface PluginCreatorDocLink {
  readonly id: "dev-guide" | "hooks-theme";
  readonly title: string;
  readonly subtitle: string;
  readonly repoPath: string;
  readonly url: string;
  readonly badge: string;
}

export const PLUGIN_CREATOR_DOC_LINKS: readonly PluginCreatorDocLink[] = [
  {
    id: "dev-guide",
    title: "《Prismux 插件创作完全指南》",
    subtitle: "Cordis 双域内核、engines.prismux、ctx.effect() 零残留、声明式 UI、0600 凭据与打包发布",
    repoPath: PLUGIN_DEVELOPMENT_GUIDE_REPO_PATH,
    url: PLUGIN_DEVELOPMENT_GUIDE_URL,
    badge: "创作指南",
  },
  {
    id: "hooks-theme",
    title: "《官方 Hook 钩子与主题样式参考》",
    subtitle: "6 大生命周期 Hook、退出码 2 拦截、浅色 / 深色 / 6 分区液态玻璃 CSS 变量与对比度规范",
    repoPath: PLUGIN_HOOKS_AND_THEME_REPO_PATH,
    url: PLUGIN_HOOKS_AND_THEME_URL,
    badge: "Hook & 样式",
  },
] as const;

/**
 * Generates a self-contained, source-accurate prompt ready to paste into any
 * Coding Agent (Codex / Claude Code / Antigravity / OpenCode / OMP).
 */
export function buildPluginCreatorAgentPrompt(userRequirement: string): string {
  const trimmed = userRequirement.trim();
  const requirementSection =
    trimmed.length > 0
      ? `【我的插件创作需求】\n${trimmed}`
      : PLUGIN_REQUIREMENT_PLACEHOLDER_BLOCK;

  return [
    "请为 Prismux 开发一个符合官方规范、可直接打包导入的高质量插件。动手前请先通读以下两份官方文档（若当前在 Prismux 仓库内可直接读取对应相对路径，否则请联网查阅 GitHub 文档）：",
    "",
    `1. 插件创作完全指南：${PLUGIN_DEVELOPMENT_GUIDE_URL}（仓库路径：${PLUGIN_DEVELOPMENT_GUIDE_REPO_PATH}）`,
    `2. 官方 Hook 钩子与浅色 / 深色 / 液态玻璃主题样式参考：${PLUGIN_HOOKS_AND_THEME_URL}（仓库路径：${PLUGIN_HOOKS_AND_THEME_REPO_PATH}）`,
    "",
    "必须严格遵守的 Prismux 插件工程契约：",
    '- 模块与版本兼容：package.json 必须设置 `"type": "module"`，并在顶层声明 `"engines": { "prismux": ">=0.1.0-0 <2.0.0" }`（严禁回退 peerDependencies）；社区插件包名使用 `prismux-plugin-<name>`，保持零外部运行时依赖（仅用 `node:*` 内置模块或打包至 `dist/`），严禁声明 `preinstall` / `install` / `postinstall` / `prepare` 安装脚本。',
    '- 清单与 0 Token 纯净：`plugin.manifest.json` 必填 `id`、`version`、非空 `realms`（`"daemon"` / `"ui"`）、`permissions` 与 `modelVisible`；非模型工具类插件默认 `"modelVisible": false`，严禁向大模型注入无关 Tool Schema 或 System Prompt；敏感密钥一律通过 `ctx.credentials` 读写独立 `0600` 加密凭据仓。',
    "- Cordis 可逆生命周期与零残留：通过 `apply(ctx)` 注册路由（`/plugins/<id>/*`）、钩子与定时器，并将全部自定义连接/监听/缓存清理回调登记到 `ctx.effect()`，确保停用、卸载或异常回滚时 LIFO 零残留释放；服从 `distribution: \"managed\"` 单写锁，不实现运行期热自更。",
    "- 官方 6 大生命周期 Hook：仅使用 `LifecycleHookBus` 真实事件名 `SessionStart`、`PreToolUse`、`PostToolUse`、`Notification`、`SubagentStop`、`Stop`（不存在 `SessionEnd`）；遵循退出码 `2` 拦截回传与安全钩子默认 `onFailure: \"block\"` 原则。",
    '- UI 与三态液态玻璃主题适配：UI 域优先使用受限声明式组件协议 `ui: "components"`（仅限 `Stack` / `Card` / `Text` / `Badge` / `Button` / `Switch` / `Input` / `Table` 8 原语，零原始 HTML/SVG/脚本注入）；若编写受管样式，必须基于宿主真实属性 `html[data-pmx-theme="light" | "dark"]`、`html[data-pmx-mode]`、`html[data-pmx-glass="0" | "1"]`、`html[data-pmx-gpu]` 与 `--pmx-*` / 语义变量（`--pmx-accent`、`--pmx-text-color`、`--pmx-muted-color`、`--pmx-glass-zone-*-bg`、`--foreground`、`--muted-foreground`、`--border`），禁止硬编码 `bg-black` / `bg-white` / `text-white` 或 `@media (prefers-color-scheme)`，保证 ≥ 4.5:1 对比度与无 GPU / 降透明 / 高对比度兜底。',
    "- 交付与打包自检：提供完整源码、单测与构建命令；使用 `pnpm plugin:pack -- --plugin <dir>` 生成确定性 `.wb-plugin` 与 `.sha256` 并通过 `gunzipSync` 回环校验，便于在 Prismux 插件中心直接导入验证。",
    "",
    requirementSection,
  ].join("\n");
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback to execCommand below.
    }
  }
  if (typeof document === "undefined") {
    return false;
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export interface PluginCreatorGuideModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Optional initial requirement text (useful for tests or deep links). */
  readonly initialRequirement?: string;
  /** Optional clipboard override for deterministic testing. */
  readonly onCopyText?: (text: string) => Promise<boolean> | boolean;
}

/**
 * Centered Liquid Glass Plugin Creator Guide Modal:
 * - Two official documentation link cards (Plugin Development Guide + Hooks & Theme Tokens)
 * - Optional requirement input that dynamically injects into a curated Coding Agent prompt
 * - Expandable scrollable prompt preview + one-click copy button with confirmation feedback
 * - Dismissible via outside backdrop click or Escape key across Light / Dark / Liquid Glass
 */
export function PluginCreatorGuideModal({
  open,
  onClose,
  initialRequirement = "",
  onCopyText,
}: PluginCreatorGuideModalProps) {
  const titleId = useId();
  const descId = useId();
  const reqInputId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const backdropGuardRef = useRef(createBackdropDismissGuardState());
  const copyTimerRef = useRef<number | null>(null);

  const [entered, setEntered] = useState(false);
  const [requirement, setRequirement] = useState(initialRequirement);
  const [previewExpanded, setPreviewExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const generatedPrompt = useMemo(
    () => buildPluginCreatorAgentPrompt(requirement),
    [requirement],
  );

  useEffect(() => {
    setRequirement(initialRequirement);
  }, [initialRequirement]);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      setCopied(false);
      setCopyError(null);
      return;
    }
    const raf = window.requestAnimationFrame(() => setEntered(true));
    modalRef.current?.focus();
    return () => window.cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null && typeof window !== "undefined") {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, open]);

  const handleCopyPrompt = useCallback(async () => {
    setCopyError(null);
    const ok = onCopyText
      ? await onCopyText(generatedPrompt)
      : await copyTextToClipboard(generatedPrompt);
    if (!ok) {
      setCopyError("无法访问系统剪贴板，请展开下方预览框手动全选复制。");
      return;
    }
    setCopied(true);
    if (typeof window !== "undefined") {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 2000);
    }
  }, [generatedPrompt, onCopyText]);

  if (!open) {
    return null;
  }

  const portalHost = typeof document !== "undefined" ? document.body : null;

  const modalNode = (
    <div
      data-slot="plugin-creator-guide-backdrop"
      data-testid="plugin-creator-guide-backdrop"
      data-portal-layer="plugin-creator-guide-modal"
      className={cn(
        "fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs transition-opacity duration-200 [-webkit-app-region:no-drag] motion-reduce:transition-none",
        entered ? "opacity-100" : "opacity-0",
      )}
      onPointerDownCapture={(event) => {
        recordBackdropPointerDown(backdropGuardRef.current, event, modalRef.current);
      }}
      onClick={(event) => {
        if (shouldDismissOnBackdropClick(backdropGuardRef.current, event, modalRef.current)) {
          onClose();
        }
      }}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-pmx-glass-zone="overlays"
        data-testid="plugin-creator-guide-modal"
        className={cn(
          "dialog-glass relative flex max-h-[min(86dvh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border text-popover-foreground shadow-2xl/50 outline-none transition-[opacity,transform] duration-200 ease-out [-webkit-app-region:no-drag] motion-reduce:transition-none",
          entered ? "scale-100 opacity-100" : "scale-[0.975] opacity-0",
        )}
      >
        {/* Header */}
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/60 px-5 pt-4 pb-3.5">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/25"
              >
                <SparklesIcon className="size-4" />
              </span>
              <h2 id={titleId} className="text-base font-semibold tracking-tight text-foreground">
                Prismux 插件创作指引
              </h2>
              <Badge variant="info" size="sm">
                文档 + Agent 提示词
              </Badge>
            </div>
            <p id={descId} className="text-xs leading-relaxed text-muted-foreground">
              查阅官方源码级开发规范，或一键复制预置工程契约提示词直接交给 Coding Agent 自动创作合规插件。
            </p>
          </div>

          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="关闭创作指引弹窗"
            data-testid="plugin-creator-guide-close"
            onClick={onClose}
            className="shrink-0"
          >
            <XIcon className="size-4" />
          </Button>
        </header>

        {/* Scrollable Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4 text-xs">
          {/* Official Docs Links */}
          <section className="space-y-2" aria-label="官方文档链接">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-foreground">官方权威文档</h3>
              <span className="text-[11px] text-muted-foreground">点击在系统浏览器中打开</span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {PLUGIN_CREATOR_DOC_LINKS.map((doc) => {
                const Icon = doc.id === "dev-guide" ? BookOpenIcon : PaletteIcon;
                return (
                  <a
                    key={doc.id}
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`plugin-doc-link-${doc.id}`}
                    onClick={(event) => {
                      openSafeExternalHttpsFromAnchor(event);
                    }}
                    className="group flex flex-col justify-between gap-2.5 rounded-xl border border-border/60 bg-foreground/[0.025] p-3.5 text-left transition-all hover:border-primary/45 hover:bg-foreground/[0.045] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:bg-white/[0.035] dark:hover:bg-white/[0.06]"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                            <Icon className="size-3.5" aria-hidden="true" />
                          </span>
                          <span className="truncate text-xs font-semibold text-foreground group-hover:text-primary">
                            {doc.title}
                          </span>
                        </div>
                        <ExternalLinkIcon
                          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary"
                          aria-hidden="true"
                        />
                      </div>
                      <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                        {doc.subtitle}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <code className="truncate rounded bg-foreground/[0.05] px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground dark:bg-white/[0.06]">
                        {doc.repoPath}
                      </code>
                      <Badge variant="outline" size="sm">
                        {doc.badge}
                      </Badge>
                    </div>
                  </a>
                );
              })}
            </div>
          </section>

          {/* Coding Agent Prompt Generator */}
          <section className="space-y-3 rounded-xl border border-border/60 bg-foreground/[0.025] p-3.5 dark:bg-white/[0.03]">
            <div className="space-y-0.5">
              <h3 className="text-xs font-semibold text-foreground">
                一键复制给 Coding Agent 的创作提示词
              </h3>
              <p className="text-[11px] text-muted-foreground">
                已内嵌两份文档地址、Cordis 零残留、官方 6 大 Hook 与浅/深/玻璃样式规范，适配 Codex / Claude Code / Antigravity 等代理。
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor={reqInputId}
                className="block text-[11.5px] font-medium text-foreground"
              >
                补充你想创作的插件需求（可选；留空时复制内容会自动保留需求填写占位框）
              </label>
              <Textarea
                id={reqInputId}
                size="sm"
                rows={3}
                data-testid="plugin-creator-requirement-input"
                placeholder="例如：我想开发一个飞书通知插件，监听 Stop 与 Notification 钩子，将任务摘要推送到飞书机器人 Webhook，并提供声明式开关与地址配置面板…"
                value={requirement}
                onChange={(event) => setRequirement(event.target.value)}
                className="text-xs"
              />
            </div>

            {/* Expandable & Scrollable Prompt Preview */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  data-testid="plugin-creator-preview-toggle"
                  aria-expanded={previewExpanded}
                  onClick={() => setPreviewExpanded((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {previewExpanded ? (
                    <ChevronUpIcon className="size-3.5" aria-hidden="true" />
                  ) : (
                    <ChevronDownIcon className="size-3.5" aria-hidden="true" />
                  )}
                  <span>{previewExpanded ? "收起提示词预览" : "展开提示词预览"}</span>
                </button>
                <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
                  {generatedPrompt.length} 字符
                </span>
              </div>

              {previewExpanded ? (
                <pre
                  data-testid="plugin-creator-prompt-preview"
                  tabIndex={0}
                  aria-label="预置 Agent 创作提示词预览"
                  className="max-h-44 overflow-y-auto rounded-lg border border-border/60 bg-foreground/[0.035] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/90 outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-white/[0.04]"
                >
                  {generatedPrompt}
                </pre>
              ) : null}
            </div>

            {copyError ? (
              <p role="alert" className="text-[11px] text-destructive">
                {copyError}
              </p>
            ) : null}
          </section>
        </div>

        {/* Footer */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-foreground/[0.02] px-5 py-3 dark:bg-white/[0.025]">
          <span className="text-[11px] text-muted-foreground">
            打包后可在「导入本地 .wb-plugin」中直接验签试装。
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              关闭
            </Button>
            <Button
              type="button"
              size="sm"
              variant="default"
              data-testid="plugin-creator-copy-btn"
              onClick={() => {
                void handleCopyPrompt();
              }}
            >
              {copied ? (
                <>
                  <CheckIcon className="size-3.5" aria-hidden="true" />
                  已复制
                </>
              ) : (
                <>
                  <CopyIcon className="size-3.5" aria-hidden="true" />
                  复制 Agent 提示词
                </>
              )}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );

  return portalHost ? createPortal(modalNode, portalHost) : modalNode;
}
