/**
 * validate-cli.ts
 *
 * Standalone entry point (built by tsup as `dist/agents/workflows/validate-cli.js`,
 * mirroring `cli/hook.ts`'s minimal, fully self-contained bundling pattern — no OTel,
 * no DB, no graph) that runs `validateWorkflowRegistry` and exits non-zero on failure.
 * Run automatically as part of `npm run build`, after the workflow assets are copied
 * into `dist/`, so it validates the exact built package a release ships.
 */
import { validateWorkflowRegistry } from './validator.js';

const report = validateWorkflowRegistry();

for (const issue of report.issues) {
  const prefix = issue.severity === 'error' ? '✗' : '⚠';
  console.log(`  ${prefix} [${issue.workflowId}] ${issue.message}`);
}

if (!report.ok) {
  console.error(`\nWorkflow validation failed: ${report.issues.filter((i) => i.severity === 'error').length} error(s).`);
  process.exit(1);
}

console.log(`Workflow validation passed (${report.issues.length} warning(s)).`);
