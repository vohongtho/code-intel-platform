export const rustQueries = `
;; Function item
(function_item
  name: (identifier) @def.func.name) @def.func

;; Struct item
(struct_item
  name: (type_identifier) @def.struct.name) @def.struct

;; Enum item
(enum_item
  name: (type_identifier) @def.enum.name) @def.enum

;; Trait item
(trait_item
  name: (type_identifier) @def.trait.name) @def.trait

;; Impl item
(impl_item
  type: (type_identifier) @def.class.name) @def.impl

;; Type alias
(type_item
  name: (type_identifier) @def.type_alias.name) @def.type_alias

;; Use declaration
(use_declaration
  argument: (_) @imp.source) @imp

;; Call
(call_expression
  function: (identifier) @call.name) @call

;; Method call
(call_expression
  function: (field_expression
    field: (field_identifier) @call.method)) @call.member

;; Const item
(const_item
  name: (identifier) @def.constant.name) @def.constant

;; Static item
(static_item
  name: (identifier) @def.var.name) @def.var
`;
