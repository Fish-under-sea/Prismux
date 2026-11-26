import type { EnvironmentId } from "@prismux/core-contracts";
import * as Effect from "effect/Effect";
import * as PartitionedSemaphore from "effect/PartitionedSemaphore";
import { Atom, type AtomRegistry } from "effect/reactivity";

import { safeErrorLogAttributes } from "../errors/safeLog.ts";
import * as Persistence from "../platform/persistence.ts";

export interface VcsRefsInvalidationTarget {
  readonly environmentId: EnvironmentId;
}

export interface CachedVcsRefsInvalidationTarget extends VcsRefsInvalidationTarget {
  readonly cwd: string;
}

export interface VcsRefsCacheState {
  readonly revision: number;
  readonly persistedCacheReadable: boolean;
}

export const MAX_VCS_REFS_DIGESTS = 256;
const MAX_VCS_REFS_CACHE_ENVIRONMENTS = 256;

const DEFAULT_VCS_REFS_CACHE_STATE: VcsRefsCacheState = Object.freeze({
  revision: 0,
  persistedCacheReadable: true,
});

const vcsRefsCacheStatesByEnvironmentAtom = Atom.make<
  ReadonlyMap<EnvironmentId, VcsRefsCacheState>
>(new Map()).pipe(Atom.keepAlive, Atom.withLabel("environment-data:vcs:list-refs-states"));

const stateByEnvironment = Atom.family((environmentId: EnvironmentId) =>
  Atom.writable(
    (get) =>
      get(vcsRefsCacheStatesByEnvironmentAtom).get(environmentId) ?? DEFAULT_VCS_REFS_CACHE_STATE,
    (ctx, nextState: VcsRefsCacheState) => {
      const current = ctx.get(vcsRefsCacheStatesByEnvironmentAtom);
      if (current.get(environmentId) === nextState) return;
      const next = new Map(current);
      next.delete(environmentId);
      next.set(environmentId, nextState);
      while (next.size > MAX_VCS_REFS_CACHE_ENVIRONMENTS) {
        const oldestKey = next.keys().next().value;
        if (oldestKey === undefined) break;
        next.delete(oldestKey);
      }
      ctx.set(vcsRefsCacheStatesByEnvironmentAtom, next);
    },
  ).pipe(Atom.withLabel(`environment-data:vcs:list-refs-state:${environmentId}`)),
);
const persistenceLock = PartitionedSemaphore.makeUnsafe<EnvironmentId>({ permits: 1 });

export function vcsRefsCacheStateAtom(target: VcsRefsInvalidationTarget) {
  return stateByEnvironment(target.environmentId);
}

export function invalidateVcsRefs(
  registry: AtomRegistry.AtomRegistry,
  target: VcsRefsInvalidationTarget,
  persistedCacheReadable?: boolean,
): void {
  registry.update(vcsRefsCacheStateAtom(target), (state) => ({
    revision: state.revision + 1,
    persistedCacheReadable: persistedCacheReadable ?? state.persistedCacheReadable,
  }));
}

export function withVcsRefsPersistenceLock<A, E, R>(
  environmentId: EnvironmentId,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return persistenceLock.withPermit(environmentId)(effect);
}

/**
 * Clearing first prevents the restarted stream from rehydrating the invalidated
 * snapshot. A refresh that wins the lock is cleared afterward; one that loses
 * observes the new revision and cannot repersist its pre-mutation result.
 */
export const invalidateCachedVcsRefs = Effect.fn("VcsRefsState.invalidateCached")(function* (
  registry: AtomRegistry.AtomRegistry,
  target: CachedVcsRefsInvalidationTarget,
) {
  const cache = yield* Persistence.EnvironmentCacheStore;
  yield* withVcsRefsPersistenceLock(
    target.environmentId,
    Effect.gen(function* () {
      const persistedCacheReadable = yield* cache.clearVcsRefs(target.environmentId).pipe(
        Effect.as(true),
        Effect.catch((error) =>
          Effect.logWarning("Could not remove invalidated cached Git refs.").pipe(
            Effect.annotateLogs({
              environmentId: target.environmentId,
              cwd: target.cwd,
              ...safeErrorLogAttributes(error),
            }),
            Effect.as(false),
          ),
        ),
      );
      invalidateVcsRefs(registry, target, persistedCacheReadable);
    }),
  );
});

// Ref digests from each cwd's last status refresh; the cached branch list is at least that new.
const refsDigestsAtom = Atom.make<ReadonlyMap<string, string>>(new Map()).pipe(
  Atom.keepAlive,
  Atom.withLabel("environment-data:vcs:refs-digests"),
);

function refsDigestKey(target: CachedVcsRefsInvalidationTarget): string {
  return `${target.environmentId.length}:${target.environmentId}${target.cwd}`;
}

/** Skips the branch list reload when a status refresh saw the same refs as the last one. */
export const invalidateCachedVcsRefsIfChanged = Effect.fn("VcsRefsState.invalidateCachedIfChanged")(
  function* (
    registry: AtomRegistry.AtomRegistry,
    target: CachedVcsRefsInvalidationTarget,
    refsDigest: string | undefined,
  ) {
    const key = refsDigestKey(target);
    const currentDigests = registry.get(refsDigestsAtom);
    if (refsDigest !== undefined && currentDigests.get(key) === refsDigest) {
      // Promote active worktree key to MRU so long-lived repos stay cached across worktree churn.
      registry.update(refsDigestsAtom, (digests) => {
        if (digests.get(key) !== refsDigest) return digests;
        const next = new Map(digests);
        next.delete(key);
        next.set(key, refsDigest);
        return next;
      });
      return;
    }
    registry.update(refsDigestsAtom, (digests) => {
      const next = new Map(digests);
      if (refsDigest === undefined) {
        next.delete(key);
      } else {
        next.delete(key);
        next.set(key, refsDigest);
        while (next.size > MAX_VCS_REFS_DIGESTS) {
          const oldestKey = next.keys().next().value;
          if (oldestKey === undefined) break;
          next.delete(oldestKey);
        }
      }
      return next;
    });
    yield* invalidateCachedVcsRefs(registry, target);
  },
);
