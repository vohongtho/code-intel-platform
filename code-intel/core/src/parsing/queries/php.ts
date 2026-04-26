export const phpQueries = `
;; Class declaration
(class_declaration
  name: (name) @def.class.name) @def.class

;; Interface declaration
(interface_declaration
  name: (name) @def.interface.name) @def.interface

;; Trait declaration
(trait_declaration
  name: (name) @def.trait.name) @def.trait

;; Function definition
(function_definition
  name: (name) @def.func.name) @def.func

;; Method declaration
(method_declaration
  name: (name) @def.method.name) @def.method

;; Property declaration
(property_declaration
  (property_element
    (variable_name) @def.property.name)) @def.property

;; Namespace definition
(namespace_definition
  name: (namespace_name) @def.namespace.name) @def.namespace

;; Use declaration (import)
(namespace_use_declaration
  (namespace_use_clause
    (qualified_name) @imp.source)) @imp

;; Include/require
(include_expression
  (_) @imp.source) @imp.include

;; Function call
(function_call_expression
  function: (name) @call.name) @call

;; Method call
(member_call_expression
  name: (name) @call.method) @call.member

;; Object creation
(object_creation_expression
  (name) @call.constructor) @call.new

;; Class base clause
(base_clause
  (name) @inherit.extends)

;; Class interface clause
(class_interface_clause
  (name) @inherit.implements)
`;
