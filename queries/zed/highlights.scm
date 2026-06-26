; Comments
(comment) @comment
(block_comment) @comment

; Instructions (Zed prefers @function, falls back to @keyword)
(mnemonic) @function @keyword
(branch_mnemonic) @function @keyword

; Registers and special operands
(register) @variable.special
(register_increment) @variable.special
(condition_code) @constant.builtin
(program_counter) @constant.builtin

; All directive/block keywords (MACRO/ENDM/IF/ENDC/FOR/ENDR/etc.)
(_ keyword: _ @preproc)

; Generic directives (PRINT/ASSERT/OPT/WARN/...)
(directive_keyword) @preproc

; Section type and modifier
(section_type) @constant.builtin
(section_modifier) @keyword

; Labels — more specific than bare (identifier) @variable
(label_definition name: (identifier) @label)
(label_definition name: (local_label) @label)

; Macro invocation name
(macro_invocation name: (identifier) @function)

; Built-in function calls (DEF(), HIGH(), LOW(), ...)
(call_expression function: (identifier) @function)

; Macro arguments (\1, \2, \@, ...)
(macro_argument) @variable.parameter

; Identifiers / local labels — fallback after more specific rules above
(identifier) @variable
(local_label) @variable

; Number literals
(decimal) @number
(hex) @number
(octal) @number
(binary) @number
(fixed_point) @number
(char_constant) @string.special

; String literals
(string) @string
(escape_sequence) @string.escape

; Operators
(binary_expression operator: _ @operator)
(unary_expression operator: _ @operator)

; Punctuation
["[" "]" "(" ")"] @punctuation.bracket
["," ":" "::"] @punctuation.delimiter
