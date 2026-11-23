import { useEffect, useId, useRef, useState } from "react";
import { useGT } from "gt-react";
import { CheckIcon, CopyIcon, Loader2Icon, TerminalIcon } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { AgentInstallPrompt } from "../settings/AgentInstallPrompt";
import {
  resolveAgentCliMeta,
  resolveSafeAgentHomepageUrl,
} from "../settings/prismuxProviderMeta";
import {
  buildAgentSessionContinuationPrompt,
  buildContinueInTerminalPlan,
  chooseInitialContinuationAgent,
  hasFullAgentSessionContext,
  isContinuationAgentAllowed,
  type AgentSessionContinuationContextMode,
  type AgentSessionContinuationSource,
  type ContinuationAgentCandidate,
  type ContinueInTerminalPlan,
} from "./continueInTerminal.logic";

export interface AgentSessionContinuationDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly source: AgentSessionContinuationSource | null;
  readonly sourceInstanceId?: string | null;
  readonly cwd: string | null;
  readonly candidates: ReadonlyArray<ContinuationAgentCandidate>;
  readonly onLaunchInTerminal: (plan: ContinueInTerminalPlan, prompt: string) => Promise<void> | void;
}

/**
 * Cross-agent session hand-off dialog aligned with stablyai/orca
 * `AgentSessionContinuationDialog.tsx`:
 * - `focused` vs `full` context modes (with cost warning on full transcript)
 * - quota/process-family avoidance filter (`isContinuationAgentAllowed`)
 * - 200ms deferred spinner + `AbortController` / request-token stale-launch guard
 * - inline `AgentInstallPrompt` for uninstalled target CLIs (strict `https:` links)
 * - read-only original session invariant (never kills or modifies the source Chat thread)
 */
