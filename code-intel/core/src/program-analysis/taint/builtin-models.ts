/**
 * taint/builtin-models.ts
 *
 * Language-runtime taint models shipped with Code Intel (framework-specific
 * fragments live with their framework adapters — see
 * `FrameworkAdapter.taintModels`). Every entry names a documented
 * standard-library API by its qualified callee path; a bare, ambiguous
 * name (`exec`, `escape`, `query`) is never used, and a sanitizer is listed
 * only when the API's documented contract is to neutralize one specific
 * vulnerability class (e.g. `shlex.quote` for shell commands). Generic
 * "validate"/"clean" helpers are deliberately absent — classifying a
 * function as a sanitizer from its display name alone is exactly the guess
 * this model registry exists to avoid.
 */
import { Language } from '../../shared/languages.js';
import type { TaintModel } from './model-schema.js';

export const BUILTIN_TAINT_MODELS: readonly TaintModel[] = [
  {
    schemaVersion: 1,
    id: 'node-core',
    version: '1',
    languages: [Language.JavaScript, Language.TypeScript],
    description: 'Node.js core: process arguments, shell/process execution, dynamic code, filesystem paths.',
    sources: [
      { id: 'process-argv', kind: 'field-read', path: 'process.argv' },
    ],
    sinks: [
      { id: 'child-process-exec', kind: 'qualified-call', callee: 'child_process.exec', category: 'command' },
      { id: 'child-process-exec-sync', kind: 'qualified-call', callee: 'child_process.execSync', category: 'command' },
      { id: 'eval', kind: 'qualified-call', callee: 'eval', category: 'code' },
      { id: 'fs-create-read-stream', kind: 'qualified-call', callee: 'fs.createReadStream', category: 'path' },
      { id: 'fs-read-file', kind: 'qualified-call', callee: 'fs.readFile', category: 'path' },
      { id: 'fs-read-file-sync', kind: 'qualified-call', callee: 'fs.readFileSync', category: 'path' },
      { id: 'vm-run-in-new-context', kind: 'qualified-call', callee: 'vm.runInNewContext', category: 'code' },
    ],
    sanitizers: [
      { id: 'path-basename', kind: 'qualified-call', callee: 'path.basename', categories: ['path'] },
    ],
  },
  {
    schemaVersion: 1,
    id: 'python-stdlib',
    version: '1',
    languages: [Language.Python],
    description: 'Python standard library: argv/input, shell and process execution, dynamic code, unsafe deserialization.',
    sources: [
      { id: 'builtin-input', kind: 'return-of', callee: 'input' },
      { id: 'sys-argv', kind: 'field-read', path: 'sys.argv' },
    ],
    sinks: [
      { id: 'builtin-eval', kind: 'qualified-call', callee: 'eval', category: 'code' },
      { id: 'builtin-exec', kind: 'qualified-call', callee: 'exec', category: 'code' },
      { id: 'os-popen', kind: 'qualified-call', callee: 'os.popen', category: 'command' },
      { id: 'os-system', kind: 'qualified-call', callee: 'os.system', category: 'command' },
      { id: 'pickle-loads', kind: 'qualified-call', callee: 'pickle.loads', category: 'deserialization' },
      { id: 'subprocess-call', kind: 'qualified-call', callee: 'subprocess.call', category: 'command' },
      { id: 'subprocess-check-output', kind: 'qualified-call', callee: 'subprocess.check_output', category: 'command' },
      { id: 'subprocess-popen', kind: 'qualified-call', callee: 'subprocess.Popen', category: 'command' },
      { id: 'subprocess-run', kind: 'qualified-call', callee: 'subprocess.run', category: 'command' },
    ],
    sanitizers: [
      { id: 'html-escape', kind: 'qualified-call', callee: 'html.escape', categories: ['xss'] },
      { id: 'shlex-quote', kind: 'qualified-call', callee: 'shlex.quote', categories: ['command'] },
    ],
  },
  {
    schemaVersion: 1,
    id: 'go-stdlib',
    version: '1',
    languages: [Language.Go],
    description: 'Go standard library: process arguments, process execution, trusted-HTML conversion.',
    sources: [
      { id: 'os-args', kind: 'field-read', path: 'os.Args' },
    ],
    sinks: [
      { id: 'exec-command', kind: 'qualified-call', callee: 'exec.Command', category: 'command' },
      { id: 'template-html', kind: 'qualified-call', callee: 'template.HTML', category: 'xss' },
    ],
    sanitizers: [
      { id: 'filepath-base', kind: 'qualified-call', callee: 'filepath.Base', categories: ['path'] },
      { id: 'html-escape-string', kind: 'qualified-call', callee: 'html.EscapeString', categories: ['xss'] },
    ],
  },
];
