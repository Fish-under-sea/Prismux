import {
  isScopeAllowedForNamespace,
  isValidMemoryNamespace,
  type CallerScope,
  type MemoryNamespace,
  type MemoryQueryRequest
} from "@prismux/protocol";

export const MCP_TOOL_TIMEOUT_MS = 60_000 as const;

export type CollectorDocumentKind = "email" | "html" | "markdown" | "text";

export interface CollectorInput {
  kind: CollectorDocumentKind;
  raw: string;
  sourceRef: string;
  maxChunkChars?: number;
}

export interface CollectorChunk {
  chunkIndex: number;
  text: string;
  sourceRef: string;
}

export interface ContentCollector {
  collect(input: CollectorInput): CollectorChunk[];
}

/**
 * Lightweight document collector skeleton (M2 implements full HTML/email/Markdown chunking).
 */
export class BasicContentCollector implements ContentCollector {
  collect(input: CollectorInput): CollectorChunk[] {
    const trimmed = input.raw.trim();
    if (trimmed.length === 0) {
      return [];
    }
    const maxChars = Math.max(128, input.maxChunkChars ?? 1600);
    const chunks: CollectorChunk[] = [];
    let offset = 0;
    let index = 0;
    while (offset < trimmed.length) {
      chunks.push({
        chunkIndex: index,
        text: trimmed.slice(offset, offset + maxChars),
        sourceRef: input.sourceRef
      });
      offset += maxChars;
      index += 1;
    }
    return chunks;
  }
}

export interface ScopedQueryConstraints {
  callerScope: CallerScope;
  allowedNamespaces: MemoryNamespace[];
  timeoutMs: number;
}

/**
 * Transport-level identity forwarder and physical isolation guard (M2).
 * Daemon overwrites `_callerScope` at transport layer; model-supplied scope hints are ignored.
 */
export class ForwardIdentityGuard {
  resolveQueryConstraints(
    trustedCallerScope: CallerScope,
    requestedNamespaces?: MemoryNamespace[]
  ): ScopedQueryConstraints {
    if (trustedCallerScope.startsWith("qq_group:")) {
      const groupId = trustedCallerScope.slice("qq_group:".length);
      if (groupId.length === 0) {
        throw new Error("Invalid qq_group caller scope: missing group ID.");
      }
      const lockedNamespace: MemoryNamespace = `social/qq-group-${groupId}`;
      return {
        callerScope: trustedCallerScope,
        allowedNamespaces: [lockedNamespace],
        timeoutMs: MCP_TOOL_TIMEOUT_MS
      };
    }

    const candidates =
      requestedNamespaces && requestedNamespaces.length > 0
        ? requestedNamespaces
        : (["private/chief"] as MemoryNamespace[]);

    const allowedNamespaces = candidates.filter(
      (ns) =>
        isValidMemoryNamespace(ns) &&
        isScopeAllowedForNamespace(trustedCallerScope, ns)
    );

    return {
      callerScope: trustedCallerScope,
      allowedNamespaces,
      timeoutMs: MCP_TOOL_TIMEOUT_MS
    };
  }

  bindCallerScope(
    trustedCallerScope: CallerScope,
    request: Omit<MemoryQueryRequest, "callerScope">
  ): MemoryQueryRequest {
    const constraints = this.resolveQueryConstraints(
      trustedCallerScope,
      request.namespaces
    );
    return {
      ...request,
      callerScope: constraints.callerScope,
      namespaces: constraints.allowedNamespaces
    };
  }
}
