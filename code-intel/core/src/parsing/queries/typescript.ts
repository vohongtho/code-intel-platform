export const typescriptQueries = `
;; Class declaration
(class_declaration
  name: (type_identifier) @def.class.name) @def.class

;; Abstract class
(abstract_class_declaration
  name: (type_identifier) @def.class.name) @def.class

;; Interface declaration
(interface_declaration
  name: (type_identifier) @def.interface.name) @def.interface

;; Type alias
(type_alias_declaration
  name: (type_identifier) @def.type_alias.name) @def.type_alias

;; Enum
(enum_declaration
  name: (identifier) @def.enum.name) @def.enum

;; Function declaration
(function_declaration
  name: (identifier) @def.func.name) @def.func

;; Arrow function in variable
(lexical_declaration
  (variable_declarator
    name: (identifier) @def.func.name
    value: (arrow_function))) @def.func

;; Const/let/var variable (non-function)
(lexical_declaration
  (variable_declarator
    name: (identifier) @def.var.name
    value: (_) @def.var.value)) @def.var

;; Method definition
(method_definition
  name: (property_identifier) @def.method.name) @def.method

;; Public field definition
(public_field_definition
  name: (property_identifier) @def.property.name) @def.property

;; Import statement
(import_statement
  source: (string) @imp.source) @imp

;; Import specifier
(import_specifier
  name: (identifier) @imp.name)

;; Namespace import
(namespace_import (identifier) @imp.namespace)

;; Export statement
(export_statement) @export

;; Call expression — function call
(call_expression
  function: (identifier) @call.name) @call

;; Call expression — member call
(call_expression
  function: (member_expression
    object: (_) @call.receiver
    property: (property_identifier) @call.method)) @call.member

;; New expression
(new_expression
  constructor: (identifier) @call.constructor) @call.new

;; Class heritage — extends
(class_heritage
  (extends_clause
    value: (identifier) @inherit.extends))

;; Class heritage — implements
(class_heritage
  (implements_clause
    (type_reference (type_identifier) @inherit.implements)))
`;
