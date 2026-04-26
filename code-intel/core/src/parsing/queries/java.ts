export const javaQueries = `
;; Class declaration
(class_declaration
  name: (identifier) @def.class.name) @def.class

;; Interface declaration
(interface_declaration
  name: (identifier) @def.interface.name) @def.interface

;; Enum declaration
(enum_declaration
  name: (identifier) @def.enum.name) @def.enum

;; Method declaration
(method_declaration
  name: (identifier) @def.method.name) @def.method

;; Constructor declaration
(constructor_declaration
  name: (identifier) @def.constructor.name) @def.constructor

;; Field declaration
(field_declaration
  declarator: (variable_declarator
    name: (identifier) @def.property.name)) @def.property

;; Import
(import_declaration
  (scoped_identifier) @imp.source) @imp

;; Call
(method_invocation
  name: (identifier) @call.name) @call

;; Object creation
(object_creation_expression
  type: (type_identifier) @call.constructor) @call.new

;; Extends
(superclass (type_identifier) @inherit.extends)

;; Implements
(super_interfaces
  (type_list (type_identifier) @inherit.implements))
`;
