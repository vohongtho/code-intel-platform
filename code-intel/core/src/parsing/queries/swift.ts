export const swiftQueries = `
;; In tree-sitter-swift, structs/classes/enums/actors all use class_declaration.
;; Distinguish them with a keyword anchor.

;; Struct declaration
(class_declaration "struct"
  (type_identifier) @def.struct.name) @def.struct

;; Class declaration
(class_declaration "class"
  (type_identifier) @def.class.name) @def.class

;; Enum declaration
(class_declaration "enum"
  (type_identifier) @def.enum.name) @def.enum

;; Protocol declaration
(protocol_declaration
  (type_identifier) @def.interface.name) @def.interface

;; Function declaration (no name: field in this grammar; positional match)
(function_declaration
  (simple_identifier) @def.func.name) @def.func

;; Property declaration
(property_declaration
  (pattern
    (simple_identifier) @def.property.name)) @def.property
`;
