import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/settings/threads")({
  beforeLoad: ({ location }) => {
    const cleanHash = location.hash.replace(/^#/, "").trim();
    throw redirect({
      to: "/settings/chat",
      search: true,
      hash: cleanHash || "threads",
      replace: true,
    });
  },
  component: () => null,
});
