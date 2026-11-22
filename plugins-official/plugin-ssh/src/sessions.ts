import { randomUUID } from "node:crypto";

export type SshSessionKind = "pty" | "sftp";

export interface SshSessionDescriptor {
  sessionId: string;
  hostId: string;
  kind: SshSessionKind;
  command?: string;
  args?: string[];
  createdAt: number;
  closed: boolean;
}

export interface OpenSshSessionInput {
  sessionId?: string;
  hostId: string;
  kind: SshSessionKind;
  command?: string;
  args?: string[];
  onClose?: () => void | Promise<void>;
}

/**
 * Tracks active SSH Web PTY and SFTP sessions for deterministic cleanup via `ctx.effect()`.
 */
export class SshSessionManager {
  private readonly sessions = new Map<
    string,
    { descriptor: SshSessionDescriptor; onClose?: () => void | Promise<void> }
  >();
  private disposed = false;

  isDisposed(): boolean {
    return this.disposed;
  }

  openSession(input: OpenSshSessionInput): SshSessionDescriptor {
    if (this.disposed) {
      throw new Error("SshSessionManager is disposed and cannot open new sessions.");
    }
    const sessionId = input.sessionId ?? `ssh-sess-${randomUUID()}`;
    if (this.sessions.has(sessionId)) {
      throw new Error(`SSH session "${sessionId}" already exists.`);
    }

    const descriptor: SshSessionDescriptor = {
      sessionId,
      hostId: input.hostId,
      kind: input.kind,
      ...(input.command !== undefined ? { command: input.command } : {}),
      ...(input.args !== undefined ? { args: [...input.args] } : {}),
      createdAt: Date.now(),
      closed: false
    };
    this.sessions.set(sessionId, {
      descriptor,
      ...(input.onClose !== undefined ? { onClose: input.onClose } : {})
    });
    return { ...descriptor };
  }

  listSessions(): SshSessionDescriptor[] {
    return Array.from(this.sessions.values()).map(({ descriptor }) => ({
      ...descriptor,
      ...(descriptor.args !== undefined ? { args: [...descriptor.args] } : {})
    }));
  }

  getActiveCount(): number {
    return this.sessions.size;
  }

  async closeSession(sessionId: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId);
    if (entry === undefined) {
      return false;
    }
    this.sessions.delete(sessionId);
    entry.descriptor.closed = true;
    await entry.onClose?.();
    return true;
  }

  async closeAll(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const entries = Array.from(this.sessions.values());
    this.sessions.clear();
    for (const entry of entries) {
      entry.descriptor.closed = true;
      await entry.onClose?.();
    }
  }
}
