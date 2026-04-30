export const javascriptQueries = `
;; Function declaration
(function_declaration
  name: (identifier) @def.func.name) @def.func

;; Arrow function in variable
(lexical_declaration
  (variable_declarator
    name: (identifier) @def.func.name
    value: (arrow_function))) @def.func

;; Const/let/var variable (non-function, SCREAMING_SNAKE_CASE only — kept for constants)
(lexical_declaration
  (variable_declarator
    name: (identifier) @def.var.name
    value: (_) @def.var.value)) @def.var

;; Class declaration (JS uses identifier, not type_identifier)
(class_declaration
  name: (identifier) @def.class.name) @def.class

;; Method definition
(method_definition
  name: (property_identifier) @def.method.name) @def.method

;; Public field definition (JS uses field_definition with property: field, not name:)
(field_definition
  property: (property_identifier) @def.property.name) @def.property

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
`;
