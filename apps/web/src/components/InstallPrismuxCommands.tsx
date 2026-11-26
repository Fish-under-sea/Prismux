import { T } from "gt-react";
import { cn } from "~/lib/utils";

import { CommandBlock } from "./CommandBlock";

/**
 * Setup steps for another computer: install `prismux`, then run `command`. Both installers are
 * shown because the browser showing this is often not the computer being set up.
 */
export function InstallPrismuxCommands({
  command,
  className,
}: {
  readonly command: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-xs text-muted-foreground">macOS, Linux</p>
      <CommandBlock command="npm install -g @prismux/daemon" />
      <p className="text-xs text-muted-foreground">Windows (PowerShell)</p>
      <CommandBlock command="npm install -g @prismux/daemon" />
      <p className="text-xs text-muted-foreground">
        <T>Then</T>
      </p>
      <CommandBlock command={command} />
      <p className="text-xs text-muted-foreground">
        <T>
          Skip the install if you already have <code className="font-mono">prismux</code>. If{" "}
          <code className="font-mono">prismux</code> is not found after installing, add your global
          npm bin folder to your PATH.
        </T>
      </p>
    </div>
  );
}
