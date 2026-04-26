export interface ImportBinding {
  localName: string;
  sourcePath: string;
  exportedName: string;
  isDefault: boolean;
  isNamespace: boolean;
}

export class BindingTracker {
  private bindings = new Map<string, Map<string, ImportBinding>>();

  addBinding(filePath: string, binding: ImportBinding): void {
    let fileBindings = this.bindings.get(filePath);
    if (!fileBindings) {
      fileBindings = new Map();
      this.bindings.set(filePath, fileBindings);
    }
    fileBindings.set(binding.localName, binding);
  }

  getBinding(filePath: string, localName: string): ImportBinding | undefined {
    return this.bindings.get(filePath)?.get(localName);
  }

  getFileBindings(filePath: string): ImportBinding[] {
    const fileBindings = this.bindings.get(filePath);
    return fileBindings ? [...fileBindings.values()] : [];
  }

  clear(): void {
    this.bindings.clear();
  }
}
