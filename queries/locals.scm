; Scopes
(macro_definition) @local.scope
(rept_block) @local.scope
(for_block) @local.scope
(if_block) @local.scope

; Definitions
(label_definition name: (identifier) @local.definition)
(label_definition name: (local_label) @local.definition)
(define_directive name: (identifier) @local.definition)
(macro_definition name: (identifier) @local.definition)
(for_block variable: (identifier) @local.definition)

; References
(identifier) @local.reference
