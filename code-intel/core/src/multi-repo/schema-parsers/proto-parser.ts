import fs from 'node:fs';
import { scanForFiles } from './file-scanner.js';

export interface ProtoContract {
  name: string;      // "UserService.GetUser"
  kind: 'grpc';
  serviceName: string;
  rpcName: string;
  inputType: string;
  outputType: string;
  filePath: string;
}

export async function parseProtoContracts(repoRoot: string): Promise<ProtoContract[]> {
  const files = scanForFiles(repoRoot, (name) => name.endsWith('.proto'));
  const contracts: ProtoContract[] = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');

    const serviceRegex = /service\s+(\w+)\s*\{([^}]+)\}/g;
    let serviceMatch: RegExpExecArray | null;

    while ((serviceMatch = serviceRegex.exec(content)) !== null) {
      const serviceName = serviceMatch[1];
      const body = serviceMatch[2];

      const rpcRegex = /rpc\s+(\w+)\s*\((\w+)\)\s*returns\s*\((\w+)\)/g;
      let rpcMatch: RegExpExecArray | null;

      while ((rpcMatch = rpcRegex.exec(body)) !== null) {
        const rpcName = rpcMatch[1];
        const inputType = rpcMatch[2];
        const outputType = rpcMatch[3];

        contracts.push({
          name: `${serviceName}.${rpcName}`,
          kind: 'grpc',
          serviceName,
          rpcName,
          inputType,
          outputType,
          filePath,
        });
      }
    }
  }

  return contracts;
}
