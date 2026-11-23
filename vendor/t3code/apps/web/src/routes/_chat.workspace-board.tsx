import { createFileRoute } from "@tanstack/react-router";

import { WorkspaceBoardPage } from "../components/workspaceBoard/WorkspaceBoardPage";

export const Route = createFileRoute("/_chat/workspace-board")({
  component: WorkspaceBoardPage,
});
