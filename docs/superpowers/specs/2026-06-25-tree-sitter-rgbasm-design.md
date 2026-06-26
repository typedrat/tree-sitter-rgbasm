# tree-sitter-rgbasm — Design

**Date:** 2026-06-25
**Status:** Approved (pending spec review)
**Reference:** [rgbasm(5) v1.0.1](https://rgbds.gbdev.io/docs/v1.0.1/rgbasm.5),
[gbz80(7) v1.0.1](https://rgbds.gbdev.io/docs/v1.0.1/gbz80.7)
(authoritative source: the man-page roff in `gbdev/rgbds` at tag `v1.0.1`).

## 1. Goal

A [tree-sitter](https://tree-sitter.github.io/) grammar for the RGBASM assembly
language (RGBDS v1.0.1), suitable for editor integration (Neovim, Helix, etc.):
syntax highlighting, code folding, indentation, and symbol navigation.

The grammar parses **surface syntax as written**. It deliberately does *not*
model RGBASM's preprocessor-style text substitution (macro expansion, `EQUS`
pasting, symbol interpolation), since those are not expressible in a context-free
grammar and are an assembler concern, not an editor-tooling one.

## 2. Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Instruction operands | **Generic** (mnemonic + comma-separated operand expressions) | Robust — never rejects valid code; tree-sitter is not a validator. Semantic per-instruction typing (~90 rules) adds nothing to editor queries and breaks on macro-expanded operands. |
| Condition vs register `c` | Lightweight mnemonic-group awareness | Recognize the 4 conditional-branch mnemonics so a leading `c`/`nc`/`z`/`nz` is tagged a condition. No full operand typing needed. |
| Coverage | **Core subset first** (Phase 1); exotic preprocessor syntax deferred to Phase 2 | Smaller, shippable first cut. |
| External scanner | **None in Phase 1** | Line structure handled with an explicit newline token + `extras`. Scanner deferred to Phase 2 features that need it. |
| Macro-arg escapes | Minimal lexical token in Phase 1 | `\1`/`\@`/etc. recognized (highlightable) but without interpolation semantics, so real macro bodies parse cleanly. |

### Why generic operands still support every editor query

Every standard query file keys off lexical tokens and structural nesting, never
off per-instruction operand validity:

| Query | Keys off | Needs instruction semantics? |
|-------|----------|------------------------------|
| `highlights.scm` | node types (mnemonic, register, condition, number, …) | No |
| `locals.scm` | symbol definitions vs references; scopes | No (symbols, not operands) |
| `injections.scm` | regions to hand to another parser | No |
| `folds.scm` / `indents.scm` | block-directive nesting | No |
| `textobjects.scm` | macro bodies, label ranges | No |

Semantic operand typing only buys operand-shape *validation*, which is an
LSP/linter concern.

## 3. Scope

### In scope (Phase 1 — "core subset")

- **Comments**: line (`;…`) and block (`/* … */`, non-nested).
- **Line continuations**: `\` at end of line.
- **Labels**: global (`Name:` / `Name::`), local (`.loop`, colon optional),
  scoped (`Parent.child:` / `::`). Two colons = define + export.
- **Instructions**: any mnemonic + comma-separated operands; `::` instruction
  separator; registers (`a b c d e h l af bc de hl sp pc`) and condition codes
  (`z nz c nc`) as recognized tokens.
- **Memory access operands**: `[expr]`, plus `[hl+]`/`[hli]`/`[hl-]`/`[hld]`.
- **Directives**:
  - `SECTION` + section types (`ROM0 ROMX VRAM SRAM WRAM0 WRAMX OAM HRAM`) +
    options (`BANK[…]`, `ALIGN[…]`), and the `UNION`/`FRAGMENT` modifiers.
  - Data: `DB` `DW` `DL` `DS` (with or without args).
  - File inclusion: `INCLUDE`, `INCBIN`.
  - Symbol definition: `DEF`/`REDEF` with `EQU`/`EQUS`/`=`/compound assignments
    and the RS group (`RB`/`RW`/`RL`/`RSSET`/`RSRESET`); `EXPORT`, `PURGE`.
  - **Block** directives (named nodes): `MACRO`/`ENDM`, `REPT`/`ENDR`,
    `FOR`/`ENDR`, `IF`/`ELIF`/`ELSE`/`ENDC`, `UNION`/`NEXTU`/`ENDU`,
    `LOAD`/`ENDL`.
  - Simpler keyword directives via a generic fallback rule: `PRINT`/`PRINTLN`,
    `ASSERT`/`STATIC_ASSERT`, `FAIL`/`WARN`, `OPT`/`PUSHO`/`POPO`,
    `PUSHS`/`POPS`, `BREAK`, `SHIFT`, `ENDSECTION`, etc.
- **Macro invocations**: bare name at line start + comma-separated args.
- **Numbers**: decimal, hex (`$`, `0x`/`0X`), octal (`&`, `0o`/`0O`), binary
  (`%`, `0b`/`0B`), fixed-point (`1.5`, `1.5q8`), char constants (`'A'`),
  with `_` digit separators.
- **Strings**: `"…"` with escape sequences (`\\ \" \' \{ \} \n \r \t \0`).
- **Macro-arg tokens**: `\1`–`\9`, `\<…>`, `\@`, `\#`, `\,`, `\(`, `\)`
  (recognized lexically, highlightable, no interpolation semantics).
- **Expressions**: full operator-precedence ladder, grouping, unary ops,
  generic `FUNC(args)` calls (covers `HIGH`/`LOW`/`BANK`/`DEF`/`SIN`/`STRLEN`/…),
  `@` PC symbol, symbol references. String operators `++`, `===`, `!==`.

### Out of scope (Phase 2 — documented roadmap, not implemented)

Symbol interpolation `{fmt:sym}`, raw strings (`#"…"`), multi-line strings
(`"""…"""`), fragment literals `[[ … ]]`, anonymous labels (`:+`/`:-`),
Game-Boy graphics constants (`` `01012323 ``), charmap directives
(`CHARMAP`/`NEWCHARMAP`/`SETCHARMAP`/`PUSHC`/`POPC`), and **full** macro-arg
interpolation semantics. These will likely require an external scanner.

## 4. Repository layout

```
tree-sitter-rgbasm/
├── grammar.js              # hand-written grammar DSL
├── tree-sitter.json        # CLI metadata: name=rgbasm, scope=source.rgbasm, ext .asm/.inc
├── package.json            # tree-sitter-cli pinned as devDependency (no global install)
├── queries/
│   ├── highlights.scm
│   ├── locals.scm
│   ├── injections.scm
│   ├── folds.scm
│   └── indents.scm
├── test/corpus/            # *.txt parse-tree regression tests, split by area
├── src/                    # GENERATED: parser.c, grammar.json, node-types.json
├── bindings/               # GENERATED by `tree-sitter init`
├── README.md
├── LICENSE                 # MIT
├── .gitignore
└── .editorconfig
```

Scaffolded with `tree-sitter init`. Build/verify with `npx tree-sitter generate`
and `npx tree-sitter test`.

## 5. Lexer strategy (no external scanner in Phase 1)

RGBASM is line-based, so newlines are significant.

- `\n` is an **explicit terminator token** separating statements.
- **Block comments**, **line continuations** (`\` + newline), and horizontal
  whitespace are `extras` (regex tokens) — skipped anywhere, including
  mid-statement, without terminating a line.
- `::` (instruction separator) is a distinct token, kept apart from the label
  `:`/`::` tokens by parse state.
- Keywords (directives, mnemonics, registers, conditions, section types) are
  **case-insensitive**; identifiers are case-sensitive. Case-insensitive keyword
  tokens are built with a small `ci()` helper producing the appropriate regex.

## 6. Node taxonomy

```
source_file
  └─ (statement)*                          # separated by newline tokens

statement →
  label_definition? (directive | instruction_line | macro_invocation)?

label_definition   → (identifier | local_label) ('::' | ':')?
instruction_line   → instruction ('::' instruction)*
instruction        → mnemonic operand_list?                              # general
                   → branch_mnemonic (condition_code ',')? operand_list? # jr/jp/call/ret
operand            → register | mem_access | macro_argument | expression
mem_access         → '[' (register_inc | expression) ']'                 # [hl+], [hli], [expr]

# block directives — named nodes drive folds / indents / textobjects
macro_definition → 'MACRO' identifier NL (statement)* 'ENDM'
rept_block       → 'REPT' expression NL (statement)* 'ENDR'
for_block        → 'FOR' identifier ',' expression_list NL (statement)* 'ENDR'
if_block         → 'IF' expression NL (statement)* elif_clause* else_clause? 'ENDC'
elif_clause      → 'ELIF' expression NL (statement)*
else_clause      → 'ELSE' NL (statement)*
union_block      → 'UNION' NL (statement)* ('NEXTU' NL (statement)*)* 'ENDU'
load_block       → 'LOAD' section_arguments NL (statement)* 'ENDL'

# other directives
section_directive → 'SECTION' string ',' section_modifier? section_type
                      section_constraints?
data_directive    → ('DB' | 'DW' | 'DL' | 'DS') argument_list?
define_directive  → ('DEF' | 'REDEF') identifier
                      (assign_op | 'EQU' | 'EQUS' | 'RB' | 'RW' | 'RL') value
export_directive  → 'EXPORT' identifier (',' identifier)*
purge_directive   → 'PURGE' identifier (',' identifier)*
directive         → directive_keyword argument_list?                     # generic fallback

macro_invocation  → identifier argument_list?

# expressions
expression → number | string | identifier | '@'
           | parenthesized_expression | unary_expression
           | binary_expression | call_expression
call_expression       → identifier '(' argument_list? ')'
parenthesized_expression → '(' expression ')'
unary_expression      → ('+' | '-' | '~' | '!') expression
binary_expression     → expression OP expression          # full precedence ladder
number → decimal | hex | octal | binary | fixed_point | char_constant
```

### Operator precedence (high → low)

`**` (right-assoc) → unary `+ - ~ !` → `* / %` → `<< >> >>>` → `& | ^` →
`+ - ++` → comparisons (`== != < > <= >= === !==`) → `&&` → `||`.
Encoded with `prec.left` / `prec.right` and a precedence ladder.

### Condition / register `c` disambiguation

`register` and `condition_code` are separate tokens. tree-sitter's lexer is
parse-state-aware, so `c` lexes as `condition_code` only in the branch-mnemonic
first-operand slot and as `register` elsewhere. The single overlapping state
(first operand of `jp`/`call`, which accepts a condition, the register `hl`, or
an expression) is resolved with a declared `conflicts` entry, disambiguated by
the trailing comma.

## 7. Queries

- **highlights.scm** — mnemonics → `@function.builtin`/`@keyword`; registers →
  `@variable.builtin`; conditions → `@constant.builtin`; directives →
  `@keyword.directive`; numbers, strings, char constants, comments; labels →
  `@label`/`@function`; built-in functions → `@function.builtin`; macro args →
  `@parameter`.
- **locals.scm** — scopes (`macro_definition`, `rept_block`, `for_block`,
  `section_directive`); definitions (labels, `DEF`/`EQU`/`MACRO` names);
  references (identifiers in expressions). Local-label scoping modeled
  structurally.
- **folds.scm** / **indents.scm** — keyed on the block nodes in §6.
- **injections.scm** — minimal placeholder (no embedded languages in core).

## 8. Testing

`test/corpus/` split by area: `comments`, `labels`, `instructions`,
`expressions`, `numbers`, `strings`, `directives`, `sections`, `macros`,
`conditionals`. Standard tree-sitter corpus format (`=== name ===` / `---` /
expected s-expression). Plus a small set of real-world `.asm` snippets asserted
to parse with **no `ERROR` nodes** as a smoke test.

Definition of done: `npx tree-sitter generate` succeeds and `npx tree-sitter
test` passes with zero failures.

## 9. Known limitations (Phase 1)

Documented in the README roadmap: the Phase-2 items in §3 are not implemented.
Macro bodies that *interpolate* args, symbol interpolations, anonymous labels,
graphics constants, and charmap directives may not yet parse cleanly. Macro-arg
tokens are recognized lexically but carry no interpolation semantics.
