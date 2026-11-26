import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../rpc/atomRegistry";

export const MAX_FRESH_SESSION_ARMS = 200;
export const FRESH_SESSION_ARM_TTL_MS = 24 * 60 * 60 * 1000;

/** Threads whose next message starts a fresh provider session, keyed by thread, valued by when it was armed. */
const freshSessionArmsAtom = Atom.make<Readonly<Record<string, number>>>({}).pipe(Atom.keepAlive);

export function armFreshSession(threadKey: string, now = Date.now()): void {
  const current = appAtomRegistry.get(freshSessionArmsAtom);
  const cutoff = now - FRESH_SESSION_ARM_TTL_MS;
  const entries = Object.entries(current).filter(
    ([key, armedAt]) => key !== threadKey && armedAt >= cutoff,
  );
  entries.push([threadKey, now]);
  const bounded =
    entries.length > MAX_FRESH_SESSION_ARMS
      ? entries
          .toSorted(([, left], [, right]) => left - right)
          .slice(entries.length - MAX_FRESH_SESSION_ARMS)
      : entries;
  appAtomRegistry.set(freshSessionArmsAtom, Object.fromEntries(bounded));
}

/** With `arm`, clears only that arm, so a send never consumes one made while it was in flight. */
export function disarmFreshSession(threadKey: string, arm?: number): void {
  const current = appAtomRegistry.get(freshSessionArmsAtom);
  if (current[threadKey] === undefined || (arm !== undefined && current[threadKey] !== arm)) return;
  const { [threadKey]: _removed, ...rest } = current;
  appAtomRegistry.set(freshSessionArmsAtom, rest);
}

/** Prunes armed entries that are no longer in `activeThreadKeys` or exceeded the TTL. */
export function pruneFreshSessionArms(
  activeThreadKeys?: ReadonlySet<string>,
  now = Date.now(),
): void {
  const current = appAtomRegistry.get(freshSessionArmsAtom);
  const cutoff = now - FRESH_SESSION_ARM_TTL_MS;
  let changed = false;
  const next: Record<string, number> = {};
  for (const [key, armedAt] of Object.entries(current)) {
    if (armedAt < cutoff || (activeThreadKeys !== undefined && !activeThreadKeys.has(key))) {
      changed = true;
      continue;
    }
    next[key] = armedAt;
  }
  if (changed) {
    appAtomRegistry.set(freshSessionArmsAtom, next);
  }
}

export function readFreshSessionArm(threadKey: string): number | undefined {
  return appAtomRegistry.get(freshSessionArmsAtom)[threadKey];
}

export function useFreshSessionArmed(threadKey: string): boolean {
  return useAtomValue(freshSessionArmsAtom)[threadKey] !== undefined;
}

export const __freshSessionArmsTesting = {
  getArmedCount: () => Object.keys(appAtomRegistry.get(freshSessionArmsAtom)).length,
  resetForTests: () => {
    appAtomRegistry.set(freshSessionArmsAtom, {});
  },
};
