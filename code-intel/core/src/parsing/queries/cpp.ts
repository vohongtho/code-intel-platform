export const cppQueries = `
;; Class specifier
(class_specifier
  name: (type_identifier) @def.class.name) @def.class

;; Struct specifier
(struct_specifier
  name: (type_identifier) @def.struct.name) @def.struct

;; Function definition
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @def.func.name)) @def.func

;; Namespace definition
(namespace_definition
  name: (identifier) @def.namespace.name) @def.namespace

;; Template declaration
(template_declaration
  (class_specifier
    name: (type_identifier) @def.class.name)) @def.class.template

;; Include
(preproc_include
  path: (_) @imp.source) @imp

;; Call
(call_expression
  function: (identifier) @call.name) @call

;; Member call
(call_expression
  function: (field_expression
    field: (field_identifier) @call.method)) @call.member

;; Base class clause
(base_class_clause
  (type_identifier) @inherit.extends)

;; Enum
(enum_specifier
  name: (type_identifier) @def.enum.name) @def.enum
`;
