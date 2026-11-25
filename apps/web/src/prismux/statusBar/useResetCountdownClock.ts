import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Computes the exact milliseconds until the soonest reset countdown label changes.
 * Modeled after Orca `status-bar/usage/useResetCountdownClock.ts` &
 * `shared/agent-usage/rate-limits/rate-limit-reset-format.ts`:
 * - For windows >= 24h away, labels show `Xd Yh`, so ticks align to the next hour boundary.
 * - For windows < 24h away, labels show `Xh Ym` / `Xm`, so ticks align to the next minute boundary.
 * - Returns `null` when no future reset timestamp exists (zero idle timers).
 */
export function getResetCountdownNextTickDelay(
  now: number,
  resetTimes: ReadonlyArray<number | null | undefined>,
): number | null {
  let soonestDelay: number | null = null;
  for (const resetAt of resetTimes) {
    if (typeof resetAt !== "number" || !Number.isFinite(resetAt)) {
      continue;
    }
    const remainingMs = resetAt - now;
    if (remainingMs <= 0) {
      continue;
    }
    const tickUnitMs = remainingMs >= DAY_MS ? HOUR_MS : MINUTE_MS;
    // Schedule 1ms past the boundary where ceil(remainingMs / tickUnitMs) steps down.
    const remainder = remainingMs % tickUnitMs;
    const delay = (remainder === 0 ? tickUnitMs : remainder) + 1;
    if (soonestDelay === null || delay < soonestDelay) {
      soonestDelay = delay;
    }
  }
  return soonestDelay;
}

/**
 * Boundary-scheduled countdown clock for visible usage reset timers.
 * Only schedules a single `setTimeout` for the soonest label boundary while `active` is true,
 * avoiding wasteful fixed-interval polling when popovers are closed or no reset window exists.
 */
export function useResetCountdownClock(
  active: boolean,
  resetTimes: ReadonlyArray<number | null | undefined>,
): number {
  const [now, setNow] = useState<number>(() => Date.now());

  // Stable primitive signature so re-renders with identical timestamps don't reset the timeout.
  const signature = resetTimes
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .join(",");

  useEffect(() => {
    if (!active) {
      return;
    }
    const currentNow = Date.now();
    setNow(currentNow);
  }, [active, signature]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const parsedTimes = signature
      ? signature.split(",").map((entry) => Number(entry))
      : [];
    const delay = getResetCountdownNextTickDelay(now, parsedTimes);
    if (delay === null) {
      return;
    }
    const timeoutId = setTimeout(() => {
      setNow(Date.now());
    }, delay);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [active, now, signature]);

  return now;
}
