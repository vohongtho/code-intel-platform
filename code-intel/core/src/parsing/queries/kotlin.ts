export const kotlinQueries = `
;; Class declaration
(class_declaration
  (type_identifier) @def.class.name) @def.class

;; Object declaration
(object_declaration
  (type_identifier) @def.class.name) @def.class.object

;; Interface declaration  
(class_declaration
  (type_identifier) @def.interface.name) @def.interface

;; Function declaration
(function_declaration
  (simple_identifier) @def.func.name) @def.func

;; Property declaration
(property_declaration
  (variable_declaration
    (simple_identifier) @def.property.name)) @def.property

;; Import
(import_header
  (identifier) @imp.source) @imp

;; Call
(call_expression
  (simple_identifier) @call.name) @call

;; Navigation call
(call_expression
  (navigation_expression
    (simple_identifier) @call.method)) @call.member

;; Delegation specifier (extends/implements)
(delegation_specifier
  (user_type
    (type_identifier) @inherit.extends))
`;
