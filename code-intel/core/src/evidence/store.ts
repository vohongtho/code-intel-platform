import fs from 'node:fs';
import path from 'node:path';
import { Database, type SqliteDatabase } from '../shared/sqlite.js';
import type { AnalysisBoundary, AnalysisCoverage } from '../shared/index.js';
import { getIndexDir, resolvePublishedArtifactPath } from '../storage/index-generation.js';

export const EVIDENCE_SCHEMA_VERSION = 1;
export const EVIDENCE_DB_FILE = 'evidence.db';

export interface ResolutionEvidenceRecord {
  id: string;
  version: 1;
  referenceId: string;
  resolverVersion: string;
  strategy: string;
  confidence?: number;
  certainty?: 'exact' | 'candidate' | 'heuristic';
  coverage?: AnalysisCoverage;
  boundaries?: readonly AnalysisBoundary[];
  candidateIds?: readonly string[];
  rejectedCandidateReasons?: readonly string[];
  source?: {
    filePath: string;
    startLine?: number;
    endLine?: number;
  };
  details?: Record<string, unknown>;
  recordedAt: string;
}

export interface EvidenceReadBackReceipt {
  id: string;
  version: number;
  referenceId: string;
  resolverVersion: string;
  strategy: string;
  recordedAt: string;
}

export interface ResolutionEvidenceStore {
  put(record: ResolutionEvidenceRecord): void;
  get(id: string): ResolutionEvidenceRecord | null;
  getByReference(referenceId: string): ResolutionEvidenceRecord[];
  getReceipt(id: string): EvidenceReadBackReceipt | null;
  close(): void;
}

export class SqliteResolutionEvidenceStore implements ResolutionEvidenceStore {
  private readonly db: SqliteDatabase;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS resolution_evidence (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        referenceId TEXT NOT NULL,
        resolverVersion TEXT NOT NULL,
        strategy TEXT NOT NULL,
        confidence REAL NULL,
        certainty TEXT NULL,
        coverageJson TEXT NULL,
        boundariesJson TEXT NULL,
        candidateIdsJson TEXT NULL,
        rejectedCandidateReasonsJson TEXT NULL,
        sourceJson TEXT NULL,
        detailsJson TEXT NULL,
        recordedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_resolution_evidence_reference ON resolution_evidence(referenceId);
    `);
  }

  put(record: ResolutionEvidenceRecord): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO resolution_evidence (
        id, version, referenceId, resolverVersion, strategy, confidence, certainty,
        coverageJson, boundariesJson, candidateIdsJson, rejectedCandidateReasonsJson,
        sourceJson, detailsJson, recordedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.version,
      record.referenceId,
      record.resolverVersion,
      record.strategy,
      record.confidence ?? null,
      record.certainty ?? null,
      stringify(record.coverage),
      stringify(record.boundaries),
      stringify(record.candidateIds),
      stringify(record.rejectedCandidateReasons),
      stringify(record.source),
      stringify(record.details),
      record.recordedAt,
    );
  }

  get(id: string): ResolutionEvidenceRecord | null {
    const row = this.db.prepare('SELECT * FROM resolution_evidence WHERE id = ?').get(id) as EvidenceRow | undefined;
    return row ? mapEvidenceRow(row) : null;
  }

  getByReference(referenceId: string): ResolutionEvidenceRecord[] {
    return this.db
      .prepare('SELECT * FROM resolution_evidence WHERE referenceId = ? ORDER BY recordedAt ASC, id ASC')
      .all(referenceId)
      .map((row) => mapEvidenceRow(row as EvidenceRow));
  }

  getReceipt(id: string): EvidenceReadBackReceipt | null {
    const row = this.db.prepare('SELECT id, version, referenceId, resolverVersion, strategy, recordedAt FROM resolution_evidence WHERE id = ?').get(id) as Pick<EvidenceRow, 'id' | 'version' | 'referenceId' | 'resolverVersion' | 'strategy' | 'recordedAt'> | undefined;
    return row ? { ...row } : null;
  }

  close(): void {
    this.db.close();
  }
}

interface EvidenceRow {
  id: string;
  version: number;
  referenceId: string;
  resolverVersion: string;
  strategy: string;
  confidence: number | null;
  certainty: ResolutionEvidenceRecord['certainty'] | null;
  coverageJson: string | null;
  boundariesJson: string | null;
  candidateIdsJson: string | null;
  rejectedCandidateReasonsJson: string | null;
  sourceJson: string | null;
  detailsJson: string | null;
  recordedAt: string;
}

function mapEvidenceRow(row: EvidenceRow): ResolutionEvidenceRecord {
  return {
    id: row.id,
    version: row.version as 1,
    referenceId: row.referenceId,
    resolverVersion: row.resolverVersion,
    strategy: row.strategy,
    confidence: row.confidence ?? undefined,
    certainty: row.certainty ?? undefined,
    coverage: parseJson<AnalysisCoverage>(row.coverageJson),
    boundaries: parseJson<readonly AnalysisBoundary[]>(row.boundariesJson),
    candidateIds: parseJson<readonly string[]>(row.candidateIdsJson),
    rejectedCandidateReasons: parseJson<readonly string[]>(row.rejectedCandidateReasonsJson),
    source: parseJson<ResolutionEvidenceRecord['source']>(row.sourceJson),
    details: parseJson<Record<string, unknown>>(row.detailsJson),
    recordedAt: row.recordedAt,
  };
}

function stringify(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function getEvidenceDbPath(repoDir: string): string {
  const stagingDir = process.env['CODE_INTEL_INDEX_STAGING_DIR']?.trim();
  if (stagingDir) return path.join(path.resolve(stagingDir), EVIDENCE_DB_FILE);
  return resolvePublishedArtifactPath(repoDir, EVIDENCE_DB_FILE);
}

export function createEvidenceStore(repoDir: string): ResolutionEvidenceStore {
  const dbPath = getEvidenceDbPath(repoDir);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return new SqliteResolutionEvidenceStore(dbPath);
}
