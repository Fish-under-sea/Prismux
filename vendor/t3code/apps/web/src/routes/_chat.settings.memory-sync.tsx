import { createFileRoute, redirect } from "@tanstack/react-router";

import { resolveLegacyMemorySyncRedirectTarget } from "../components/settings/settingsSearch";

export const Route = createFileRoute("/_chat/settings/memory-sync")({
  beforeLoad: ({ location }) => {
    const target = resolveLegacyMemorySyncRedirectTarget({
      hash: location.hash,
      searchStr: location.searchStr,
    });
    throw redirect({
      to: target.to,
      search: true,
      ...(target.hash ? { hash: target.hash } : {}),
      replace: true,
    });
  },
  component: () => null,
});
