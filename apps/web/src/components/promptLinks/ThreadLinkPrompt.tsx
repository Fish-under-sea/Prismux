import type { ScopedThreadRef } from "@prismux/core-contracts";
import { withoutPromptLinkParams } from "@prismux/core-shared/promptLinks";
import { parseThreadLinkPrompt } from "@prismux/core-shared/promptLinksCopy";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { msg } from "gt-react";
import { useEffect } from "react";

import { m } from "../../i18n/messages";
import { isThreadRoutePathname } from "../../threadRoutes";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { placeLinkedPrompt } from "./linkedPrompt";

export const MAX_HANDLED_LINK_KEYS = 200;

const handledLinkKeys = new Set<string>();

export function markHandledLinkKey(key: string): boolean {
  if (handledLinkKeys.has(key)) {
    handledLinkKeys.delete(key);
    handledLinkKeys.add(key);
    return false;
  }
  handledLinkKeys.add(key);
  while (handledLinkKeys.size > MAX_HANDLED_LINK_KEYS) {
    const oldestKey = handledLinkKeys.values().next().value;
    if (oldestKey === undefined) break;
    handledLinkKeys.delete(oldestKey);
  }
  return true;
}

export const __threadLinkPromptTesting = {
  getHandledLinkKeyCount: () => handledLinkKeys.size,
  hasHandledLinkKey: (key: string) => handledLinkKeys.has(key),
  resetHandledLinkKeysForTests: () => {
    handledLinkKeys.clear();
  },
};

export function ThreadLinkPrompt({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const navigate = useNavigate();
  const location = useLocation({
    select: (current) => ({
      key: current.state.__TSR_key ?? current.href,
      pathname: current.pathname,
      search: current.searchStr,
    }),
    structuralSharing: true,
  });

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- places a ?prompt link into the composer once per location and strips it from the URL via the router
  useEffect(() => {
    // A pending navigation shows the next location while the params still name this thread.
    if (!isThreadRoutePathname(location.pathname, threadRef)) return;
    if (!new URLSearchParams(location.search).has("prompt")) return;
    if (markHandledLinkKey(location.key)) {
      const parsed = parseThreadLinkPrompt(location.search, m);
      if (!parsed.ok) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: m(msg("Could not open the linked prompt")),
            description: parsed.error,
          }),
        );
      } else if (parsed.value !== null) {
        placeLinkedPrompt(threadRef, parsed.value);
      }
    }
    void navigate({
      href: `${location.pathname}${withoutPromptLinkParams(location.search)}`,
      replace: true,
    });
  }, [location, navigate, threadRef]);

  return null;
}
