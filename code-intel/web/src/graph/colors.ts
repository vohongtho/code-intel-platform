import type { NodeKind, EdgeKind } from 'code-intel-shared';

// Full-spectrum palette — based on design spec
export const NODE_COLORS: Record<NodeKind, string> = {
  function:    '#22D3EE',  // Cyan       — primary logic
  file:        '#FB923C',  // Orange     — container
  class:       '#4ADE80',  // Green      — structural
  interface:   '#A78BFA',  // Purple     — abstract
  enum:        '#6366F1',  // Indigo     — structured constants
  constant:    '#FACC15',  // Yellow     — small/subtle
  type_alias:  '#FB7185',  // Pink       — rare highlight
  flow:        '#14B8A6',  // Teal       — execution path

  // Additional types — distinct but harmonious
  method:      '#38BDF8',  // Sky blue   (sibling to function)
  constructor: '#06B6D4',  // Cyan-dark
  struct:      '#86EFAC',  // Light green (sibling to class)
  trait:       '#C4B5FD',  // Lavender   (sibling to interface)
  variable:    '#FDE68A',  // Light amber (sibling to constant)
  property:    '#FCA5A5',  // Light red  (sibling to type_alias)
  namespace:   '#818CF8',  // Indigo-light (sibling to enum)
  module:      '#E879F9',  // Fuchsia
  route:       '#F87171',  // Red

  // Meta/structural
  cluster:     '#64748B',  // Slate gray
  directory:   '#475569',  // Dark slate
};

export const EDGE_COLORS: Record<EdgeKind, string> = {
  contains:   '#334155',
  calls:      '#38bdf8',
  imports:    '#64748b',
  extends:    '#4ade80',
  implements: '#f97316',
  has_member: '#facc15',
  accesses:   '#06b6d4',
  overrides:  '#ef4444',
  belongs_to: '#475569',
  step_of:    '#fb923c',
  handles:    '#fb7185',
};

export const EDGE_ALPHA: Record<EdgeKind, number> = {
  contains:   0.08,
  calls:      0.55,
  imports:    0.25,
  extends:    0.50,
  implements: 0.45,
  has_member: 0.18,
  accesses:   0.30,
  overrides:  0.45,
  belongs_to: 0.10,
  step_of:    0.35,
  handles:    0.40,
};

export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}
