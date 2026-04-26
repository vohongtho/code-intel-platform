export const rubyQueries = `
;; Class
(class
  name: (constant) @def.class.name) @def.class

;; Module
(module
  name: (constant) @def.module.name) @def.module

;; Method
(method
  name: (identifier) @def.method.name) @def.method

;; Singleton method
(singleton_method
  name: (identifier) @def.method.name) @def.method.static

;; Assignment
(assignment
  left: (identifier) @def.var.name) @def.var

;; Require
(call
  method: (identifier) @_method
  arguments: (argument_list (string) @imp.source)
  (#match? @_method "^require"))

;; Call
(call
  method: (identifier) @call.name) @call

;; Superclass
(superclass
  (constant) @inherit.extends)
`;
