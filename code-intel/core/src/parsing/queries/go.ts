export const goQueries = `
;; Function declaration
(function_declaration
  name: (identifier) @def.func.name) @def.func

;; Method declaration
(method_declaration
  name: (field_identifier) @def.method.name) @def.method

;; Type declaration — struct
(type_declaration
  (type_spec
    name: (type_identifier) @def.struct.name
    type: (struct_type))) @def.struct

;; Type declaration — interface
(type_declaration
  (type_spec
    name: (type_identifier) @def.interface.name
    type: (interface_type))) @def.interface

;; Import spec
(import_spec
  path: (interpreted_string_literal) @imp.source) @imp

;; Call expression
(call_expression
  function: (identifier) @call.name) @call

;; Selector call
(call_expression
  function: (selector_expression
    operand: (_) @call.receiver
    field: (field_identifier) @call.method)) @call.member

;; Const declaration
(const_declaration
  (const_spec
    name: (identifier) @def.constant.name)) @def.constant

;; Var declaration
(var_declaration
  (var_spec
    name: (identifier) @def.var.name)) @def.var
`;
