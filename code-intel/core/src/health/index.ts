export { detectDeadCode } from './dead-code.js';
export type { DeadCodeResult } from './dead-code.js';

export { detectCircularDeps } from './circular-deps.js';
export type { CycleResult } from './circular-deps.js';

export { detectGodNodes } from './god-nodes.js';
export type { GodNodeResult, GodNodeConfig } from './god-nodes.js';

export { detectOrphanFiles } from './orphan-files.js';
export type { OrphanFileResult } from './orphan-files.js';

export { computeHealthReport } from './health-score.js';
export type { HealthReport } from './health-score.js';
