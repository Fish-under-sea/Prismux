import { createFileRoute, redirect } from "@tanstack/react-router";

import { validateScheduledTasksSearch } from "../components/settings/scheduledTasksSettings.logic";

export const Route = createFileRoute("/_chat/settings/automations")({
  validateSearch: validateScheduledTasksSearch,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/scheduled-tasks",
      search: {
        ...(search.taskId ? { taskId: search.taskId } : {}),
        ...(search.environmentId ? { environmentId: search.environmentId } : {}),
      },
      replace: true,
    });
  },
  component: () => null,
});
