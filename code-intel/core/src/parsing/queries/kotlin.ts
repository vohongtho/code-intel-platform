export const kotlinQueries = `
;; Class declaration (includes enum class via modifiers)
(class_declaration
  (identifier) @def.class.name) @def.class

;; Object declaration (companion objects, singletons)
(object_declaration
  (identifier) @def.class.name) @def.class.object

;; Function declaration (top-level and methods)
(function_declaration
  (identifier) @def.func.name) @def.func

;; Property declaration
(property_declaration
  (variable_declaration
    (identifier) @def.property.name)) @def.property
`;
