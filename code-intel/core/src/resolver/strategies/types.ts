export interface ResolveStrategy {
  name: string;
  resolve(rawPath: string, fromFile: string, context: ResolveContext): string | null;
}

export interface ResolveContext {
  workspaceRoot: string;
  fileExists(filePath: string): boolean;
  resolve(fromDir: string, relativePath: string): string | null;
  findByPackage(packageName: string): string | null;
}
