import crypto from 'node:crypto';

export interface SourceRange {
  startLine: number;
  endLine: number;
}

export interface ServedArtifactRecord {
  workspaceIdentity: string;
  artifactIdentity: string;
  contentFingerprint: string;
  deliveredRanges?: readonly SourceRange[];
  deliveredBytes: number;
  callIndex: number;
}

export function contentFingerprint(content: string | undefined): string {
  return crypto.createHash('sha256').update(content ?? '').digest('hex');
}

/**
 * Per-workspace delivered-source memory for one MCP connection. Owned by the
 * transport (mcp-server), not a global process singleton — the caller is
 * responsible for scoping instances to a connection/workspace.
 */
export class ContextDeliverySession {
  private readonly records = new Map<string, ServedArtifactRecord>();
  private callIndex = 0;

  constructor(readonly workspaceIdentity: string) {}

  beginCall(): number {
    this.callIndex += 1;
    return this.callIndex;
  }

  lookup(artifactIdentity: string): ServedArtifactRecord | undefined {
    return this.records.get(artifactIdentity);
  }

  record(artifactIdentity: string, contentFingerprint: string, deliveredBytes: number, ranges?: readonly SourceRange[]): void {
    this.records.set(artifactIdentity, {
      workspaceIdentity: this.workspaceIdentity,
      artifactIdentity,
      contentFingerprint,
      deliveredRanges: ranges,
      deliveredBytes,
      callIndex: this.callIndex,
    });
  }
}
