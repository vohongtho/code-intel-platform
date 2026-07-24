export const SETTINGS_SECTIONS = [
  'overview',
  'llm',
  'embeddings',
  'analysis',
  'server',
  'authentication',
  'updates',
  'telemetry',
] as const;

export type SettingsSection = typeof SETTINGS_SECTIONS[number];

export function isSettingsSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

export function getSettingsSectionFromPath(pathname: string): SettingsSection | null {
  const match = pathname.match(/^\/settings(?:\/([^/]+))?\/?$/);
  if (!match) return null;
  const section = match[1] ?? 'overview';
  return isSettingsSection(section) ? section : 'overview';
}

export function getSettingsPath(section: SettingsSection = 'overview'): string {
  return `/settings/${section}`;
}

export function navigateTo(path: string, replace = false): void {
  const fn = replace ? window.history.replaceState : window.history.pushState;
  fn.call(window.history, {}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
