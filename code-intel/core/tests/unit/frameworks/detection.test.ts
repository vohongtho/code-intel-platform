import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFrameworkDetection, detectFrameworks } from '../../../src/frameworks/detection.js';
import { loadFrameworkAdapters } from '../../../src/frameworks/registry.js';

describe('framework detection', () => {
  it('requires multi-signal evidence for exact semantics', () => {
    const weakOnly = summarizeFrameworkDetection([
      { kind: 'import', strength: 'weak', filePath: 'a.ts', value: 'express' },
    ], 'express', '0.1.0');
    const strongMulti = summarizeFrameworkDetection([
      { kind: 'dependency', strength: 'strong', filePath: 'package.json', value: 'express' },
      { kind: 'registration', strength: 'strong', filePath: 'src/app.ts', value: 'app.get' },
    ], 'express', '0.1.0');

    assert.equal(weakOnly.exact, false);
    assert.equal(strongMulti.exact, true);
  });

  it('detects express from dependency plus registration', async () => {
    const detections = await detectFrameworks({
      workspaceRoot: '/repo',
      filePaths: ['package.json', 'src/app.ts'],
      fileCache: new Map([
        ['package.json', '{"dependencies":{"express":"^5.0.0"}}'],
        ['src/app.ts', "import express from 'express'\napp.get('/x', handler)\n"],
      ]),
    }, await loadFrameworkAdapters());

    assert.ok(detections.length >= 1);
    const express = detections.find((item) => item.frameworkId === 'express');
    assert.ok(express);
    assert.equal(express?.exact, true);
  });
});
