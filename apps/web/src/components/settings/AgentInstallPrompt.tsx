import { ExternalLinkIcon } from "lucide-react";
import { useGT } from "gt-react";

import { Button } from "../ui/button";
import { openSafeExternalHttpsFromAnchor, validateSafeHttpsUrl } from "./prismuxProviderMeta";

export interface AgentInstallPromptProps {
  readonly label: string;
  readonly homepageUrl: string | null | undefined;
  readonly isLocalHost?: boolean;
  readonly loginHint?: string | null;
  readonly compact?: boolean;
}

/**
 * Reusable missing-CLI install prompt aligned with stablyai/orca `AgentLaunchInstallPrompt.tsx`.
 * Strictly enforces Prismux's `https:`-only external link rule and never silently downloads closed-source CLIs.
 */
export function AgentInstallPrompt({
  label,
  homepageUrl,
  isLocalHost = true,
  loginHint = null,
  compact = false,
}: AgentInstallPromptProps) {
  const gt = useGT();
  const safeUrl = validateSafeHttpsUrl(homepageUrl);

  return (
    <div
      data-slot="agent-install-prompt"
      className={
        compact
          ? "flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-xs text-muted-foreground"
          : "grid gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground"
      }
    >
      <div className="space-y-1">
        <p className="text-foreground/90">
          {isLocalHost
            ? gt("{agent} isn't installed on this machine.", { agent: label })
            : gt("{agent} isn't installed on this host.", { agent: label })}
        </p>
        {loginHint ? (
          <p className="text-2xs text-muted-foreground">
            {gt("After installing, sign in in your terminal with '{command}'.", {
              command: loginHint,
            })}
          </p>
        ) : null}
      </div>
      {safeUrl ? (
        <div>
          <Button
            size="xs"
            variant="outline"
            render={
              <a
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  openSafeExternalHttpsFromAnchor(event);
                }}
              />
            }
          >
            <span>{gt("Install {agent}", { agent: label })}</span>
            <ExternalLinkIcon className="size-3" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
