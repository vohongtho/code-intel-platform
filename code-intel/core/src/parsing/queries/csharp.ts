export const csharpQueries = `
;; Class declaration
(class_declaration
  name: (identifier) @def.class.name) @def.class

;; Interface declaration
(interface_declaration
  name: (identifier) @def.interface.name) @def.interface

;; Struct declaration
(struct_declaration
  name: (identifier) @def.struct.name) @def.struct

;; Enum declaration
(enum_declaration
  name: (identifier) @def.enum.name) @def.enum

;; Method declaration
(method_declaration
  name: (identifier) @def.method.name) @def.method

;; Constructor declaration
(constructor_declaration
  name: (identifier) @def.constructor.name) @def.constructor

;; Property declaration
(property_declaration
  name: (identifier) @def.property.name) @def.property

;; Namespace declaration
(namespace_declaration
  name: (_) @def.namespace.name) @def.namespace

;; Using directive
(using_directive
  (qualified_name) @imp.source) @imp

;; Invocation
(invocation_expression
  function: (identifier) @call.name) @call

;; Member invocation
(invocation_expression
  function: (member_access_expression
    name: (identifier) @call.method)) @call.member

;; Object creation
(object_creation_expression
  type: (identifier) @call.constructor) @call.new

;; Base list (extends/implements)
(base_list
  (identifier) @inherit.extends)
`;
