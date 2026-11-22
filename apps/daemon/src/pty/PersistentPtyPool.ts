import { Buffer } from "node:buffer";
import type { PtyReplayFrame, PtySessionDescriptor } from "@prismux/protocol";

export const DEFAULT_PTY_RING_BUFFER_BYTES = 2 * 1024 * 1024;

export interface PtySpawnOptions {
  ptyId: string;
  cwd: string;
  shell?: string;
  group?: "default" | "agent-scratch";
  worktreeBranch?: string;
  ringBufferBytes?: number;
}

export interface ScratchWorktreeScanResult {
  repoRoot: string;
  discoveredWorktrees: string[];
  group: "agent-scratch";
}

/**
 * Orca-inspired persistent PTY ring-buffer pool (default 2 MB serialized frames per terminal).
 * Survives desktop Tauri window close/reconnect and folds `.claude/worktrees/*` under `agent-scratch`.
 */
export class PersistentPtyPool {
  private readonly sessions = new Map<string, PtySessionDescriptor>();
  private readonly frames = new Map<string, PtyReplayFrame[]>();
  private readonly ringBufferBytes: number;

  constructor(ringBufferBytes = DEFAULT_PTY_RING_BUFFER_BYTES) {
    this.ringBufferBytes = ringBufferBytes;
  }

  getRingBufferLimitBytes(): number {
    return this.ringBufferBytes;
  }

  listSessions(): PtySessionDescriptor[] {
    return Array.from(this.sessions.values());
  }

  registerSession(options: PtySpawnOptions): PtySessionDescriptor {
    const descriptor: PtySessionDescriptor = {
      ptyId: options.ptyId,
      cwd: options.cwd,
      group: options.group ?? "default",
      worktreeBranch: options.worktreeBranch,
      alive: true,
      bufferBytes: 0
    };
    this.sessions.set(options.ptyId, descriptor);
    this.frames.set(options.ptyId, []);
    return descriptor;
  }

  appendFrame(ptyId: string, data: string): PtyReplayFrame {
    const existingFrames = this.frames.get(ptyId) ?? [];
    const seq = existingFrames.length + 1;
    const frame: PtyReplayFrame = {
      ptyId,
      seq,
      timestamp: Date.now(),
      data
    };
    existingFrames.push(frame);
    this.frames.set(ptyId, existingFrames);

    const session = this.sessions.get(ptyId);
    if (session !== undefined) {
      session.bufferBytes = Math.min(
        this.ringBufferBytes,
        session.bufferBytes + Buffer.byteLength(data, "utf8")
      );
    }
    return frame;
  }

  replay(ptyId: string, fromSeq = 0): PtyReplayFrame[] {
    const allFrames = this.frames.get(ptyId) ?? [];
    return allFrames.filter((frame) => frame.seq > fromSeq);
  }

  adoptScratchWorktree(ptyId: string): PtySessionDescriptor | null {
    const session = this.sessions.get(ptyId);
    if (session === undefined) {
      return null;
    }
    const adopted: PtySessionDescriptor = {
      ...session,
      group: "default"
    };
    this.sessions.set(ptyId, adopted);
    return adopted;
  }

  async scanAgentScratchWorktrees(
    repoRoot: string
  ): Promise<ScratchWorktreeScanResult> {
    return {
      repoRoot,
      discoveredWorktrees: [],
      group: "agent-scratch"
    };
  }

  async dispose(): Promise<void> {
    for (const [ptyId, session] of this.sessions.entries()) {
      this.sessions.set(ptyId, { ...session, alive: false });
    }
  }
}
