export const dartQueries = `
;; Class definition (includes abstract classes)
(class_definition
  name: (identifier) @def.class.name) @def.class

;; Enum declaration
(enum_declaration
  name: (identifier) @def.enum.name) @def.enum

;; Function / method signatures (top-level functions and class methods)
;; tree-sitter-dart uses function_signature for both
(function_signature
  name: (identifier) @def.func.name) @def.func
`;
