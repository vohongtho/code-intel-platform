#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const fixtureRoot = path.join(here, 'fixtures', 'pdg-mutations');
const cli = path.join(repoRoot, 'code-intel', 'core', 'dist', 'cli', 'main.js');

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function git(args, cwd) {
  return run('git', args, cwd);
}

function score(predicted, expected) {
  const predictedSet = new Set(predicted);
  const expectedSet = new Set(expected);
  const truePositives = [...predictedSet].filter((item) => expectedSet.has(item)).length;
  const falsePositives = [...predictedSet].filter((item) => !expectedSet.has(item)).length;
  const falseNegatives = [...expectedSet].filter((item) => !predictedSet.has(item)).length;
  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision: truePositives + falsePositives === 0 ? 0 : truePositives / (truePositives + falsePositives),
    recall: truePositives + falseNegatives === 0 ? 1 : truePositives / (truePositives + falseNegatives),
  };
}

function analyze(repoDir) {
  run(process.execPath, [cli, 'analyze', repoDir, '--skip-embeddings', '--skip-agents-md', '--no-group-sync'], repoRoot);
}

function impact(repoDir, precision) {
  const output = run(process.execPath, [
    cli,
    'pr-impact',
    '--path', repoDir,
    '--base', 'base',
    '--head', 'HEAD',
    '--precision', precision,
    '--format', 'json',
  ], repoRoot);
  return JSON.parse(output);
}

function prediction(result) {
  return [...new Set([
    ...result.changedSymbols.map((item) => item.name),
    ...result.impactedSymbols.map((item) => item.name),
  ])].sort();
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function round(value) {
  return Number(value.toFixed(6));
}

if (!fs.existsSync(cli)) {
  throw new Error(`Built CLI not found at ${cli}; run npm --prefix code-intel/core run build first.`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'));
const cases = [];

for (const mutation of manifest.mutations) {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), `pdg-mutation-${mutation.id}-`));
  try {
    fs.mkdirSync(path.join(repoDir, path.dirname(manifest.sourceFile)), { recursive: true });
    fs.copyFileSync(path.join(fixtureRoot, manifest.baseFile), path.join(repoDir, manifest.sourceFile));
    git(['init', '--quiet'], repoDir);
    git(['config', 'user.email', 'pdg-bench@example.com'], repoDir);
    git(['config', 'user.name', 'PDG Benchmark'], repoDir);
    git(['add', '.'], repoDir);
    git(['commit', '--quiet', '-m', 'base'], repoDir);
    git(['tag', 'base'], repoDir);

    fs.copyFileSync(path.join(fixtureRoot, mutation.file), path.join(repoDir, manifest.sourceFile));
    git(['add', '.'], repoDir);
    git(['commit', '--quiet', '-m', mutation.id], repoDir);
    analyze(repoDir);

    const graphFirst = impact(repoDir, 'graph');
    const graphSecond = impact(repoDir, 'graph');
    const pdgFirst = impact(repoDir, 'pdg');
    const pdgSecond = impact(repoDir, 'pdg');
    const graphPrediction = prediction(graphFirst);
    const pdgPrediction = prediction(pdgFirst);
    cases.push({
      id: mutation.id,
      description: mutation.description,
      language: manifest.language,
      expectedImpactedSymbols: mutation.expectedImpactedSymbols,
      graph: { predictedSymbols: graphPrediction, ...score(graphPrediction, mutation.expectedImpactedSymbols) },
      pdg: { predictedSymbols: pdgPrediction, ...score(pdgPrediction, mutation.expectedImpactedSymbols) },
      deterministic: {
        graph: JSON.stringify(graphPrediction) === JSON.stringify(prediction(graphSecond)),
        pdg: JSON.stringify(pdgPrediction) === JSON.stringify(prediction(pdgSecond)),
      },
    });
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
}

const graphPrecision = mean(cases.map((item) => item.graph.precision));
const graphRecall = mean(cases.map((item) => item.graph.recall));
const pdgPrecision = mean(cases.map((item) => item.pdg.precision));
const pdgRecall = mean(cases.map((item) => item.pdg.recall));
const relativePrecisionImprovement = graphPrecision === 0 ? 0 : (pdgPrecision - graphPrecision) / graphPrecision;
const recallRegressionPp = (graphRecall - pdgRecall) * 100;
const deterministic = cases.every((item) => item.deterministic.graph && item.deterministic.pdg);
const gatePassed = deterministic && recallRegressionPp <= 2 && relativePrecisionImprovement >= 0.1;

const report = {
  schemaVersion: 1,
  benchmark: 'pdg-mutation',
  supportedLanguages: [manifest.language],
  cases,
  summary: {
    graph: { precision: round(graphPrecision), recall: round(graphRecall) },
    pdg: { precision: round(pdgPrecision), recall: round(pdgRecall) },
    relativePrecisionImprovement: round(relativePrecisionImprovement),
    recallRegressionPercentagePoints: round(recallRegressionPp),
    deterministic,
  },
  gate: {
    maximumRecallRegressionPercentagePoints: 2,
    minimumRelativePrecisionImprovement: 0.1,
    passed: gatePassed,
    autoPrecision: gatePassed ? 'pdg' : 'graph',
  },
};

const outputArgIndex = process.argv.indexOf('--output');
if (outputArgIndex >= 0 && process.argv[outputArgIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputArgIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
