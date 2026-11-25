import { useAtomValue } from "@effect/atom-react";
import { providerInstanceInitials } from "@prismux/client-runtime/state/provider-instance-display";
import {
  ProviderDriverKind,
  officialAcpRegistryIconUrlForAgentId,
  resolveOfficialAcpRegistryIconUrl,
} from "@prismux/core-contracts";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { useId, useState } from "react";

import { cn } from "../../lib/utils";
import {
  type AcpAgentBrandKey,
  acpBrandKeyToAgentBrandId,
  getAcpAgentBrandAccentColor,
  renderBundledBrandSvg,
  resolveAcpAgentBrandKey,
  stripUuidNoise,
} from "../../prismux/agentBrand";
import { AntigravityIcon, ClaudeAI, OpenAI } from "../Icons";
import { ProviderPackageIcon } from "../chat/ProviderPackageIcon";
import { providerClients } from "./providerDriverMeta";

const ACP_REGISTRY_ICON_CACHE = "t3-acp-registry-icons-v1";
const MAX_ICON_BYTES = 512 * 1_024;
const inFlightIcons = new Map<string, Promise<Blob>>();

export { officialAcpRegistryIconUrlForAgentId, resolveOfficialAcpRegistryIconUrl };

async function checkedIconBlob(response: Response): Promise<Blob> {
  if (!response.ok || response.redirected) throw new Error("ACP registry icon request failed.");
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
  if (!contentType.startsWith("image/")) throw new Error("ACP registry icon was not an image.");
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_ICON_BYTES) {
    throw new Error("ACP registry icon was too large.");
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_ICON_BYTES) throw new Error("ACP registry icon was too large.");
  return new Blob([bytes], { type: contentType });
}

