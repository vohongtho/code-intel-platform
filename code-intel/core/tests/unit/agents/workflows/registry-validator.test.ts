import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listWorkflowManifests, WORKFLOW_IDS } from '../../../../src/agents/workflows/registry.js';
import { resolveRuntimeCapabilities, resolveWorkflowCapabilities } from '../../../../src/agents/workflows/capabilities.js';
import { validateWorkflowRegistry } from '../../../../src/agents/workflows/validator.js';
import { MCP_TOOL_DEFINITIONS } from '../../../../src/mcp-server/tool-definitions.js';

describe('workflow registry — validates against the live MCP tool inventory', () => {
  it('every manifest is satisfied by the live tool inventory (no missing required tools/fields)', () => {
    const caps = resolveRuntimeCapabilities();
    for (const manifest of listWorkflowManifests()) {
      const resolution = resolveWorkflowCapabilities(manifest, caps);
      assert.deepEqual(resolution.missingRequired, [], `workflow '${manifest.id}' has missing required tools/fields`);
      assert.equal(resolution.satisfied, true);
    }
  });

  it('validateWorkflowRegistry reports ok=true against the live tool inventory', () => {
    const report = validateWorkflowRegistry();
    assert.equal(report.ok, true, JSON.stringify(report.issues, null, 2));
  });

  it('registers all 8 documented workflow ids exactly once', () => {
    const manifests = listWorkflowManifests();
    assert.equal(manifests.length, 8);
    assert.deepEqual(new Set(manifests.map((m) => m.id)), new Set(WORKFLOW_IDS));
  });

  it('every manifest has at least one target and a non-empty asset path', () => {
    for (const manifest of listWorkflowManifests()) {
      assert.ok(manifest.targets.length > 0, `workflow '${manifest.id}' has no targets`);
      assert.ok(manifest.assetPath.length > 0, `workflow '${manifest.id}' has no assetPath`);
    }
  });

  it('fails validation when a required tool is removed from the runtime inventory', () => {
    const withoutSearch = MCP_TOOL_DEFINITIONS.filter((t) => t.name !== 'search');
    const caps = resolveRuntimeCapabilities(withoutSearch);
    const report = validateWorkflowRegistry(listWorkflowManifests(), caps);
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((i) => i.workflowId === 'explore' && i.message.includes("'search'")));
  });

  it('fails validation when a required field is removed from a tool schema', () => {
    const patched = MCP_TOOL_DEFINITIONS.map((t) => {
      if (t.name !== 'blast_radius') return t;
      const { target: _omit, ...rest } = t.inputSchema.properties as Record<string, unknown>;
      return { ...t, inputSchema: { ...t.inputSchema, properties: rest } };
    });
    const caps = resolveRuntimeCapabilities(patched);
    const report = validateWorkflowRegistry(listWorkflowManifests(), caps);
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((i) => i.message.includes("field 'target'")));
  });

  it('optional tool degrades explicitly (fallback/reducedGuarantee present) when unavailable', () => {
    const withoutGraphDiff = MCP_TOOL_DEFINITIONS.filter((t) => t.name !== 'graph_diff');
    const caps = resolveRuntimeCapabilities(withoutGraphDiff);
    const impact = listWorkflowManifests().find((m) => m.id === 'impact')!;
    const resolution = resolveWorkflowCapabilities(impact, caps);
    assert.equal(resolution.satisfied, true, 'graph_diff is optional — impact must still be satisfied without it');
    const degraded = resolution.degraded.find((d) => d.tool === 'graph_diff');
    assert.ok(degraded, 'expected graph_diff to appear as a degraded optional capability');
    assert.ok(degraded!.fallback.length > 0);
    assert.ok(degraded!.reducedGuarantee.length > 0);
  });
});
