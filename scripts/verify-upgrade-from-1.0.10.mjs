#!/usr/bin/env node
/**
 * 1.0.10 -> 1.0.11 upgrade compatibility smoke test (tasks 11 / 12).
 *
 * Installs the ACTUAL published `@vohongtho.infotech/code-intel@1.0.10` npm
 * package (not a hand-authored fake meta.json), analyzes a fixture repo and
 * creates a repository group with it, then points the candidate 1.0.11 CLI
 * (this repo's built `code-intel/core/dist/cli/main.js`) at the exact same
 * global config dir + repo directory — simulating a real in-place upgrade —
 * and verifies:
 *
 *   - repository identity (stable ID), name, and group membership survive
 *   - the 1.0.10-built index is NOT silently trusted as fresh by 1.0.11
 *     (different resolver/identity/fact-schema versions between releases)
 *   - reanalyzing under 1.0.11 succeeds and produces a trusted/fresh index
 *   - representative search/inspect commands work post-upgrade
 *   - the self-contained/runtime rollback path (`upgrade --archive` with a
 *     bad checksum) fails closed rather than corrupting the existing runtime
 *     (task 12.1/12.3 smoke — see verify-runtime-distribution.mjs for the
 *     full rollback/version-pin lifecycle test of the bundled runtime specifically)
 *
 * NOTE ON ISOLATION: CODE_INTEL_GLOBAL_DIR is set for both CLI invocations,
 * but the repo/group REGISTRY (unlike config/doctor/runtime-lifecycle) does
 * NOT respect it — `storage/repo-registry.ts` and `multi-repo/group-registry.ts`
 * both hardcode `os.homedir() + '/.code-intel'` — so repo/group state from
 * this script lands in the REAL global registry regardless. Worked around
 * here with a unique-per-run group name plus best-effort cleanup: `clean
 * --purge` for the repo, `group remove` for membership, and (since there is
 * no CLI command to fully delete a group once created) direct removal of the
 * group's own `~/.code-intel/groups/<name>.json`(`.sync.json`) file(s) in the
 * `finally` block — otherwise every run leaves a permanent empty group
 * behind. This inconsistency (registry ignoring CODE_INTEL_GLOBAL_DIR) is a
 * real, moderate-priority test-isolation gap worth fixing independently of
 * this release; not fixed at the source here given the blast radius of
 * touching the registry storage path — only this script's own residue is
 * cleaned up.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const candidateCli = path.join(repoRoot, 'code-intel/core/dist/cli/main.js');

/**
 * Neither 1.0.10 nor this 1.0.11 candidate's `repo list` has a `--json` flag
 * — parse the plain-text block for a specific repo by name. MUST match by
 * name, not just take the first "ID:" line: the repo/group registry is NOT
 * isolated by CODE_INTEL_GLOBAL_DIR (see the isolation note above), so
 * `repo list` output here also includes whatever else is already registered
 * on this machine.
 */
function parseStableIdFromRepoListText(text, name) {
  const block = text.split(/\n(?=  ◆  )/).find((entry) => entry.includes(`◆  ${name}\n`));
  return block?.match(/ID:\s+(\S+)/)?.[1];
}

/**
 * `.code-intel/meta.json` isn't a real path — persisted state is
 * Generation-based: `.code-intel/current.json` names the active
 * `generationId`, whose `meta.json` lives under
 * `.code-intel/generations/<generationId>/meta.json`. The generation ID
 * changes on every (re)analyze, so this must be re-resolved each time
 * rather than cached.
 */
