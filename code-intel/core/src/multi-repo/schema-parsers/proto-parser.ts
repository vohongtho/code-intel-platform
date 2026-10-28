import fs from 'node:fs';
import path from 'node:path';
import { scanForFiles } from './file-scanner.js';
import { parseProtoFile, resolveProtoTypes } from './proto-model.js';
import { PROTO_LIMITS, type ProtoFileModel } from '../../semantic/protocol-contracts/grpc-types.js';

/**
 * v1.0.11 flat contract shape, kept as a migration adapter for existing callers. New code uses
 * the versioned ProtoFileModel (proto-model.ts) instead.
 */
export interface ProtoContract {
  name: string;      // "UserService.GetUser"
  kind: 'grpc';
  serviceName: string;
  rpcName: string;
  inputType: string;
  outputType: string;
  filePath: string;
}

const DOCUMENT_SCAN_DEPTH = 8;

export interface ProtoRepositoryScan {
  files: ProtoFileModel[];
  boundaries: string[];
}

/** Bounded scan + parse + cross-file type resolution of a repository's `.proto` files;
 * `filePath`s are repository-relative. */
export function parseProtoRepository(repoRoot: string): ProtoRepositoryScan {
  const found = scanForFiles(repoRoot, (name) => name.endsWith('.proto'), DOCUMENT_SCAN_DEPTH).sort();
  const boundaries: string[] = [];
  if (found.length > PROTO_LIMITS.maxFilesPerRepo) boundaries.push('file-count-limit');
  const parsed: ProtoFileModel[] = [];
  for (const absolutePath of found.slice(0, PROTO_LIMITS.maxFilesPerRepo)) {
    const filePath = path.relative(repoRoot, absolutePath).split(path.sep).join('/');
    try {
      parsed.push(parseProtoFile(filePath, fs.readFileSync(absolutePath, 'utf-8')));
    } catch {
      boundaries.push(`unreadable:${filePath}`);
    }
  }
  return { files: resolveProtoTypes(parsed), boundaries };
}

/** v1.0.11 regex extraction — used only for a file the parser rejects. */
function legacyRegexContracts(content: string, filePath: string): ProtoContract[] {
  const contracts: ProtoContract[] = [];
  const serviceRegex = /service\s+(\w+)\s*\{([^}]+)\}/g;
  let serviceMatch: RegExpExecArray | null;
  while ((serviceMatch = serviceRegex.exec(content)) !== null) {
    const serviceName = serviceMatch[1];
    const rpcRegex = /rpc\s+(\w+)\s*\((\w+)\)\s*returns\s*\((\w+)\)/g;
    let rpcMatch: RegExpExecArray | null;
    while ((rpcMatch = rpcRegex.exec(serviceMatch[2])) !== null) {
      contracts.push({ name: `${serviceName}.${rpcMatch[1]}`, kind: 'grpc', serviceName, rpcName: rpcMatch[1], inputType: rpcMatch[2], outputType: rpcMatch[3], filePath });
    }
  }
  return contracts;
}

/**
 * Flat v1.0.11-compatible `Service.Rpc` contracts, now produced by the bounded proto parser
 * (input/output types as written, unqualified). A file the parser rejects falls back to the
 * legacy regex scan for that file only.
 */
export async function parseProtoContracts(repoRoot: string): Promise<ProtoContract[]> {
  const files = scanForFiles(repoRoot, (name) => name.endsWith('.proto'), DOCUMENT_SCAN_DEPTH).sort();
  const contracts: ProtoContract[] = [];

  for (const filePath of files.slice(0, PROTO_LIMITS.maxFilesPerRepo)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const model = parseProtoFile(filePath, content);
    if (model.coverage.boundaryReasons.some((reason) => reason !== 'extensions-not-modeled' && reason !== 'groups-not-modeled')) {
      contracts.push(...legacyRegexContracts(content, filePath));
      continue;
    }
    for (const service of model.services) {
      for (const rpc of service.rpcs) {
        contracts.push({
          name: `${service.name}.${rpc.name}`,
          kind: 'grpc',
          serviceName: service.name,
          rpcName: rpc.name,
          inputType: rpc.requestType.split('.').pop()!,
          outputType: rpc.responseType.split('.').pop()!,
          filePath,
        });
      }
    }
  }

  return contracts;
}
