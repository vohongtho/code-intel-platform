export const cQueries = `
;; Function definition
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @def.func.name)) @def.func

;; Struct specifier
(struct_specifier
  name: (type_identifier) @def.struct.name) @def.struct

;; Enum specifier
(enum_specifier
  name: (type_identifier) @def.enum.name) @def.enum

;; Typedef
(type_definition
  declarator: (type_identifier) @def.type_alias.name) @def.type_alias

;; Include
(preproc_include
  path: (_) @imp.source) @imp

;; Call
(call_expression
  function: (identifier) @call.name) @call

;; Global variable
(declaration
  declarator: (init_declarator
    declarator: (identifier) @def.var.name)) @def.var
`;
