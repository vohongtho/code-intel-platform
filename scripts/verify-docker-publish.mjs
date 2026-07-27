#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const platforms = (process.env.DOCKER_PUBLISH_PLATFORMS || 'linux/amd64,linux/arm64')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const builder = process.env.DOCKER_BUILDX_BUILDER?.trim();
const target = process.env.DOCKER_PUBLISH_TARGET?.trim() || 'deps';

if (platforms.length === 0) {
  console.error('no platforms configured');
  process.exit(1);
}

const requiredDockerfileChecks = [
  ['USER codeuser', /\nUSER codeuser\n/],
  ['EXPOSE 4747', /\nEXPOSE 4747\n/],
  [
    'serve entrypoint',
    /CMD \["node", "\/app\/code-intel\/core\/dist\/cli\/main\.js", "serve", "\/data", "--port", "4747"\]/,
  ],
];

for (const [label, pattern] of requiredDockerfileChecks) {
  if (!pattern.test(dockerfile)) {
    console.error(`Dockerfile runtime contract mismatch: ${label}`);
    process.exit(1);
  }
}

const baseArgs = ['buildx', 'build'];
if (builder) baseArgs.push('--builder', builder);
baseArgs.push('--progress=plain', '--target', target);

console.log(`verifying Docker publish build for: ${platforms.join(', ')}`);
console.log(`builder: ${builder || '(current)'}`);
console.log(`target: ${target}`);

for (const platform of platforms) {
  console.log(`\n=== ${platform} ===`);
  const args = [...baseArgs, '--platform', platform, '.'];
  execFileSync('docker', args, { stdio: 'inherit' });
}

console.log('\nruntime contract confirmed: USER codeuser, EXPOSE 4747, serve /data --port 4747');
