import { toServerClock } from "@prismux/client-runtime/clock";
import type { EnvironmentId } from "@prismux/core-contracts";
import { formatDuration } from "@prismux/core-shared/orchestrationTimingCopy";
import { msg } from "gt-react";
import { m } from "~/i18n/messages";

export function formatWorkingTimerNow(
  startIso: string,
  environmentId: EnvironmentId,
  locale?: string,
): string {
  const isZh = locale === undefined ? false : locale.toLowerCase().startsWith("zh");
  const startedAtMs = Date.parse(startIso);
  if (!Number.isFinite(startedAtMs)) {
    return isZh ? "0秒" : m(msg("{seconds}s", { seconds: 0 }));
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((toServerClock(environmentId, Date.now()) - startedAtMs) / 1000),
  );
  if (isZh) {
    if (elapsedSeconds < 60) {
      return `${elapsedSeconds}秒`;
    }
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    if (minutes < 60) {
      return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分`;
    }
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return remMinutes > 0 ? `${hours}小时${remMinutes}分` : `${hours}小时`;
  }

  if (elapsedSeconds < 60) {
    return m(msg("{seconds}s", { seconds: elapsedSeconds }));
  }

  return formatDuration(elapsedSeconds * 1_000, m);
}
