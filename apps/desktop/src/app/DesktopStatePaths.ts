import * as Option from "effect/Option";

export type JoinPath = (first: string, ...segments: string[]) => string;

function normalizeConfiguredBaseDir(
  prismuxHome: Option.Option<string> | undefined,
): Option.Option<string> {
  if (prismuxHome === undefined || Option.isNone(prismuxHome)) {
    return Option.none();
  }
  const trimmed = prismuxHome.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly prismuxHome?: Option.Option<string>;
  /** @deprecated Track-1 compat alias; use `prismuxHome`. */
  readonly t3Home?: Option.Option<string>;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input.prismuxHome ?? input.t3Home), () =>
    input.joinPath(input.homeDirectory, ".prismux"),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly prismuxHome?: Option.Option<string>;
  /** @deprecated Track-1 compat alias; use `prismuxHome`. */
  readonly t3Home?: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.prismuxHome ?? input.t3Home));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
