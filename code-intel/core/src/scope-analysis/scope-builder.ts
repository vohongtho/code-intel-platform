export interface Scope {
  name: string;
  kind: 'module' | 'function' | 'block' | 'class';
  parent: Scope | null;
  bindings: Map<string, ScopeBinding>;
  children: Scope[];
}

export interface ScopeBinding {
  name: string;
  nodeId: string;
  kind: 'variable' | 'function' | 'class' | 'parameter' | 'import';
}

export function createScope(
  name: string,
  kind: Scope['kind'],
  parent: Scope | null = null,
): Scope {
  const scope: Scope = { name, kind, parent, bindings: new Map(), children: [] };
  parent?.children.push(scope);
  return scope;
}

export function resolveBinding(name: string, scope: Scope): ScopeBinding | null {
  let current: Scope | null = scope;
  while (current !== null) {
    const binding = current.bindings.get(name);
    if (binding) return binding;
    current = current.parent;
  }
  return null;
}

export function addBinding(scope: Scope, binding: ScopeBinding): void {
  scope.bindings.set(binding.name, binding);
}
