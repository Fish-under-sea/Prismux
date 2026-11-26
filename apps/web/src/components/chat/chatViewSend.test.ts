import { ProviderInstanceId, ThreadId } from "@prismux/core-contracts";
import { createModelSelection } from "@prismux/core-shared/model";
import { AtomRegistry } from "effect/reactivity";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import {
  __chatViewSendTesting,
  clearDraftSendState,
  draftFanoutSelectionsAtom,
  draftSendState,
  MAX_DRAFT_FANOUT_SELECTIONS,
  MAX_DRAFT_SEND_STATES,
} from "./chatViewSend";

const makeSelection = (model: string) =>
  createModelSelection(ProviderInstanceId.make("codex"), model);

describe("chatViewSend bounded state and cleanup", () => {
  beforeEach(() => {
    __chatViewSendTesting.resetForTests();
  });

  it("evicts derived draftFanoutSelectionsAtom nodes after unsubscribe and bounds stored selections", () => {
    const probeAtom = draftFanoutSelectionsAtom("route-probe");
    const scheduledTasks = new Set<() => void>();
    const probeRegistry = AtomRegistry.make({
      scheduleTask: (task) => {
        scheduledTasks.add(task);
        return () => {
          scheduledTasks.delete(task);
        };
      },
    });
    try {
      const unsubscribe = probeRegistry.subscribe(probeAtom, () => {});
      expect(probeRegistry.getNodes().has(probeAtom)).toBe(true);
      unsubscribe();
      for (const task of scheduledTasks) {
        scheduledTasks.delete(task);
        task();
      }
      expect(probeRegistry.getNodes().has(probeAtom)).toBe(false);
    } finally {
      probeRegistry.dispose();
    }

    appAtomRegistry.set(probeAtom, [makeSelection("gpt-5")]);
    expect(appAtomRegistry.get(probeAtom)?.map((entry) => entry.model)).toEqual(["gpt-5"]);
    expect(__chatViewSendTesting.getDraftFanoutSelectionCount()).toBe(1);

    clearDraftSendState("route-probe");
    expect(appAtomRegistry.get(probeAtom)).toBeNull();
    expect(__chatViewSendTesting.getDraftFanoutSelectionCount()).toBe(0);

    for (let i = 0; i < MAX_DRAFT_FANOUT_SELECTIONS + 15; i += 1) {
      appAtomRegistry.set(draftFanoutSelectionsAtom(`route-${i}`), [makeSelection(`model-${i}`)]);
    }
    expect(__chatViewSendTesting.getDraftFanoutSelectionCount()).toBe(MAX_DRAFT_FANOUT_SELECTIONS);
    expect(appAtomRegistry.get(draftFanoutSelectionsAtom("route-0"))).toBeNull();
    expect(
      appAtomRegistry.get(draftFanoutSelectionsAtom(`route-${MAX_DRAFT_FANOUT_SELECTIONS + 14}`)),
    ).toEqual([makeSelection(`model-${MAX_DRAFT_FANOUT_SELECTIONS + 14}`)]);
  });

  it("clears idle draftSendState entries and preserves in-flight or uncertain entries", () => {
    const idleKey = "route-idle";
    const inFlightKey = "route-in-flight";
    const uncertainKey = "route-uncertain";

    draftSendState(idleKey);
    const inFlight = draftSendState(inFlightKey);
    inFlight.sendInFlight.current = true;
    const uncertain = draftSendState(uncertainKey);
    uncertain.uncertainSubmissions.current.set("retry-1", ThreadId.make("thread-1"));

    clearDraftSendState(idleKey);
    clearDraftSendState(inFlightKey);
    clearDraftSendState(uncertainKey);

    expect(__chatViewSendTesting.hasDraftSendState(idleKey)).toBe(false);
    expect(__chatViewSendTesting.hasDraftSendState(inFlightKey)).toBe(true);
    expect(__chatViewSendTesting.hasDraftSendState(uncertainKey)).toBe(true);

    // Once cleared of in-flight / uncertain flags, clearDraftSendState removes them.
    inFlight.sendInFlight.current = false;
    uncertain.uncertainSubmissions.current.clear();
    clearDraftSendState(inFlightKey);
    clearDraftSendState(uncertainKey);
    expect(__chatViewSendTesting.hasDraftSendState(inFlightKey)).toBe(false);
    expect(__chatViewSendTesting.hasDraftSendState(uncertainKey)).toBe(false);
  });

  it("bounds idle draftSendState entries by LRU without evicting active in-flight routes", () => {
    const busy = draftSendState("route-busy");
    busy.sendInFlight.current = true;

    for (let i = 0; i < MAX_DRAFT_SEND_STATES + 10; i += 1) {
      draftSendState(`route-${i}`);
    }

    expect(__chatViewSendTesting.getDraftSendStateCount()).toBe(MAX_DRAFT_SEND_STATES);
    expect(__chatViewSendTesting.hasDraftSendState("route-busy")).toBe(true);
    expect(__chatViewSendTesting.hasDraftSendState("route-0")).toBe(false);
    expect(__chatViewSendTesting.hasDraftSendState(`route-${MAX_DRAFT_SEND_STATES + 9}`)).toBe(
      true,
    );
  });
});
