export const htmlQueries = `
;; Element IDs become addressable properties.
(element
  (start_tag
    (attribute
      (attribute_name) @def.property.attr
      (quoted_attribute_value (attribute_value) @def.property.name))) @def.property
  (#eq? @def.property.attr "id"))

;; Class tokens become addressable properties.
(element
  (start_tag
    (attribute
      (attribute_name) @def.property.attr
      (quoted_attribute_value (attribute_value) @def.property.name))) @def.property.class
  (#eq? @def.property.attr "class"))

;; Linked resources.
(element
  (start_tag
    (tag_name) @def.module.tag
    (attribute
      (attribute_name) @def.module.attr
      (quoted_attribute_value (attribute_value) @def.module.name))) @def.module
  (#eq? @def.module.tag "link")
  (#eq? @def.module.attr "href"))

(script_element
  (start_tag
    (attribute
      (attribute_name) @def.module.attr
      (quoted_attribute_value (attribute_value) @def.module.name))) @def.module
  (#eq? @def.module.attr "src"))

;; Navigation / form targets.
(element
  (start_tag
    (tag_name) @def.var.tag
    (attribute
      (attribute_name) @def.var.attr
      (quoted_attribute_value (attribute_value) @def.var.name))) @def.var
  (#eq? @def.var.tag "a")
  (#eq? @def.var.attr "href"))

(element
  (start_tag
    (tag_name) @def.var.tag
    (attribute
      (attribute_name) @def.var.attr
      (quoted_attribute_value (attribute_value) @def.var.name))) @def.var
  (#eq? @def.var.tag "form")
  (#eq? @def.var.attr "action"))

;; Embedded script ranges.
(script_element
  (raw_text) @def.var.name) @def.var
`;
