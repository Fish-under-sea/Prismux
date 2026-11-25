import {
  defineSourceControlDriver,
  withOwnServices,
} from "@prismux/source-control-core/server/driver";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { definition } from "../shared/definition.ts";
import * as GiteeApi from "./GiteeApi.ts";
import * as GiteePullRequestProvider from "./GiteePullRequestProvider.ts";
import * as GiteeSourceControlProvider from "./GiteeSourceControlProvider.ts";

const services = GiteeApi.layer.pipe(Layer.orDie);

const makeIsRepositoryStarred = Effect.gen(function* () {
  const api = yield* GiteeApi.GiteeApi;
  return (_host: string, repository: string) => api.isRepositoryStarred(repository);
});

const makeStarRepository = Effect.gen(function* () {
  const api = yield* GiteeApi.GiteeApi;
  return (_host: string, repository: string) => api.starRepository(repository);
});

const makeInstance = Effect.all({
  sourceControl: GiteeSourceControlProvider.make,
  discovery: GiteeSourceControlProvider.makeDiscovery,
  pullRequests: GiteePullRequestProvider.make,
  isRepositoryStarred: makeIsRepositoryStarred,
  starRepository: makeStarRepository,
});

export const driver = defineSourceControlDriver({
  kind: definition.kind,
  definition,
  make: withOwnServices(makeInstance, services),
});
