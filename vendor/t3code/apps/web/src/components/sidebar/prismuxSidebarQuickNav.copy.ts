import { useLocale } from "gt-react";

import { getActiveLocale } from "../../i18n/messages";

export interface PrismuxSidebarQuickNavCopy {
  readonly tasks: string;
  readonly workspaceBoard: string;
}

const ZH_COPY: PrismuxSidebarQuickNavCopy = {
  tasks: "任务面板",
  workspaceBoard: "工作区板",
};

const EN_COPY: PrismuxSidebarQuickNavCopy = {
  tasks: "Tasks",
  workspaceBoard: "Workspace board",
};

export function getPrismuxSidebarQuickNavCopy(
  locale: string | null | undefined,
): PrismuxSidebarQuickNavCopy {
  const normalized = (locale ?? getActiveLocale() ?? "en").toLowerCase();
  return normalized.startsWith("zh") ? ZH_COPY : EN_COPY;
}

export function usePrismuxSidebarQuickNavCopy(): PrismuxSidebarQuickNavCopy {
  const locale = useLocale();
  return getPrismuxSidebarQuickNavCopy(locale);
}
