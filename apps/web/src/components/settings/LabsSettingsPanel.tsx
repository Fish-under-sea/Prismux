import { Link } from "@tanstack/react-router";
import { T, useGT } from "gt-react";

import { Button } from "../ui/button";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

/**
 * Legacy /settings/labs fallback. Active local features have been promoted to their
 * owning pages (Chat, Worktrees, Environments), and /settings/labs redirects in _chat.settings.tsx.
 */
export function LabsSettingsPanel() {
  const gt = useGT();
  return (
    <SettingsPageContainer>
      <SettingsSection id="beta" title={gt("Graduated features")}>
        <SettingsRow
          title={gt("Suggest next prompt")}
          description={gt("Prompt suggestions are now configured in Chat settings.")}
          control={
            <Button size="sm" variant="outline" render={<Link to="/settings/chat" />}>
              <T>Open Chat settings</T>
            </Button>
          }
        />
        <SettingsRow
          title={gt("Fast worktree checkout")}
          description={gt("Fast worktree checkout is now configured in Worktrees settings.")}
          control={
            <Button size="sm" variant="outline" render={<Link to="/settings/worktrees" />}>
              <T>Open Worktrees settings</T>
            </Button>
          }
        />
        <SettingsRow
          title={gt("Linked environments")}
          description={gt("Multi-environment linking is now configured in Environments settings.")}
          control={
            <Button size="sm" variant="outline" render={<Link to="/settings/connections" />}>
              <T>Open Environments settings</T>
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
