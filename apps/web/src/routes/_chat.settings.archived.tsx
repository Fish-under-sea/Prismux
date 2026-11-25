import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/settings/archived")({
  beforeLoad: ({ location }) => {
    const cleanHash = location.hash.replace(/^#/, "").trim();
    throw redirect({
      to: "/settings/projects",
      search: true,
      hash: cleanHash || "archived",
      replace: true,
    });
  },
  component: () => null,
});