export function AgentSessionContinuationDialog({
  open,
  onOpenChange,
  source,
  sourceInstanceId = null,
  cwd,
  candidates,
  onLaunchInTerminal,
}: AgentSessionContinuationDialogProps) {
  const gt = useGT();
  const contextLabelId = useId();
  const abortRef = useRef<AbortController | null>(null);
  const [avoidSourceFamily, setAvoidSourceFamily] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [contextMode, setContextMode] = useState<AgentSessionContinuationContextMode>("focused");
  const [startingToken, setStartingToken] = useState<{ readonly source: AgentSessionContinuationSource } | null>(null);
  const [showStartingSpinner, setShowStartingSpinner] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const starting = open && source !== null && startingToken?.source === source;

  useEffect(() => {
    if (!open) {
      setSelectedInstanceId(null);
      setContextMode("focused");
      setStartingToken(null);
      setCopiedPrompt(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    return () => {
      controller.abort();
    };
  }, [open, source]);

  useEffect(() => {
    if (!starting) {
      setShowStartingSpinner(false);
      return;
    }
    // Aligned with stablyai/orca: defer spinner 200ms so fast local hand-offs never flicker.
    const timer = window.setTimeout(() => setShowStartingSpinner(true), 200);
    return () => window.clearTimeout(timer);
  }, [starting]);

  const sourceCandidate =
    candidates.find((c) => c.instanceId === sourceInstanceId) ??
    (source?.sourceDriver
      ? {
          instanceId: sourceInstanceId ?? source.sourceDriver,
          driver: source.sourceDriver,
          label: source.sourceAgentLabel ?? source.sourceDriver,
          installed: true,
        }
      : null);

  const filteredCandidates = candidates.filter((candidate) =>
    isContinuationAgentAllowed(candidate, sourceCandidate, avoidSourceFamily),
  );

  const onlySourceFamilyAvailable =
    avoidSourceFamily && candidates.length > 0 && filteredCandidates.length === 0;

  const selectedCandidate =
    filteredCandidates.find((c) => c.instanceId === selectedInstanceId) ??
    chooseInitialContinuationAgent({
      availableAgents: filteredCandidates,
      sourceInstanceId: avoidSourceFamily ? null : sourceInstanceId,
    });

  const hasFullContext = source ? hasFullAgentSessionContext(source) : false;
  const promptPreview = source ? buildAgentSessionContinuationPrompt(source, contextMode) : null;

  const targetMeta = selectedCandidate
    ? resolveAgentCliMeta({
        driver: selectedCandidate.driver,
        instanceId: selectedCandidate.instanceId,
        config: selectedCandidate.config,
        displayName: selectedCandidate.label,
      })
    : null;
  const targetHomepageUrl = selectedCandidate
    ? resolveSafeAgentHomepageUrl({
        driver: selectedCandidate.driver,
        instanceId: selectedCandidate.instanceId,
        config: selectedCandidate.config,
        displayName: selectedCandidate.label,
        documentationUrl: selectedCandidate.documentationUrl ?? null,
      })
    : null;

  const targetPlan =
    selectedCandidate && selectedCandidate.installed && cwd
      ? buildContinueInTerminalPlan({
          driver: selectedCandidate.driver,
          instanceId: selectedCandidate.instanceId,
          config: selectedCandidate.config,
          displayName: selectedCandidate.label,
          cwd,
        })
      : null;

  const handleCopyPromptOnly = async () => {
    if (!promptPreview) return;
    try {
      await navigator.clipboard.writeText(promptPreview);
      setCopiedPrompt(true);
      toastManager.add({
        type: "success",
        title: gt("Hand-off prompt copied"),
        description: gt("Paste it into any agent session. Your original Chat thread stays unchanged."),
      });
      window.setTimeout(() => setCopiedPrompt(false), 1600);
    } catch {
      toastManager.add({
        type: "error",
        title: gt("Could not copy hand-off prompt"),
      });
    }
  };

  const handleStartHandOff = async () => {
    if (!source || !targetPlan || !promptPreview || starting) return;
    const token = { source };
    const signal = abortRef.current?.signal;
    setStartingToken(token);
    try {
      try {
        await navigator.clipboard.writeText(promptPreview);
      } catch {
        // Clipboard failure does not block opening the target terminal.
      }
      await onLaunchInTerminal(targetPlan, promptPreview);
      if (!signal?.aborted) {
        onOpenChange(false);
      }
    } finally {
      setStartingToken((current) => (current === token ? null : current));
    }
  };

  const sourceTitle = source?.sourceTitle?.trim() || gt("Current session");
  const sourceAgentLabel = source?.sourceAgentLabel?.trim() || source?.sourceDriver || null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{gt("Hand off to another agent")}</DialogTitle>
          <DialogDescription>
            {sourceAgentLabel
              ? gt("From {agent} · {session} · original stays unchanged", {
                  agent: sourceAgentLabel,
                  session: sourceTitle,
                })
              : gt("{session} · original stays unchanged", { session: sourceTitle })}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="space-y-4">
          {sourceCandidate ? (
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs">
              <span className="text-foreground/90">
                {gt("Avoid agents sharing the same CLI quota with {agent}", {
                  agent: sourceCandidate.label,
                })}
              </span>
              <Switch
                size="sm"
                checked={avoidSourceFamily}
                disabled={starting}
                onCheckedChange={(checked) => setAvoidSourceFamily(Boolean(checked))}
              />
            </label>
          ) : null}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">{gt("Target agent")}</label>
            {onlySourceFamilyAvailable ? (
              <p className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                {gt(
                  "Only agents sharing the usage limit with {agent} are available on this workspace host. Enable or install a different agent.",
                  { agent: sourceAgentLabel ?? "" },
                )}
              </p>
            ) : filteredCandidates.length === 0 ? (
              <p className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                {gt("No enabled agents were detected on this workspace host.")}
              </p>
            ) : (
              <div className="grid max-h-44 gap-1.5 overflow-y-auto pr-0.5 sm:grid-cols-2">
                {filteredCandidates.map((candidate) => {
                  const isSelected = selectedCandidate?.instanceId === candidate.instanceId;
                  return (
                    <button
                      key={candidate.instanceId}
                      type="button"
                      disabled={starting}
                      onClick={() => setSelectedInstanceId(candidate.instanceId)}
                      className={
                        isSelected
                          ? "flex items-center justify-between gap-2 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-left text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          : "flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-left text-xs text-foreground/90 transition-colors hover:bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      }
                    >
                      <span className="truncate">{candidate.label}</span>
                      <Badge
                        variant={candidate.installed ? "success" : "secondary"}
                        size="sm"
                        className="shrink-0 text-2xs"
                      >
                        {candidate.installed ? gt("Installed") : gt("CLI not installed")}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedCandidate && !selectedCandidate.installed ? (
              <div className="pt-1">
                <AgentInstallPrompt
                  compact
                  label={selectedCandidate.label}
                  homepageUrl={targetHomepageUrl}
                  loginHint={targetMeta?.loginHint ?? null}
                />
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label id={contextLabelId} className="text-xs font-medium text-foreground">
              {gt("Context")}
            </label>
            <Select
              disabled={starting}
              value={contextMode}
              onValueChange={(value) => {
                if (value === "focused" || value === "full") {
                  setContextMode(value);
                }
              }}
            >
              <SelectTrigger aria-labelledby={contextLabelId} size="sm" className="w-full">
                <SelectValue>
                  {contextMode === "full"
                    ? gt("Full transcript")
                    : gt("Latest status (recommended)")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="focused">{gt("Latest status (recommended)")}</SelectItem>
                <SelectItem value="full" disabled={!hasFullContext}>
                  {gt("Full transcript")}
                </SelectItem>
              </SelectPopup>
            </Select>
            {contextMode === "full" ? (
              <p className="text-xs text-muted-foreground">
                {gt("Slower, and uses more of your plan or API credits.")}
              </p>
            ) : null}
          </div>
        </DialogPanel>

        <DialogFooter className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!promptPreview || starting}
            onClick={() => void handleCopyPromptOnly()}
          >
            {copiedPrompt ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            <span>{copiedPrompt ? gt("Copied") : gt("Copy hand-off prompt")}</span>
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={starting}
              onClick={() => onOpenChange(false)}
            >
              {gt("Cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!targetPlan || !promptPreview || starting}
              onClick={() => void handleStartHandOff()}
            >
              {showStartingSpinner ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <TerminalIcon className="size-3.5" />
              )}
              <span>
                {starting ? gt("Starting…") : gt("Copy prompt & start in terminal")}
              </span>
            </Button>
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
