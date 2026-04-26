export const swiftQueries = `
;; Class declaration
(class_declaration
  name: (type_identifier) @def.class.name) @def.class

;; Struct declaration
(struct_declaration
  name: (type_identifier) @def.struct.name) @def.struct

;; Protocol declaration
(protocol_declaration
  name: (type_identifier) @def.interface.name) @def.interface

;; Enum declaration
(enum_declaration
  name: (type_identifier) @def.enum.name) @def.enum

;; Function declaration
(function_declaration
  name: (simple_identifier) @def.func.name) @def.func

;; Property declaration
(property_declaration
  (pattern
    (simple_identifier) @def.property.name)) @def.property

;; Import
(import_declaration
  (identifier) @imp.source) @imp

;; Call
(call_expression
  (simple_identifier) @call.name) @call

;; Inheritance
(inheritance_specifier
  (type_identifier) @inherit.extends)
`;
