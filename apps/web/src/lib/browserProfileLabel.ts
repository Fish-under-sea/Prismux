import {
  DEFAULT_BROWSER_PROFILE_ID,
  INCOGNITO_BROWSER_PROFILE_ID,
} from "@prismux/core-contracts";

import { getActiveLocale } from "../i18n/messages";

export interface BrowserProfileLabelInput {
  readonly id: string;
  readonly name?: string | null | undefined;
}

function isChineseLocale(locale?: string | null): boolean {
  const effective = (locale ?? getActiveLocale() ?? "en").toLowerCase();
  return effective.startsWith("zh");
}

/** Formats a browser profile label for the active locale while keeping custom names verbatim. */
export function formatBrowserProfileLabel(
  profile: BrowserProfileLabelInput,
  locale?: string | null,
): string {
  const rawName = profile.name?.trim() ?? "";
  const zh = isChineseLocale(locale);

  if (profile.id === DEFAULT_BROWSER_PROFILE_ID) {
    if (rawName.length === 0 || rawName.toLowerCase() === "default") {
      // oxlint-disable-next-line prismux/no-untranslated-copy -- built-in default profile label localized explicitly by locale argument
      return zh ? "默认配置" : "Default";
    }
    return rawName;
  }

  if (profile.id === INCOGNITO_BROWSER_PROFILE_ID) {
    if (rawName.length === 0 || rawName.toLowerCase() === "incognito") {
      // oxlint-disable-next-line prismux/no-untranslated-copy -- built-in incognito profile label localized explicitly by locale argument
      return zh ? "无痕模式" : "Incognito";
    }
    return rawName;
  }

  return rawName || profile.id;
}

/**
 * Resolves the compact badge label shown on browser tabs running in a non-default profile
 * (such as Incognito or a custom persistent profile). Returns `null` for the default profile.
 */
export function resolveBrowserProfileBadgeLabel(
  profileId: string | undefined,
  profiles: ReadonlyArray<BrowserProfileLabelInput>,
  locale?: string | null,
): string | null {
  if (!profileId || profileId === DEFAULT_BROWSER_PROFILE_ID) {
    return null;
  }
  const matched = profiles.find((profile) => profile.id === profileId);
  return formatBrowserProfileLabel(
    matched ?? {
      id: profileId,
      name: profileId === INCOGNITO_BROWSER_PROFILE_ID ? "Incognito" : profileId,
    },
    locale,
  );
}
