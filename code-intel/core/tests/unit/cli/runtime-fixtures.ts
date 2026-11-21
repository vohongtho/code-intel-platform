import zlib from 'node:zlib';

export interface TarFixtureEntry {
  name: string;
  /** '0' file, '1' hard link, '2' symlink, '3' char device, '5' directory, '6' FIFO, 'L' GNU long name. */
  type?: string;
  data?: string | Buffer;
  linkname?: string;
}

function header(entry: TarFixtureEntry, size: number): Buffer {
  const block = Buffer.alloc(512);
  block.write(entry.name.slice(0, 100), 0, 'utf8');
  block.write('0000644\0', 100);
  block.write('0000000\0', 108);
  block.write('0000000\0', 116);
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  block.write('00000000000\0', 136);
  block.write('        ', 148);
  block.write(entry.type ?? '0', 156);
  if (entry.linkname) block.write(entry.linkname.slice(0, 100), 157, 'utf8');
  block.write('ustar\0', 257, 'latin1');
  block.write('00', 263);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return block;
}

/** Hand-built tar.gz so tests can produce entries system tar refuses to create. */
export function buildTarGz(entries: TarFixtureEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const data = entry.data === undefined ? Buffer.alloc(0) : Buffer.from(entry.data);
    parts.push(header(entry, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts));
}

const file = (name: string) => ({ name, size: 10, sha256: 'a'.repeat(64) });

export function sampleIndex(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'code-intel-runtime-index',
    schemaVersion: 1,
    verificationScheme: 'sigstore-github-attestation-v1',
    release: { version: '1.0.12', tag: 'v1.0.12', commit: 'b'.repeat(40) },
    identity: { repository: 'vohongtho/code-intel-platform', workflow: '.github/workflows/publish.yml' },
    minimumInstallerVersion: '1.0.11',
    targets: [{
      target: 'linux-x64',
      archive: file('code-intel-runtime-v1.0.12-linux-x64.tar.gz'),
      checksum: file('code-intel-runtime-v1.0.12-linux-x64.tar.gz.sha256'),
      sbom: file('code-intel-runtime-v1.0.12-linux-x64.tar.gz.sbom.cdx.json'),
      provenance: file('code-intel-runtime-v1.0.12-linux-x64.tar.gz.provenance.json'),
    }],
    ...overrides,
  };
}
