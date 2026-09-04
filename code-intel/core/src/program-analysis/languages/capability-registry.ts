/**
 * languages/capability-registry.ts
 *
 * Per-language program-analysis capability rows (task 15). Every stage
 * past `ir` (cfg, dominators, reaching-definitions, function-summary, pdg,
 * taint) is pure universal-IR/CFG machinery with no per-language code at
 * all — so a language's capability across all seven axes is exactly the
 * quality of its lowering table (`lowering-tables.ts`), never
 * independently better or worse at one stage than another. That's why
 * every row below repeats the same state seven times rather than varying
 * axis by axis: it's an honest reflection of the architecture, not a
 * simplification.
 *
 * States, and what backs each one:
 *  - 'supported': the lowering table's node types were confirmed against a
 *    real parse with this repo's bundled grammar, AND the language has a
 *    passing real-parse integration test (tests/unit/program-analysis/
 *    languages/generic-lowering.test.ts) exercising conditional/switch/
 *    try/loop constructs end to end.
 *  - 'partial': the grammar loads and the table is real-parse-informed,
 *    but no automated integration test runs against it here (Kotlin,
 *    Swift — both hit a pre-existing wasm-path resolution bug in this
 *    dev environment's `getLanguage()` helper when not loading the wasm
 *    file directly; unrelated to this change, not fixed here), or the
 *    grammar itself never parsed at all so the table is best-effort by
 *    grammar-convention analogy only (Dart).
 *  - 'not-applicable': no function bodies to lower (HTML) — embedded
 *    scripts are handled by their own executable-language adapter, not
 *    HTML's.
 */
import { Language } from '../../shared/languages.js';
import type { CapabilityState } from '../../languages/capability-types.js';
import type { ProgramAnalysisCapabilityDescriptor, ProgramAnalysisCapabilityMatrix } from '../contracts.js';
import { getLoweringTable } from './lowering-tables.js';

function uniform(state: CapabilityState): ProgramAnalysisCapabilityMatrix {
  return { ir: state, cfg: state, dominators: state, reachingDefinitions: state, functionSummary: state, pdg: state, taint: state };
}

const SUPPORTED = uniform('supported');
const PARTIAL = uniform('partial');
const NOT_APPLICABLE = uniform('not-applicable');

function descriptor(entry: ProgramAnalysisCapabilityDescriptor): ProgramAnalysisCapabilityDescriptor {
  return Object.freeze(entry);
}

export const PROGRAM_ANALYSIS_CAPABILITY_REGISTRY: readonly ProgramAnalysisCapabilityDescriptor[] = [
  descriptor({ language: Language.TypeScript, adapterId: 'typescript', loweringVersion: 'typescript-lowering-v1', capabilities: SUPPORTED }),
  descriptor({ language: Language.JavaScript, adapterId: 'javascript', loweringVersion: 'javascript-lowering-v1', capabilities: SUPPORTED }),
  descriptor({ language: Language.Python, adapterId: 'python', loweringVersion: 'python-lowering-v1', capabilities: SUPPORTED }),
  descriptor({ language: Language.Java, adapterId: 'java', loweringVersion: 'java-lowering-v1', capabilities: SUPPORTED }),
  descriptor({ language: Language.Go, adapterId: 'go', loweringVersion: 'go-lowering-v1', capabilities: SUPPORTED }),
  descriptor({ language: Language.C, adapterId: 'c', loweringVersion: 'c-lowering-v1', capabilities: SUPPORTED }),
  descriptor({ language: Language.Cpp, adapterId: 'cpp', loweringVersion: 'cpp-lowering-v1', capabilities: SUPPORTED }),
  descriptor({ language: Language.CSharp, adapterId: 'csharp', loweringVersion: 'csharp-lowering-v1', capabilities: SUPPORTED }),
  descriptor({ language: Language.Rust, adapterId: 'rust', loweringVersion: 'rust-lowering-v1', capabilities: SUPPORTED }),
  descriptor({ language: Language.PHP, adapterId: 'php', loweringVersion: 'php-lowering-v1', capabilities: SUPPORTED }),
  descriptor({ language: Language.Ruby, adapterId: 'ruby', loweringVersion: 'ruby-lowering-v1', capabilities: SUPPORTED }),
  descriptor({ language: Language.Kotlin, adapterId: 'kotlin', loweringVersion: 'kotlin-lowering-v1', capabilities: PARTIAL }),
  descriptor({ language: Language.Swift, adapterId: 'swift', loweringVersion: 'swift-lowering-v1', capabilities: PARTIAL }),
  descriptor({ language: Language.Dart, adapterId: 'dart', loweringVersion: 'dart-lowering-v1', capabilities: PARTIAL }),
  descriptor({ language: Language.HTML, adapterId: 'html', loweringVersion: 'n/a', capabilities: NOT_APPLICABLE }),
];

const REGISTRY_BY_LANGUAGE = new Map(PROGRAM_ANALYSIS_CAPABILITY_REGISTRY.map((entry) => [entry.language, entry]));

export function getProgramAnalysisCapability(language: Language): ProgramAnalysisCapabilityDescriptor {
  const found = REGISTRY_BY_LANGUAGE.get(language);
  if (!found) throw new Error(`Missing program-analysis capability descriptor for ${language}`);
  return found;
}

export function isProgramAnalysisEnabled(language: Language): boolean {
  return getProgramAnalysisCapability(language).capabilities.ir === 'supported';
}

/**
 * Validates the registry's own bookkeeping (one row per known language, no
 * duplicates) and its consistency with the lowering engine: a 'supported'
 * or 'partial' row must have a real lowering table to back it, and
 * 'not-applicable' must not.
 */
export function validateProgramAnalysisCapabilityRegistry(
  descriptors: readonly ProgramAnalysisCapabilityDescriptor[] = PROGRAM_ANALYSIS_CAPABILITY_REGISTRY,
): void {
  const seen = new Set<Language>();
  for (const entry of descriptors) {
    if (seen.has(entry.language)) throw new Error(`Duplicate program-analysis capability descriptor: ${entry.language}`);
    seen.add(entry.language);

    const hasTable = getLoweringTable(entry.language) !== null;
    if (entry.capabilities.ir === 'not-applicable') {
      if (hasTable) throw new Error(`${entry.language} is marked not-applicable but has a lowering table`);
    } else if (!hasTable) {
      throw new Error(`${entry.language} is marked '${entry.capabilities.ir}' but has no lowering table`);
    }
  }

  const languages = Object.values(Language);
  if (descriptors.length !== languages.length) {
    throw new Error(`Expected ${languages.length} program-analysis capability descriptors, received ${descriptors.length}`);
  }
  for (const language of languages) {
    if (!seen.has(language)) throw new Error(`Missing program-analysis capability descriptor: ${language}`);
  }
}

validateProgramAnalysisCapabilityRegistry();