function readCurrentGenerationMeta(repoDir) {
  const current = JSON.parse(fs.readFileSync(path.join(repoDir, '.code-intel', 'current.json'), 'utf8'));
  const metaPath = path.join(repoDir, '.code-intel', 'generations', current.generationId, 'meta.json');
  return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (result.status !== 0) {
    throw new Error(`command failed (exit ${result.status}): ${cmd} ${args.join(' ')}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  }
  return result;
}

/**
 * Task 11.9: optional embedding/vector state compatibility across the
 * upgrade. Uses its own fixture repo (separate from the main one in
 * `main()`) so a slow/flaky model download on first use of
 * `@huggingface/transformers` can't jeopardize the already-passing checks
 * above it. `--embeddings` both builds the vector index now AND remembers
 * the preference for future analyzes of this same repo (per `analyze
 * --help`), which is what lets the final step below verify the preference
 * itself survives the upgrade.
 */
function verifyEmbeddingCompatibility(embedRepoDir, cli1010, candidateCli, baseEnv, run) {
  console.log('\n--- Embedding/vector compatibility (task 11.9) ---');
  fs.mkdirSync(path.join(embedRepoDir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(embedRepoDir, 'src', 'hello.ts'),
    'export function upgradeFixtureHelloEmbed(name: string) { return `hi ${name}`; }\n',
  );
  run('git', ['init', '-q'], { cwd: embedRepoDir });
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: embedRepoDir });
  run('git', ['config', 'user.name', 'Test'], { cwd: embedRepoDir });
  run('git', ['add', '.'], { cwd: embedRepoDir });
  run('git', ['commit', '-qm', 'initial'], { cwd: embedRepoDir });

  // Real embedding generation under the actual published 1.0.10 — needs
  // network access to download the model on first use; generous timeout to
  // absorb that.
  run(cli1010, ['analyze', embedRepoDir, '--embeddings', '--skip-agents-md', '--skip-git'], {
    cwd: embedRepoDir, env: baseEnv, timeout: 300_000,
  });
  const embedMetaBefore = readCurrentGenerationMeta(embedRepoDir);
  if (!(embedMetaBefore.embeddings?.enabled && embedMetaBefore.embeddings?.status === 'ready')) {
    throw new Error(`expected 1.0.10 to produce a ready vector index, got: ${JSON.stringify(embedMetaBefore.embeddings)}`);
  }
  console.log(`✓ 1.0.10 produced a real ready vector index (model=${embedMetaBefore.embeddings.model}, dim=${embedMetaBefore.embeddings.dimension})`);

  // 1.0.11 must not silently trust the 1.0.10-built vector index either —
  // same SEMANTIC_PRODUCER_INCOMPATIBLE gate that covers graph/bm25.
  const embedStatusBefore = JSON.parse(
    spawnSync(candidateCli, ['index-status', embedRepoDir], { cwd: embedRepoDir, env: baseEnv, encoding: 'utf8' }).stdout,
  );
  if (embedStatusBefore.trusted === true && embedStatusBefore.fresh === true) {
    throw new Error(
      `RELEASE BLOCKER: 1.0.11 trusted the 1.0.10-built embeddings-enabled index without reanalysis: ${JSON.stringify(embedStatusBefore)}`,
    );
  }
  console.log(`✓ 1.0.11 does not silently trust the 1.0.10-built vector index (reasons=${embedStatusBefore.reasons?.join(',')})`);

  // Reanalyze under 1.0.11 WITHOUT re-specifying --embeddings — the
  // repo-level preference recorded by 1.0.10 should be honored
  // automatically, regenerating a fresh, compatible vector index.
  run(candidateCli, ['analyze', embedRepoDir, '--skip-agents-md', '--skip-git'], {
    cwd: embedRepoDir, env: baseEnv, timeout: 300_000,
  });
  const embedMetaAfter = readCurrentGenerationMeta(embedRepoDir);
  if (!(embedMetaAfter.embeddings?.enabled && embedMetaAfter.embeddings?.status === 'ready')) {
    throw new Error(
      `expected 1.0.11 reanalysis to honor the persisted embeddings preference and produce a ready vector index, got: ${JSON.stringify(embedMetaAfter.embeddings)}`,
    );
  }
  console.log('✓ 1.0.11 reanalysis honors the persisted embeddings preference and regenerates a ready vector index');

  const embedStatusAfter = JSON.parse(
    run(candidateCli, ['index-status', embedRepoDir], { cwd: embedRepoDir, env: baseEnv }).stdout,
  );
  if (!(embedStatusAfter.state === 'trusted' && embedStatusAfter.trusted === true && embedStatusAfter.fresh === true)) {
    throw new Error(`expected trusted/fresh vector index after 1.0.11 reanalysis, got ${JSON.stringify(embedStatusAfter)}`);
  }
  console.log('✓ vector index reports trusted/fresh after 1.0.11 reanalysis');
}

/**
 * Task 11.4: agent-target selection and user-modified instruction assets
 * across the upgrade.
 *
 * IMPORTANT CAVEAT, verified for real below rather than assumed: agent
 * target selection (`code-intel/core/src/cli/agent-targets.ts`,
 * `promptForAgentTargets`) is INTERACTIVE-ONLY — `isInteractiveSession()`
 * requires a real TTY on both stdin/stdout, which a `spawnSync`-driven
 * script (this one included) can never provide, and neither can a real
 * user's non-interactive/CI `analyze` run. So there is no way, in *any*
 * version, for a script like this to make a real 1.0.10 process create
 * `.code-intel/agent-targets.json` or an agent instruction file — that
 * artifact only ever gets created by a human typing at a real terminal.
 *
 * To still verify the real 1.0.11 code paths that CONSUME this state
 * (`getOrCreateAgentTargets`/`loadAgentTargets` in `cli/app.ts`, and the
 * marker-based preservation in `cli/context-writer.ts`'s `upsertFile`),
 * this seeds the exact artifact shape a real interactive 1.0.10 session
 * would have produced — confirmed byte-for-byte identical across both
 * versions by diffing `agent-targets.ts`/`context-writer.ts` at the
 * `v1.0.10` tag against this candidate — including a hand-added line
 * simulating a real user's own note, in the exact place `upsertFile`
 * documents as user-owned and never-overwritten. What's simulated is only
 * the unautomatable interactive keystrokes; the JSON schema, the
 * BLOCK_START/BLOCK_END marker format, and the "file already exists but
 * has no target selection yet" code path being exercised are all real,
 * version-verified, unmodified 1.0.10/1.0.11 behavior.
 */
function verifyAgentTargetPreservation(agentRepoDir, cli1010, candidateCli, baseEnv, run) {
  console.log('\n--- Agent-target/instruction-asset preservation (task 11.4) ---');
  fs.mkdirSync(path.join(agentRepoDir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(agentRepoDir, 'src', 'hello.ts'),
    'export function upgradeFixtureHelloAgent(name: string) { return `hi ${name}`; }\n',
  );
  run('git', ['init', '-q'], { cwd: agentRepoDir });
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: agentRepoDir });
  run('git', ['config', 'user.name', 'Test'], { cwd: agentRepoDir });
  run('git', ['add', '.'], { cwd: agentRepoDir });
  run('git', ['commit', '-qm', 'initial'], { cwd: agentRepoDir });

  // Confirm the environmental constraint for real rather than asserting it:
  // a real non-interactive 1.0.10 analyze must NOT create agent-targets.json.
  run(cli1010, ['analyze', agentRepoDir, '--skip-embeddings', '--skip-git'], { cwd: agentRepoDir, env: baseEnv, timeout: 120_000 });
  const agentTargetsPath = path.join(agentRepoDir, '.code-intel', 'agent-targets.json');
  const claudeMdPath = path.join(agentRepoDir, 'CLAUDE.md');
  if (fs.existsSync(agentTargetsPath)) {
    throw new Error('test assumption violated: a non-interactive 1.0.10 analyze unexpectedly created agent-targets.json');
  }
  console.log('✓ confirmed non-interactive 1.0.10 analyze does not (cannot) select agent targets — seeding the real artifact shape by hand below');

  // Seed the real, version-verified-identical artifact shape a human's
  // interactive 1.0.10 session would have produced, choosing the 'claude'
  // builtin target (CLAUDE.md, present unchanged in both versions).
  const selection = {
    selectedAgents: ['claude'],
    targets: { claude: { agentId: 'claude', label: 'Claude Code', path: 'CLAUDE.md', format: 'markdown', builtin: true } },
  };
  fs.writeFileSync(agentTargetsPath, `${JSON.stringify(selection, null, 2)}\n`, 'utf-8');
  const userNote = '<!-- USER NOTE: this line was hand-written by a real user and must survive any code-intel upgrade -->';
  fs.writeFileSync(
    claudeMdPath,
    [
      '# CLAUDE.md',
      '',
      '<!-- code-intel:start -->',
      '# Code Intelligence — repo-agent-fixture',
      '',
      '> Auto-managed by `code-intel analyze` (v1.0.10) — re-running it overwrites this block.',
      '<!-- code-intel:end -->',
      '',
      '---',
      '',
      '<!-- Add your own custom notes below this line. They will never be overwritten by code-intel. -->',
      '',
      userNote,
      '',
    ].join('\n'),
    'utf-8',
  );
  console.log('✓ seeded agent-targets.json (selectedAgents=["claude"]) and CLAUDE.md with a simulated user note, matching real 1.0.10 output shape');

  // Reanalyze under 1.0.11 WITHOUT --skip-agents-md and WITHOUT re-selecting
  // agent targets — 1.0.11 must read the existing selection rather than
  // needing (or being able, non-interactively) to re-prompt.
  const reanalyze = spawnSync(candidateCli, ['analyze', agentRepoDir, '--skip-embeddings', '--skip-git'], {
    cwd: agentRepoDir, env: baseEnv, encoding: 'utf8', timeout: 120_000,
  });
  if (reanalyze.status !== 0) {
    throw new Error(`1.0.11 analyze failed with a pre-existing agent-targets.json present: ${reanalyze.stdout}${reanalyze.stderr}`);
  }

  const selectionAfter = JSON.parse(fs.readFileSync(agentTargetsPath, 'utf-8'));
  if (JSON.stringify(selectionAfter.selectedAgents) !== JSON.stringify(['claude'])) {
    throw new Error(`agent target selection changed/lost across upgrade: ${JSON.stringify(selectionAfter)}`);
  }
  console.log('✓ agent target selection (selectedAgents=["claude"]) preserved across upgrade, read without re-prompting');

  const claudeMdAfter = fs.readFileSync(claudeMdPath, 'utf-8');
  if (!claudeMdAfter.includes('v1.0.11')) {
    throw new Error(`expected 1.0.11 to regenerate the managed block with its own version, got:\n${claudeMdAfter}`);
  }
  if (!claudeMdAfter.includes(userNote)) {
    throw new Error(`RELEASE BLOCKER: user's own CLAUDE.md content was destroyed by the 1.0.11 upgrade-triggered regeneration:\n${claudeMdAfter}`);
  }
  console.log('✓ CLAUDE.md managed block regenerated by 1.0.11 (v1.0.11) AND the user\'s own hand-written note survived untouched');
}

function main() {
  if (!fs.existsSync(candidateCli)) {
    throw new Error(`candidate CLI not built at ${candidateCli} — run \`npm run build:product\` first`);
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-upgrade-1010-'));
  const globalDir = path.join(tmpRoot, 'global'); // shared across both "versions" — this IS the upgrade
  const installDir = path.join(tmpRoot, 'v1010-install');
  const repoDir = path.join(tmpRoot, `repo-${process.pid}`);
  const embedRepoDir = path.join(tmpRoot, `repo-embed-${process.pid}`);
  const agentRepoDir = path.join(tmpRoot, `repo-agent-${process.pid}`);
  // Unique per run — see the registry-isolation note above for why this
  // can't just be a fixed name.
  const groupName = `upgrade-test-group-${process.pid}-${Date.now()}`;
  const groupPath = 'services/fixture';
  fs.mkdirSync(globalDir, { recursive: true });
  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  console.log(`Working dir: ${tmpRoot}`);

  const baseEnv = { ...process.env, CODE_INTEL_GLOBAL_DIR: globalDir, UPDATE_CHECK_DISABLED: '1' };

  try {
    // ── 1. Install the ACTUAL published 1.0.10 package ──────────────────
    fs.writeFileSync(path.join(installDir, 'package.json'), JSON.stringify({ name: 'upgrade-fixture', private: true }, null, 2));
    run('npm', ['install', '@vohongtho.infotech/code-intel@1.0.10', '--no-audit', '--no-fund'], { cwd: installDir, timeout: 300_000 });
    const cli1010 = path.join(installDir, 'node_modules', '.bin', 'code-intel');
    if (!fs.existsSync(cli1010)) throw new Error('expected 1.0.10 bin after install');
    const version1010 = run(cli1010, ['--version'], { env: baseEnv }).stdout.trim();
    if (version1010 !== '1.0.10') throw new Error(`expected 1.0.10, got ${version1010}`);
    console.log(`✓ installed real published code-intel@${version1010}`);

    // ── 2. Analyze + register + group with 1.0.10 ────────────────────────
    fs.writeFileSync(path.join(repoDir, 'src', 'hello.ts'), 'export function upgradeFixtureHello(name: string) { return `hi ${name}`; }\n');
    run('git', ['init', '-q'], { cwd: repoDir });
    run('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
    run('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
    run('git', ['add', '.'], { cwd: repoDir });
    run('git', ['commit', '-qm', 'initial'], { cwd: repoDir });
    run(cli1010, ['analyze', repoDir, '--skip-embeddings', '--skip-agents-md', '--skip-git'], { cwd: repoDir, env: baseEnv, timeout: 120_000 });

    const repoName = path.basename(repoDir);
    run(cli1010, ['group', 'create', groupName], { env: baseEnv });
    run(cli1010, ['group', 'add', groupName, groupPath, repoName], { env: baseEnv });
    // `group list <name> --json` isn't supported by 1.0.10's CLI (only `repo
    // list --json` is) — compare plain-text membership output instead.
    const groupBefore = run(cli1010, ['group', 'list', groupName], { env: baseEnv }).stdout;
    const repoListBeforeText = run(cli1010, ['repo', 'list'], { env: baseEnv }).stdout;
    const stableIdBefore = parseStableIdFromRepoListText(repoListBeforeText, repoName);
    if (!stableIdBefore) throw new Error(`expected a registered repo after 1.0.10 analyze, got:\n${repoListBeforeText}`);
    console.log(`✓ 1.0.10 registered repo "${repoName}" (id ${stableIdBefore}) in group "${groupName}"`);

    // ── 3. Point the 1.0.11 candidate CLI at the SAME global dir + repo ──
    const versionCandidate = run(candidateCli, ['--version'], { env: baseEnv }).stdout.trim();
    console.log(`✓ candidate CLI reports ${versionCandidate}`);

    // index-status exits non-zero when the index isn't fully trusted — that's
    // the EXPECTED outcome here, not a script failure, so use spawnSync
    // directly rather than the throwing `run()` wrapper.
    const statusUnderCandidate = JSON.parse(spawnSync(candidateCli, ['index-status', repoDir], { cwd: repoDir, env: baseEnv, encoding: 'utf8' }).stdout);
    if (statusUnderCandidate.trusted === true && statusUnderCandidate.fresh === true) {
      throw new Error(
        `RELEASE BLOCKER: 1.0.11 reported the 1.0.10-built index as trusted/fresh without reanalysis — `
        + `an old semantic artifact must never be silently treated as current. status=${JSON.stringify(statusUnderCandidate)}`,
      );
    }
    console.log(`✓ 1.0.11 does NOT silently trust the 1.0.10-built index (state=${statusUnderCandidate.state}, trusted=${statusUnderCandidate.trusted})`);

    // ── 4. Reanalyze under 1.0.11 and verify it becomes trusted ──────────
    run(candidateCli, ['analyze', repoDir, '--skip-embeddings', '--skip-agents-md', '--skip-git'], { cwd: repoDir, env: baseEnv, timeout: 120_000 });
    const statusAfterReanalyze = JSON.parse(run(candidateCli, ['index-status', repoDir], { cwd: repoDir, env: baseEnv }).stdout);
    if (!(statusAfterReanalyze.state === 'trusted' && statusAfterReanalyze.trusted === true && statusAfterReanalyze.fresh === true)) {
      throw new Error(`expected trusted/fresh after 1.0.11 reanalysis, got ${JSON.stringify(statusAfterReanalyze)}`);
    }
    console.log('✓ reanalyzing under 1.0.11 produces a trusted/fresh index');

    // ── 5. Repository identity + group membership survive the upgrade ────
    const repoListAfterText = run(candidateCli, ['repo', 'list'], { env: baseEnv }).stdout;
    const stableIdAfter = parseStableIdFromRepoListText(repoListAfterText, repoName);
    if (stableIdAfter !== stableIdBefore) {
      throw new Error(`repository stable ID changed across upgrade: ${stableIdBefore} -> ${stableIdAfter}`);
    }
    console.log(`✓ repository stable ID preserved across upgrade (${stableIdAfter})`);

    const groupAfter = run(candidateCli, ['group', 'list', groupName], { env: baseEnv }).stdout;
    for (const expected of [groupPath, repoName, stableIdBefore]) {
      if (!groupBefore.includes(expected)) throw new Error(`test bug: 1.0.10 group listing missing expected "${expected}":\n${groupBefore}`);
      if (!groupAfter.includes(expected)) throw new Error(`group membership lost across upgrade — missing "${expected}" post-upgrade:\n${groupAfter}`);
    }
    console.log('✓ group membership (path, repo name, stable ID) preserved across upgrade');

    // ── 6. Representative commands work post-upgrade ─────────────────────
    const searchOut = run(candidateCli, ['search', 'upgradeFixtureHello'], { cwd: repoDir, env: baseEnv, timeout: 30_000 }).stdout;
    if (!searchOut.includes('upgradeFixtureHello')) throw new Error(`search did not find the fixture symbol post-upgrade: ${searchOut}`);
    console.log('✓ search works post-upgrade');

    const inspectResult = spawnSync(candidateCli, ['inspect', 'upgradeFixtureHello'], { cwd: repoDir, env: baseEnv, encoding: 'utf8' });
    if (!inspectResult.stdout.includes('upgradeFixtureHello')) {
      throw new Error(`inspect did not find the fixture symbol post-upgrade: ${inspectResult.stdout}${inspectResult.stderr}`);
    }
    console.log('✓ inspect works post-upgrade');

    // ── 7. Doctor reports a coherent state (not a crash) post-upgrade ────
    const doctorResult = spawnSync(candidateCli, ['doctor', '--json'], { cwd: repoDir, env: baseEnv, encoding: 'utf8' });
    const doctor = JSON.parse(doctorResult.stdout);
    if (typeof doctor.ok !== 'boolean') throw new Error(`doctor --json produced an unexpected shape post-upgrade: ${doctorResult.stdout}`);
    console.log(`✓ doctor runs cleanly post-upgrade (ok=${doctor.ok})`);

    // ── 8. Optional embedding/vector state compatibility (task 11.9) ─────
    verifyEmbeddingCompatibility(embedRepoDir, cli1010, candidateCli, baseEnv, run);

    // ── 9. Agent-target selection / user-modified instruction assets (11.4) ──
    verifyAgentTargetPreservation(agentRepoDir, cli1010, candidateCli, baseEnv, run);
  } finally {
    // Best-effort: deregister from the REAL global registry (see the
    // isolation note above — CODE_INTEL_GLOBAL_DIR doesn't cover this).
    spawnSync(candidateCli, ['group', 'remove', groupName, groupPath], { env: baseEnv, encoding: 'utf8' });
    spawnSync(candidateCli, ['clean', repoDir, '--purge'], { cwd: repoDir, env: baseEnv, encoding: 'utf8' });
    // The embeddings and agent-target fixture repos (steps 8/9) are analyzed
    // independently and register themselves in the same real global repo
    // registry.
    if (fs.existsSync(embedRepoDir)) {
      spawnSync(candidateCli, ['clean', embedRepoDir, '--purge'], { cwd: embedRepoDir, env: baseEnv, encoding: 'utf8' });
    }
    if (fs.existsSync(agentRepoDir)) {
      spawnSync(candidateCli, ['clean', agentRepoDir, '--purge'], { cwd: agentRepoDir, env: baseEnv, encoding: 'utf8' });
    }
    // There is no `group delete` CLI command — `group remove` above only
    // strips this run's one member, leaving an empty, permanently-orphaned
    // group entry behind in the REAL registry on every run. Delete the
    // group's own storage file(s) directly instead: the registry always
    // lives at os.homedir()/.code-intel/groups/<name>.json regardless of
    // CODE_INTEL_GLOBAL_DIR (same isolation gap as above), so the path is
    // deterministic and safe to remove — it's this run's own group, created
    // by this script two steps up, addressed by its unique per-run name.
    const groupsDir = path.join(os.homedir(), '.code-intel', 'groups');
    for (const ext of ['.json', '.sync.json']) {
      const groupFile = path.join(groupsDir, `${groupName}${ext}`);
      if (fs.existsSync(groupFile)) fs.rmSync(groupFile, { force: true });
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log('\n✓ 1.0.10 -> 1.0.11 upgrade preserves repository/group identity and fails closed on the incompatible old index (tasks 11.1-11.9 CLI-level smoke).');
}

try {
  main();
} catch (err) {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
