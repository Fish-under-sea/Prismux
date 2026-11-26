import type { ModelSelection, ThreadId } from "@prismux/core-contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../rpc/atomRegistry";

export const MAX_DRAFT_FANOUT_SELECTIONS = 256;
export const MAX_DRAFT_SEND_STATES = 256;

// Kept per route so a send in flight, and the multiple-model selections, survive
// ChatView remounting while the user navigates.
const draftFanoutSelectionsByRouteKeyAtom = Atom.make<
  ReadonlyMap<string, ReadonlyArray<ModelSelection>>
>(new Map()).pipe(Atom.keepAlive, Atom.withLabel("chat:draft-fanout-selections"));

export const draftFanoutSelectionsAtom = Atom.family((routeKey: string) =>
  Atom.writable(
    (get) => get(draftFanoutSelectionsByRouteKeyAtom).get(routeKey) ?? null,
    (ctx, value: ReadonlyArray<ModelSelection> | null) => {
      const current = ctx.get(draftFanoutSelectionsByRouteKeyAtom);
      if (value === null) {
        if (!current.has(routeKey)) return;
        const next = new Map(current);
        next.delete(routeKey);
        ctx.set(draftFanoutSelectionsByRouteKeyAtom, next);
        return;
      }
      if (current.get(routeKey) === value) return;
      const next = new Map(current);
      next.delete(routeKey);
      next.set(routeKey, value);
      while (next.size > MAX_DRAFT_FANOUT_SELECTIONS) {
        const oldestKey = next.keys().next().value;
        if (oldestKey === undefined) break;
        next.delete(oldestKey);
      }
      ctx.set(draftFanoutSelectionsByRouteKeyAtom, next);
    },
  ).pipe(Atom.withLabel(`chat:draft-fanout-selection:${routeKey}`)),
);

interface DraftSendStateEntry {
  readonly sendInFlight: { current: boolean };
  readonly uncertainSubmissions: { current: Map<string, ThreadId> };
}

const draftSendStateByRouteKey = new Map<string, DraftSendStateEntry>();

function isDraftSendStateIdle(state: DraftSendStateEntry): boolean {
  return !state.sendInFlight.current && state.uncertainSubmissions.current.size === 0;
}

export function draftSendState(routeKey: string) {
  let state = draftSendStateByRouteKey.get(routeKey);
  if (state) {
    draftSendStateByRouteKey.delete(routeKey);
    draftSendStateByRouteKey.set(routeKey, state);
    return state;
  }
  state = { sendInFlight: { current: false }, uncertainSubmissions: { current: new Map() } };
  draftSendStateByRouteKey.set(routeKey, state);
  if (draftSendStateByRouteKey.size > MAX_DRAFT_SEND_STATES) {
    for (const [candidateKey, candidateState] of draftSendStateByRouteKey) {
      if (draftSendStateByRouteKey.size <= MAX_DRAFT_SEND_STATES) break;
      if (candidateKey === routeKey || !isDraftSendStateIdle(candidateState)) continue;
      draftSendStateByRouteKey.delete(candidateKey);
    }
  }
  return state;
}

export function clearDraftSendState(routeKey: string): void {
  const state = draftSendStateByRouteKey.get(routeKey);
  if (state && isDraftSendStateIdle(state)) {
    draftSendStateByRouteKey.delete(routeKey);
  }
  appAtomRegistry.update(draftFanoutSelectionsByRouteKeyAtom, (current) => {
    if (!current.has(routeKey)) return current;
    const next = new Map(current);
    next.delete(routeKey);
    return next;
  });
}

export const __chatViewSendTesting = {
  getDraftSendStateCount: () => draftSendStateByRouteKey.size,
  hasDraftSendState: (routeKey: string) => draftSendStateByRouteKey.has(routeKey),
  getDraftFanoutSelectionCount: () => appAtomRegistry.get(draftFanoutSelectionsByRouteKeyAtom).size,
  resetForTests: () => {
    draftSendStateByRouteKey.clear();
    appAtomRegistry.set(draftFanoutSelectionsByRouteKeyAtom, new Map());
  },
};
