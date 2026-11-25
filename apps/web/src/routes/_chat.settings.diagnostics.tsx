import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/settings/diagnostics")({
  beforeLoad: () => {
    throw redirect({
      to: "/diagnostics",
      replace: true,
    });
  },
  component: () => null,
});
