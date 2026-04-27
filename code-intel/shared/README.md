# @code-intel/shared

Shared TypeScript types for the [Code Intelligence Platform](https://github.com/vohongtho/code-intel-platform).

## Exports

- `NodeKind` — union of all node types (`function`, `class`, `file`, `interface`, `enum`, `method`, `struct`, `trait`, `type_alias`, `constant`, `variable`, `module`, `namespace`, `cluster`, `flow`, `route`, `directory`)
- `EdgeKind` — union of all edge types (`calls`, `imports`, `extends`, `implements`, `contains`, `has_member`, `belongs_to`, `step_of`)
- `CodeNode` — knowledge graph node shape (id, kind, name, filePath, startLine, endLine, exported, content, metadata)
- `CodeEdge` — knowledge graph edge shape (id, source, target, kind, weight, label)
- `Language` — enum of 14 supported languages (TypeScript, JavaScript, Python, Java, Go, Rust, C, Cpp, CSharp, PHP, Kotlin, Ruby, Swift, Dart)
- `detectLanguage(filePath)` — detect language from file extension
- `getSupportedExtensions()` — list all supported file extensions

## Install

```bash
npm install code-intel-shared
```

## License

MIT
