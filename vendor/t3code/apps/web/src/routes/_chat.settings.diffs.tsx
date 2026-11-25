import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/settings/diffs")({
  beforeLoad: ({ location }) => {
    const cleanHash = location.hash.replace(/^#/, "").trim();
    throw redirect({
      to: "/settings/source-control",
      search: true,
      hash: cleanHash || "diffs",
      replace: true,
    });
  },
  component: () => null,
});
