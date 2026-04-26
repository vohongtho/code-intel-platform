# @code-intel/shared

Shared TypeScript types for the [Code Intelligence Platform](https://github.com/your-username/code-intel-platform).

## Exports

- `NodeKind` — union of all node types (`function`, `class`, `file`, `interface`, `enum`, etc.)
- `EdgeKind` — union of all edge types (`calls`, `imports`, `extends`, `implements`, etc.)
- `CodeNode` — knowledge graph node shape
- `CodeEdge` — knowledge graph edge shape
- `Language` — enum of supported languages
- `detectLanguage(filePath)` — detect language from file extension
- `getSupportedExtensions()` — list all supported file extensions

## Install

```bash
npm install @code-intel/shared
```

## License

MIT
