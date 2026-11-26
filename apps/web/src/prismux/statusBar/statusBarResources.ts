import type {
  DaemonProcessResourceDto,
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

export function formatSampleTimestamp(timestampMs: number | null | undefined): string | null {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs) || timestampMs <= 0) {
    return null;
  }
  const date = new Date(timestampMs);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
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

export interface NormalizedProcessResource {
  readonly pid: number;
  readonly parentPid: number | null;
  readonly name: string;
  readonly processName: string;
  readonly commandLine: string | null;
  readonly role: string;
  readonly category: "desktop" | "core" | "terminal" | "agent";
  readonly cpuPercent: number | null;
  readonly memoryBytes: number | null;
  readonly privateMemoryBytes: number | null;
  readonly alive: boolean;
  readonly source: string;
  readonly sessionId: string | null;
  readonly workspace: string | null;
  readonly stale: boolean;
}

export function sortProcessResources(
  processes: readonly NormalizedProcessResource[],
  sortOption: ResourceSortOption,
): NormalizedProcessResource[] {
  const copy = [...processes];
  if (sortOption === "memory") {
    copy.sort(
      (a, b) =>
        compareMetricDesc(a.memoryBytes, b.memoryBytes) ||
        compareMetricDesc(a.cpuPercent, b.cpuPercent) ||
        a.name.localeCompare(b.name),
    );
  } else if (sortOption === "cpu") {
    copy.sort(
      (a, b) =>
        compareMetricDesc(a.cpuPercent, b.cpuPercent) ||
        compareMetricDesc(a.memoryBytes, b.memoryBytes) ||
        a.name.localeCompare(b.name),
    );
  } else {
    copy.sort((a, b) => a.name.localeCompare(b.name) || a.pid - b.pid);
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
  readonly collectedAt: number | null;
  readonly cpuPercent: number | null;
  readonly memoryBytes: number | null;
  readonly privateMemoryBytes: number | null;
  readonly hostMemoryTotalBytes: number | null;
  readonly hostMemorySharePercent: number | null;
  readonly desktopCpuPercent: number | null;
  readonly desktopMemoryBytes: number | null;
  readonly desktopProcessCount: number;
  readonly daemonPid: number | null;
  readonly daemonCpuPercent: number | null;
  readonly daemonMemoryBytes: number | null;
  readonly coreServerPid: number | null;
  readonly coreServerCpuPercent: number | null;
  readonly coreServerMemoryBytes: number | null;
  readonly coreServerState: string | null;
  readonly coreServerHostedBy: string | null;
  readonly coreServerLabel: string;
  readonly workspaces: readonly NormalizedResourceWorkspaceGroup[];
  readonly processes: readonly NormalizedProcessResource[];
  readonly coreProcesses: readonly NormalizedProcessResource[];
  readonly activeChildProcesses: readonly NormalizedProcessResource[];
  readonly totalProcessCount: number;
  readonly activeAgentCount: number;
  readonly activeTerminalCount: number;
  readonly totalPtyCount: number;
  readonly stalePtyCount: number;
  readonly hostMetricsSource: string | null;
}

function workspaceDisplayName(workspace: string): string {
  const trimmed = workspace.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "未归属工作区";
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? trimmed;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeProcessCategory(raw: unknown): NormalizedProcessResource["category"] {
  if (raw === "desktop" || raw === "core" || raw === "terminal" || raw === "agent") {
    return raw;
  }
  return "terminal";
}

function normalizeProcessEntry(raw: DaemonProcessResourceDto): NormalizedProcessResource | null {
  if (typeof raw?.pid !== "number" || !Number.isInteger(raw.pid) || raw.pid <= 0) {
    return null;
  }
  const processName =
    typeof raw.processName === "string" && raw.processName.trim().length > 0
      ? raw.processName.trim()
      : `pid-${raw.pid}`;
  const name =
    typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name.trim() : processName;

  return {
    pid: raw.pid,
    parentPid:
      typeof raw.parentPid === "number" && Number.isInteger(raw.parentPid) && raw.parentPid > 0
        ? raw.parentPid
        : null,
    name,
    processName,
    commandLine:
      typeof raw.commandLine === "string" && raw.commandLine.trim().length > 0
        ? raw.commandLine.trim()
        : null,
    role: typeof raw.role === "string" && raw.role.trim().length > 0 ? raw.role.trim() : "child",
    category: normalizeProcessCategory(raw.category),
    cpuPercent: finiteNumberOrNull(raw.cpuPercent),
    memoryBytes: finiteNumberOrNull(raw.memoryBytes),
    privateMemoryBytes: finiteNumberOrNull(raw.privateMemoryBytes),
    alive: raw.alive !== false,
    source: typeof raw.source === "string" ? raw.source : "os-tree",
    sessionId:
      typeof raw.sessionId === "string" && raw.sessionId.trim().length > 0
        ? raw.sessionId.trim()
        : null,
    workspace:
      typeof raw.workspace === "string" && raw.workspace.trim().length > 0
        ? raw.workspace.trim()
        : null,
    stale: raw.stale === true,
  };
}

export function normalizeResourcesSummary(
  raw: DaemonSystemResourcesResponse | null | undefined,
): NormalizedResourcesSummary {
  if (!raw) {
    return {
      collectedAt: null,
      cpuPercent: null,
      memoryBytes: null,
      privateMemoryBytes: null,
      hostMemoryTotalBytes: null,
      hostMemorySharePercent: null,
      desktopCpuPercent: null,
      desktopMemoryBytes: null,
      desktopProcessCount: 0,
      daemonPid: null,
      daemonCpuPercent: null,
      daemonMemoryBytes: null,
      coreServerPid: null,
      coreServerCpuPercent: null,
      coreServerMemoryBytes: null,
      coreServerState: null,
      coreServerHostedBy: null,
      coreServerLabel: "Prismux Server",
      workspaces: [],
      processes: [],
      coreProcesses: [],
      activeChildProcesses: [],
      totalProcessCount: 0,
      activeAgentCount: 0,
      activeTerminalCount: 0,
      totalPtyCount: 0,
      stalePtyCount: 0,
      hostMetricsSource: null,
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
        cpuPercent: finiteNumberOrNull(ws.cpuPercent),
        memoryBytes: finiteNumberOrNull(ws.memoryBytes),
        ptys,
      });
    }
  }

  if (Array.isArray(raw.ptys) && raw.ptys.length > 0) {
    const groupedUnseen = new Map<string, DaemonPtyResourceDto[]>();
    for (const pty of raw.ptys) {
      if (pty.sessionId && seenPtyIds.has(pty.sessionId)) continue;
      if (pty.sessionId) seenPtyIds.add(pty.sessionId);
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

  const processes: NormalizedProcessResource[] = [];
  const seenProcessPids = new Set<number>();
  if (Array.isArray(raw.processes)) {
    for (const item of raw.processes) {
      const normalized = normalizeProcessEntry(item);
      if (normalized && !seenProcessPids.has(normalized.pid)) {
        seenProcessPids.add(normalized.pid);
        processes.push(normalized);
      }
    }
  }

  const coreProcesses = processes.filter(
    (proc) => proc.category === "desktop" || proc.category === "core",
  );
  // Exclude processes already represented as killable PersistentPtyPool cards to avoid duplicate rows.
  const activeChildProcesses = processes.filter(
    (proc) =>
      (proc.category === "agent" || proc.category === "terminal") &&
      !(proc.sessionId && seenPtyIds.has(proc.sessionId)),
  );

  const desktopProcs = processes.filter((proc) => proc.category === "desktop");
  const desktopCpuPercent =
    finiteNumberOrNull(raw.desktop?.cpuPercent) ??
    (desktopProcs.some((p) => p.cpuPercent !== null)
      ? Math.round(desktopProcs.reduce((acc, p) => acc + (p.cpuPercent ?? 0), 0) * 10) / 10
      : null);
  const desktopMemoryBytes =
    finiteNumberOrNull(raw.desktop?.memoryBytes) ??
    (desktopProcs.some((p) => p.memoryBytes !== null)
      ? desktopProcs.reduce((acc, p) => acc + (p.memoryBytes ?? 0), 0)
      : null);
  const desktopProcessCount =
    typeof raw.desktop?.processCount === "number" && Number.isFinite(raw.desktop.processCount)
      ? raw.desktop.processCount
      : desktopProcs.length;

  const cpuPercent =
    finiteNumberOrNull(raw.totalCpuPercent) ??
    finiteNumberOrNull(raw.host?.cpuPercent) ??
    finiteNumberOrNull(raw.daemon?.cpuPercent);

  const memoryBytes =
    finiteNumberOrNull(raw.totalMemoryBytes) ??
    finiteNumberOrNull(raw.host?.memoryBytes) ??
    finiteNumberOrNull(raw.daemon?.memoryBytes);

  const hostMemoryTotalBytes =
    finiteNumberOrNull(raw.hostMemoryTotalBytes) ??
    finiteNumberOrNull(raw.host?.totalMemoryBytes);

  const hostMemorySharePercent =
    memoryBytes !== null && hostMemoryTotalBytes !== null && hostMemoryTotalBytes > 0
      ? Math.round((memoryBytes / hostMemoryTotalBytes) * 1000) / 10
      : null;

  const coreServerHostedBy =
    typeof raw.coreServer?.hostedBy === "string" && raw.coreServer.hostedBy.trim().length > 0
      ? raw.coreServer.hostedBy.trim()
      : null;

  const coreServerLabel =
    typeof raw.coreServer?.label === "string" && raw.coreServer.label.trim().length > 0
      ? raw.coreServer.label.trim()
      : coreServerHostedBy === "electron-in-process"
        ? "Prismux Server (宿主同进程)"
        : "Prismux Server";

  const activeAgentCount =
    typeof raw.activeAgentCount === "number" && Number.isFinite(raw.activeAgentCount)
      ? raw.activeAgentCount
      : processes.filter((p) => p.category === "agent").length;

  const activeTerminalCount =
    typeof raw.activeTerminalCount === "number" && Number.isFinite(raw.activeTerminalCount)
      ? raw.activeTerminalCount
      : processes.filter((p) => p.category === "terminal").length;

  return {
    collectedAt: finiteNumberOrNull(raw.collectedAt ?? raw.sampledAt),
    cpuPercent,
    memoryBytes,
    privateMemoryBytes: finiteNumberOrNull(raw.totalPrivateMemoryBytes),
    hostMemoryTotalBytes,
    hostMemorySharePercent,
    desktopCpuPercent,
    desktopMemoryBytes,
    desktopProcessCount,
    daemonPid:
      typeof raw.daemon?.pid === "number" && Number.isInteger(raw.daemon.pid) && raw.daemon.pid > 0
        ? raw.daemon.pid
        : null,
    daemonCpuPercent: finiteNumberOrNull(raw.daemon?.cpuPercent),
    daemonMemoryBytes: finiteNumberOrNull(raw.daemon?.memoryBytes),
    coreServerPid:
      typeof raw.coreServer?.pid === "number" &&
      Number.isInteger(raw.coreServer.pid) &&
      raw.coreServer.pid > 0
        ? raw.coreServer.pid
        : null,
    coreServerCpuPercent: finiteNumberOrNull(raw.coreServer?.cpuPercent),
    coreServerMemoryBytes: finiteNumberOrNull(raw.coreServer?.memoryBytes),
    coreServerState:
      typeof raw.coreServer?.state === "string" && raw.coreServer.state.trim().length > 0
        ? raw.coreServer.state.trim()
        : null,
    coreServerHostedBy,
    coreServerLabel,
    workspaces: workspaceGroups,
    processes,
    coreProcesses,
    activeChildProcesses,
    totalProcessCount:
      typeof raw.processCount === "number" && Number.isFinite(raw.processCount)
        ? raw.processCount
        : processes.length,
    activeAgentCount,
    activeTerminalCount,
    totalPtyCount: allPtys.length,
    stalePtyCount,
    hostMetricsSource:
      typeof raw.hostMetricsSource === "string" && raw.hostMetricsSource.trim().length > 0
        ? raw.hostMetricsSource.trim()
        : null,
  };
}
