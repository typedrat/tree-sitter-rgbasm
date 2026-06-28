; Comments
(comment) @comment
(block_comment) @comment

; Instructions / mnemonics
(mnemonic) @function.builtin
(branch_mnemonic) @function.builtin

; Registers and special operands
(register) @variable.builtin
(register_increment) @variable.builtin
(condition_code) @constant.builtin
(program_counter) @constant.builtin

; All directive/block keywords (MACRO/ENDM/IF/ENDC/FOR/ENDR/etc.)
(_ keyword: _ @keyword.directive)

; Generic directives (PRINT/ASSERT/OPT/WARN/…)
(directive_keyword) @keyword.directive

; Section type and modifier
(section_type) @type.builtin
(section_modifier) @keyword.directive

; Labels — more specific than bare (identifier) @variable
(label_definition name: (identifier) @label)
(label_definition name: (local_label) @label)
(anonymous_label) @label
(anonymous_label_ref) @label

; Macro invocation name
(macro_invocation name: (identifier) @function)

; Built-in function calls (DEF(), HIGH(), LOW(), …)
(call_expression function: (identifier) @function.builtin)

; Macro arguments (\1, \2, \@, …)
(macro_argument) @parameter

; Identifiers / local labels — fallback after more specific rules above
(identifier) @variable
(local_label) @variable

; Number literals
(decimal) @number
(hex) @number
(octal) @number
(binary) @number
(fixed_point) @number
(graphics_constant) @number
(char_constant) @character

; String literals
(string) @string
(raw_string) @string
(multiline_string) @string
(raw_multiline_string) @string
(escape_sequence) @string.escape
(format_spec) @string.special

; Operators
(binary_expression operator: _ @operator)
(unary_expression operator: _ @operator)

; Punctuation
["[" "]" "(" ")"] @punctuation.bracket
["[[" "]]"] @punctuation.bracket
["," ":" "::"] @punctuation.delimiter
(interpolation) @punctuation.special
