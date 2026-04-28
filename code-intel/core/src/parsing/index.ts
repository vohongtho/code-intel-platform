export { initParser, getParser, getLanguage, parseSource, isTreeSitterAvailable } from './parser-manager.js';
export { runQuery, runQueryMatches } from './query-runner.js';
export type { QueryCapture, QueryMatch } from './query-runner.js';
export { AstCache } from './ast-cache.js';
