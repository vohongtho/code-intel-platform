export const pythonQueries = `
;; Class definition
(class_definition
  name: (identifier) @def.class.name) @def.class

;; Function definition
(function_definition
  name: (identifier) @def.func.name) @def.func

;; Decorated definition
(decorated_definition
  (function_definition
    name: (identifier) @def.func.name)) @def.func.decorated

;; Import from
(import_from_statement
  module_name: (dotted_name) @imp.source) @imp

;; Import
(import_statement
  name: (dotted_name) @imp.module) @imp.direct

;; Import alias
(aliased_import
  name: (dotted_name) @imp.alias.original
  alias: (identifier) @imp.alias.name)

;; Call expression
(call
  function: (identifier) @call.name) @call

;; Attribute call
(call
  function: (attribute
    object: (_) @call.receiver
    attribute: (identifier) @call.method)) @call.member

;; Assignment
(assignment
  left: (identifier) @def.var.name) @def.var

;; Class base classes
(class_definition
  superclasses: (argument_list
    (identifier) @inherit.extends))
`;
