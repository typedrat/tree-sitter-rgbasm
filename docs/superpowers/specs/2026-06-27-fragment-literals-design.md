# tree-sitter-rgbasm — Fragment Literals Design

**Date:** 2026-06-27
**Status:** Approved
**Depends on:** Phase 2 (complete)

## 1. Goal

Implement RGBDS fragment literals `[[ … ]]`, the one feature explicitly
deferred from Phase 2. A fragment literal wraps **instructions or directives**
(full statements, including labels), appears in **expression position** (any
16-bit integer constant or `DW` item — e.g. the operand of `call`/`jp`/`dw`),
evaluates to the fragment's start address, and **nests arbitrarily**.

Delivering this faithfully first requires generalizing the `::` separator,
which RGBDS documents as separating *instructions and data directives* on one
line — the current grammar only chains instructions. The two changes are one
cohesive unit of work: fragment bodies reuse the same statement/`::`
machinery, so they get `::` support for free once it is generalized.

As with the rest of the grammar: recognize **syntax only**. Fragment literals
become real, structured nodes; their linker semantics (the implicit
`SECTION FRAGMENT`, start-address value) are not modeled.

## 2. Scope

### In scope
- **`::` generalization** — `::` separates instructions *and* data directives
  on one line, including a mix (`ld a, b :: db 3`). The label-export `::`
  (`Label::`) is unchanged.
- **`fragment_literal`** — a new `_expression` alternative, `[[ <statements> ]]`,
  with a recursive, newline-separated statement body; nests arbitrarily; legal
  in every expression position via the single `_expression` insertion.
- Corpus tests, query coverage (both query sets), README roadmap update.

### Out of scope / documented limitation
- **The docs' space-separated inline rewrite** (`call [[…]] jr [[…]]` with no
  newline or `::` between the two statements) is a documentation compression,
  not real syntax. Fragment bodies separate statements by **newlines** (and
  `::` within the instruction/data subset). This is a documented limitation.
- Linker/semantic results of a fragment (its address value, section merging).

## 3. Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| `::` chain element | **`instruction \| data_directive`** | Matches the rgbasm(5) rule verbatim; supports mixing. |
| `::` chain tree shape | **Hidden chain, no wrapper node** | `::` is a separator, not a grouping construct. Elements become direct, sibling children of `statement`. Lone `data_directive` trees stay identical; instruction trees drop the old `instruction_line` wrapper. No query depends on either node. |
| Fragment body fidelity | **Full recursive `statement` list** | Consistent with the grammar's structurally-rich, lenient philosophy: labels, instructions, data, directives, and nested `[[…]]` all get real nodes. Nesting falls out of the `statement → _expression → fragment_literal` recursion. |
| Fragment placement | **One alternative in `_expression`** | `_expression` already flows into operands, `mem_access` interiors, data arguments, and branch targets — one insertion covers every legal site with no per-site edits. |
| `[[` / `]]` lexing | **Literal tokens** | Tree-sitter longest-match makes `[[` beat `[` (mem_access) and `]]` beat `]` when adjacent, so `ld a, [ [[ db 20 ]] ]` parses as a `mem_access` containing a `fragment_literal`. |
| GLR conflicts | **Resolve empirically via `conflicts:`** | The `statement ↔ expression` recursion and the export-`::` vs separator-`::` overlap surface conflicts at `generate` time; resolve iteratively (the Phase 2 workflow), not by guessing up front. |
| Empty `[[ ]]` | **Allowed** | `optional` body; avoids false `ERROR` on a degenerate-but-harmless input, matching the grammar's leniency. |

## 4. Grammar changes

### 4.1 `::` generalization

Replace, in `_line_body`, the `$.instruction_line` and standalone
`$.data_directive` alternatives with a single hidden chain:

```js
// _line_body choice: `$.instruction_line` and `$.data_directive` → `$._code_line`
_code_line: ($) => seq($._code_element, repeat(seq('::', $._code_element))),
_code_element: ($) => choice($.instruction, $.data_directive),
```

- Delete the `instruction_line` rule.
- Keep the `data_directive` rule (now reached only via `_code_line`).
- `_code_line`/`_code_element` are hidden (`_`-prefixed), so a statement's
  instructions/data directives appear as its direct children.

Resulting trees:

```
nop              → (statement (instruction (mnemonic)))
ld a,b :: ld c,d → (statement (instruction …) (instruction …))
db 1             → (statement (data_directive …))            ; UNCHANGED
db 1 :: db 2     → (statement (data_directive …) (data_directive …))
ld a,b :: db 3   → (statement (instruction …) (data_directive …))
```

### 4.2 `fragment_literal`

Add to the `_expression` choice (next to the other compound forms):

```js
$.fragment_literal,
```

Add the rule:

```js
// Inline section fragment: [[ statements ]] in expression position.
// Body is a newline-separated statement list (reusing `statement`), so inner
// labels/instructions/data/directives and nested `[[…]]` are fully structured.
fragment_literal: ($) =>
  seq(
    '[[',
    repeat('\n'),
    optional(seq(
      $.statement,
      repeat(seq(repeat1('\n'), $.statement)),
      repeat('\n'),
    )),
    ']]',
  ),
```

The body mirrors `source_file`'s statement-list shape: it accepts the inline
single-statement form (`[[ db 1 ]]`, zero newlines), the multi-line form, and
the empty `[[ ]]`. The fragment's internal `\n` tokens are bounded by the
brackets, so they never collide with the outer line's statement terminator.

## 5. Component map

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `_code_line` / `_code_element` | `::`-chain of instructions/data directives | `instruction`, `data_directive` |
| `fragment_literal` | `[[ … ]]` wrapper around a statement list | `statement` (recursive), `[[`/`]]` tokens |
| `_expression` insertion | makes fragments legal in every value site | `fragment_literal` |
| Query updates | highlight/fold/textobject the new bracket node | node `fragment_literal` |

## 6. Testing

- **Corpus — `::`:** de-wrap existing `instruction_line` expected trees
  (`instructions.txt`, `blocks.txt`, `branches.txt`, `lexing.txt`,
  `labels.txt`); add `db 1 :: db 2` and `ld a, b :: db 3` cases.
- **Corpus — fragments:** inline (`dw [[ db 1 ]]`), multi-line, nested
  (`call [[ … [[ … ]] … ]]`), inside a `mem_access` (`ld a, [ [[ db 20 ]] ]`),
  and as a `call`/`jp` target. Reconcile expected trees against
  `npx tree-sitter parse` for hidden-node rendering; an `ERROR`/`MISSING` node
  is a real failure.
- **Smoke:** `bash test/no-errors.sh` stays at 0 errors; extend a
  `test/highlight/` sample with a fragment literal.
- **Queries:** every `.scm` in `queries/` and `queries/zed/` compiles via
  `npx tree-sitter query -p . <file> <sample>`.

## 7. Query coverage

Both query sets (`queries/`, `queries/zed/`):
- `[[` / `]]` → `@punctuation.bracket` (Zed: matching vocabulary).
- Multi-line `fragment_literal` → fold (`queries/folds.scm`,
  `queries/zed/*` as applicable).
- Optional textobject for the fragment body.
- No new captures for *inner* statements — they are ordinary `statement`
  descendants already covered by existing queries.

## 8. Documentation

`README.md`: move fragment literals out of "Deferred / future work" into the
supported list; note that `::` now separates data directives as well as
instructions; keep the inline-rewrite caveat from §2 as a known limitation.