export function loadCachedAcpRegistryIcon(iconUrl: string): Promise<Blob> {
  if (resolveOfficialAcpRegistryIconUrl(iconUrl) !== iconUrl) {
    return Promise.reject(new Error("ACP registry icon URL was not allowed."));
  }
  const pending = inFlightIcons.get(iconUrl);
  if (pending) return pending;
  const load = (async () => {
    let cache: Cache | null = null;
    if (typeof caches !== "undefined") {
      try {
        cache = await caches.open(ACP_REGISTRY_ICON_CACHE);
      } catch {
        // Privacy modes may expose CacheStorage but reject access; icons still load from the allowlisted CDN.
      }
    }
    if (cache !== null) {
      try {
        const cached = await cache.match(iconUrl);
        if (cached) return await checkedIconBlob(cached);
      } catch {}
    }

    const response = await fetch(iconUrl, {
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    const clone = response.clone();
    const blob = await checkedIconBlob(response);
    await cache?.put(iconUrl, clone).catch(() => undefined);
    return blob;
  })();
  inFlightIcons.set(iconUrl, load);
  void load.then(
    () => inFlightIcons.delete(iconUrl),
    () => inFlightIcons.delete(iconUrl),
  );
  return load;
}

// Falls back to the raw allowlisted CDN URL when the validating fetch fails: the
// CDN serves no CORS headers, so the fetch is often blocked cross-origin while
// native <img> loading still works. The object URL is shared per agent and
// revoked when the last icon unmounts.
const acpRegistryIconSourceAtom = Atom.family((iconUrl: string) =>
  Atom.make((get) => {
    let disposed = false;
    let objectUrl: string | null = null;
    get.addFinalizer(() => {
      disposed = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    });
    return Effect.promise(() =>
      loadCachedAcpRegistryIcon(iconUrl).then(
        (blob) => {
          if (disposed) return iconUrl;
          objectUrl = URL.createObjectURL(blob);
          return objectUrl;
        },
        () => iconUrl,
      ),
    );
  }).pipe(Atom.withLabel(`acp-registry-icon:${iconUrl}`)),
);

const NO_ICON_SOURCE_ATOM = Atom.make(AsyncResult.initial<string>());

function resolveCustomAcpMonogram(input: {
  readonly displayName?: string | null | undefined;
  readonly agentId?: string | null | undefined;
  readonly instanceId?: string | null | undefined;
}): string {
  const candidates = [input.displayName, input.agentId, input.instanceId];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const cleaned = stripUuidNoise(
      candidate.trim().replace(/^(?:acp[-_]?registry|local)[:/_-]+/i, ""),
    ).trim();
    if (!cleaned) continue;
    const initials = providerInstanceInitials(cleaned).trim();
    if (initials.length > 0) {
      return initials;
    }
  }
  return "AC";
}

export function BundledAcpBrandIcon({
  brandKey,
  className,
}: {
  readonly brandKey: AcpAgentBrandKey;
  readonly className?: string;
}) {
  const rawId = useId();
  const gradientPrefix = rawId.replace(/[^a-zA-Z0-9_-]/g, "");

  if (brandKey === "claude") {
    return (
      <ClaudeAI
        className={cn("size-full", className)}
        data-acp-brand-icon="claude"
        aria-hidden
      />
    );
  }
  if (brandKey === "codex") {
    return (
      <OpenAI
        className={cn("size-full", className)}
        data-acp-brand-icon="codex"
        aria-hidden
      />
    );
  }
  if (brandKey === "antigravity") {
    return (
      <AntigravityIcon
        className={cn("size-full", className)}
        data-acp-brand-icon="antigravity"
        aria-hidden
      />
    );
  }
  if (brandKey === "opencode") {
    const openCodePackageIcon = providerClients.get(ProviderDriverKind.make("opencode"))?.icon;
    if (openCodePackageIcon) {
      return (
        <ProviderPackageIcon
          icon={openCodePackageIcon}
          className={cn("size-full", className)}
          data-acp-brand-icon="opencode"
          aria-hidden
        />
      );
    }
  }
  if (brandKey === "pi") {
    const piPackageIcon = providerClients.get(ProviderDriverKind.make("pi"))?.icon;
    if (piPackageIcon) {
      return (
        <ProviderPackageIcon
          icon={piPackageIcon}
          className={cn("size-full", className)}
          data-acp-brand-icon="pi"
          aria-hidden
        />
      );
    }
  }

  return renderBundledBrandSvg({
    brandId: acpBrandKeyToAgentBrandId(brandKey),
    gradientPrefix,
    className: cn("size-full", className),
    dataAttributes: {
      "data-acp-brand-icon": brandKey,
    },
  });
}

export function AcpRegistryAgentIcon({
  icon,
  agentId,
  instanceId,
  displayName,
  commandPath,
  className,
  fallbackClassName,
}: {
  readonly icon: string | null;
  readonly agentId?: string | null | undefined;
  readonly instanceId?: string | null | undefined;
  readonly displayName?: string | null | undefined;
  readonly commandPath?: string | null | undefined;
  readonly className?: string;
  readonly fallbackClassName?: string;
}) {
  const colorFilterId = useId();
  const brandKey = resolveAcpAgentBrandKey({
    agentId,
    instanceId,
    displayName,
    commandPath,
  });
  const brandAccentColor = brandKey ? getAcpAgentBrandAccentColor(brandKey) : null;
  const iconUrl = resolveOfficialAcpRegistryIconUrl(icon);
  // Render only after the load pipeline resolves, so the fallback icon does
  // not flash a broken image.
  const source = AsyncResult.getOrElse(
    useAtomValue(iconUrl === null ? NO_ICON_SOURCE_ATOM : acpRegistryIconSourceAtom(iconUrl)),
    () => null,
  );
  const [image, setImage] = useState<{
    readonly source: string;
    readonly status: "loaded" | "failed";
  } | null>(null);
  const status = source !== null && image?.source === source ? image.status : "loading";
  const monogram =
    brandKey === null ? resolveCustomAcpMonogram({ displayName, agentId, instanceId }) : null;

  return (
    <span
      aria-hidden
      data-acp-brand={brandKey ?? "custom"}
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-foreground",
        className,
      )}
    >
      {/* Recolor alpha because external images cannot inherit currentColor; local SVG filters work despite
       * CDN mask CORS restrictions. Preserves brand accent pigment for colored brands and adapts monochrome
       * marks cleanly across Light/Dark themes. */}
      <svg aria-hidden className="pointer-events-none absolute size-0" focusable="false">
        <defs>
          <filter id={colorFilterId} colorInterpolationFilters="sRGB">
            <feFlood floodColor={brandAccentColor ?? "currentColor"} />
            <feComposite in2="SourceAlpha" operator="in" />
          </filter>
        </defs>
      </svg>
      {status !== "loaded" ? (
        brandKey !== null ? (
          <BundledAcpBrandIcon
            brandKey={brandKey}
            className={cn("size-4", fallbackClassName)}
          />
        ) : (
          <span
            data-slot="acp-icon-monogram"
            data-acp-brand-monogram={monogram ?? "AC"}
            className={cn(
              "@container flex size-full items-center justify-center rounded-md border border-border/75 bg-foreground/[0.06] text-4xs font-semibold leading-none tracking-tight text-foreground/85 select-none dark:border-white/15 dark:bg-white/[0.08]",
              fallbackClassName,
            )}
          >
            {monogram}
          </span>
        )
      ) : null}
      {source !== null && status !== "failed" ? (
        <img
          alt=""
          className={cn(
            "size-full object-contain",
            status !== "loaded" && "invisible absolute inset-0",
          )}
          style={{ filter: `url(#${colorFilterId})` }}
          decoding="async"
          referrerPolicy="no-referrer"
          src={source}
          onError={() => setImage({ source, status: "failed" })}
          onLoad={() => setImage({ source, status: "loaded" })}
        />
      ) : null}
    </span>
  );
}
