import type {
  DaemonPtyResourceDto,
  DaemonSystemResourcesResponse,
  DaemonWorkspaceResourceDto,
} from "../daemonClient";

export function formatBytesCompact(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
}

export function formatCpuPercent(cpu: number | null | undefined): string {
  if (typeof cpu !== "number" || !Number.isFinite(cpu) || cpu < 0) {
    return "—";
  }
  return `${cpu >= 10 ? Math.round(cpu) : cpu.toFixed(1)}%`;
}

export type ResourceSortOption = "memory" | "cpu" | "name";

/**
 * Modeled after Orca `resources/popover/resource-usage-resource-tree.tsx`:
 * keeps unsampled `null` rows after measured consumers in descending metric sorts.
 */
function compareMetricDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

export function sortResourceWorkspaceGroups(
  groups: readonly NormalizedResourceWorkspaceGroup[],
  sortOption: ResourceSortOption,
): NormalizedResourceWorkspaceGroup[] {
  const copy = [...groups];
  if (sortOption === "memory") {
    copy.sort((a, b) => compareMetricDesc(a.memoryBytes, b.memoryBytes) || a.label.localeCompare(b.label));
  } else if (sortOption === "cpu") {
    copy.sort((a, b) => compareMetricDesc(a.cpuPercent, b.cpuPercent) || a.label.localeCompare(b.label));
  } else {
    copy.sort((a, b) => a.label.localeCompare(b.label));
  }
  return copy;
}

export interface NormalizedResourceWorkspaceGroup {
  readonly workspace: string;
  readonly label: string;
  readonly cpuPercent: number | null;
  readonly memoryBytes: number | null;
  readonly ptys: readonly DaemonPtyResourceDto[];
}

export interface NormalizedResourcesSummary {
  readonly cpuPercent: number | null;
  readonly memoryBytes: number | null;
  readonly hostMemoryTotalBytes: number | null;
  readonly daemonCpuPercent: number | null;
  readonly daemonMemoryBytes: number | null;
  readonly t3ServerCpuPercent: number | null;
  readonly t3ServerMemoryBytes: number | null;
  readonly workspaces: readonly NormalizedResourceWorkspaceGroup[];
  readonly totalPtyCount: number;
  readonly stalePtyCount: number;
}

function workspaceDisplayName(workspace: string): string {
  const trimmed = workspace.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "未归属工作区";
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? trimmed;
}

export function normalizeResourcesSummary(
  raw: DaemonSystemResourcesResponse | null | undefined,
): NormalizedResourcesSummary {
  if (!raw) {
    return {
      cpuPercent: null,
      memoryBytes: null,
      hostMemoryTotalBytes: null,
      daemonCpuPercent: null,
      daemonMemoryBytes: null,
      t3ServerCpuPercent: null,
      t3ServerMemoryBytes: null,
      workspaces: [],
      totalPtyCount: 0,
      stalePtyCount: 0,
    };
  }

  const workspaceGroups: NormalizedResourceWorkspaceGroup[] = [];
  const seenPtyIds = new Set<string>();

  if (Array.isArray(raw.workspaces) && raw.workspaces.length > 0) {
    for (const ws of raw.workspaces as DaemonWorkspaceResourceDto[]) {
      const ptys = Array.isArray(ws.ptys) ? ws.ptys : [];
      for (const pty of ptys) {
        if (pty.sessionId) seenPtyIds.add(pty.sessionId);
      }
      workspaceGroups.push({
        workspace: ws.workspace || "unassigned",
        label: ws.label?.trim() || workspaceDisplayName(ws.workspace || ""),
        cpuPercent:
          typeof ws.cpuPercent === "number" && Number.isFinite(ws.cpuPercent)
            ? ws.cpuPercent
            : null,
        memoryBytes:
          typeof ws.memoryBytes === "number" && Number.isFinite(ws.memoryBytes)
            ? ws.memoryBytes
            : null,
        ptys,
      });
    }
  }

  if (Array.isArray(raw.ptys) && raw.ptys.length > 0) {
    const groupedUnseen = new Map<string, DaemonPtyResourceDto[]>();
    for (const pty of raw.ptys) {
      if (pty.sessionId && seenPtyIds.has(pty.sessionId)) continue;
      const key = pty.workspace?.trim() || pty.cwd?.trim() || "unassigned";
      const list = groupedUnseen.get(key) ?? [];
      list.push(pty);
      groupedUnseen.set(key, list);
    }
    for (const [workspace, ptys] of groupedUnseen) {
      const cpuSum = ptys.reduce(
        (acc, pty) =>
          acc + (typeof pty.cpuPercent === "number" && Number.isFinite(pty.cpuPercent) ? pty.cpuPercent : 0),
        0,
      );
      const memSum = ptys.reduce(
        (acc, pty) =>
          acc +
          (typeof pty.memoryBytes === "number" && Number.isFinite(pty.memoryBytes)
            ? pty.memoryBytes
            : 0),
        0,
      );
      workspaceGroups.push({
        workspace,
        label: workspace === "unassigned" ? "独立 PTY 会话" : workspaceDisplayName(workspace),
        cpuPercent: ptys.some((p) => typeof p.cpuPercent === "number") ? cpuSum : null,
        memoryBytes: ptys.some((p) => typeof p.memoryBytes === "number") ? memSum : null,
        ptys,
      });
    }
  }

  const allPtys = workspaceGroups.flatMap((group) => group.ptys);
  const stalePtyCount = allPtys.filter((pty) => pty.stale === true || pty.alive === false).length;

  const cpuPercent =
    typeof raw.totalCpuPercent === "number" && Number.isFinite(raw.totalCpuPercent)
      ? raw.totalCpuPercent
      : typeof raw.host?.cpuPercent === "number" && Number.isFinite(raw.host.cpuPercent)
        ? raw.host.cpuPercent
        : typeof raw.daemon?.cpuPercent === "number" && Number.isFinite(raw.daemon.cpuPercent)
          ? raw.daemon.cpuPercent
          : null;

  const memoryBytes =
    typeof raw.totalMemoryBytes === "number" && Number.isFinite(raw.totalMemoryBytes)
      ? raw.totalMemoryBytes
      : typeof raw.host?.memoryBytes === "number" && Number.isFinite(raw.host.memoryBytes)
        ? raw.host.memoryBytes
        : typeof raw.daemon?.memoryBytes === "number" && Number.isFinite(raw.daemon.memoryBytes)
          ? raw.daemon.memoryBytes
          : null;

  return {
    cpuPercent,
    memoryBytes,
    hostMemoryTotalBytes:
      typeof raw.hostMemoryTotalBytes === "number"
        ? raw.hostMemoryTotalBytes
        : typeof raw.host?.totalMemoryBytes === "number"
          ? raw.host.totalMemoryBytes
          : null,
    daemonCpuPercent:
      typeof raw.daemon?.cpuPercent === "number" ? raw.daemon.cpuPercent : null,
    daemonMemoryBytes:
      typeof raw.daemon?.memoryBytes === "number" ? raw.daemon.memoryBytes : null,
    t3ServerCpuPercent:
      typeof raw.t3Server?.cpuPercent === "number" ? raw.t3Server.cpuPercent : null,
    t3ServerMemoryBytes:
      typeof raw.t3Server?.memoryBytes === "number" ? raw.t3Server.memoryBytes : null,
    workspaces: workspaceGroups,
    totalPtyCount: allPtys.length,
    stalePtyCount,
  };
}
