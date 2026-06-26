# tree-sitter-rgbasm — Phase 2 Design

**Date:** 2026-06-26
**Status:** Approved (pending spec review)
**Builds on:** Phase 1 (merged to `main`, commit `2c38202`).
**Reference:** [rgbasm(5) v0.9.4](https://rgbds.gbdev.io/docs/v0.9.4/rgbasm.5)
(authoritative source: the rgbasm(5) man page, sections "Symbol
interpolation", "Numeric formats", "String expressions", "Character maps",
"Labels"/"Anonymous labels", "THE MACRO LANGUAGE").

## 1. Goal

Extend the Phase 1 grammar with the "exotic" surface-syntax features that were
deliberately deferred, **except** those whose cost is dominated by grammar
structure rather than lexing. The grammar continues to parse **surface syntax as
written** — it does not model preprocessor text substitution (macro expansion,
`EQUS` pasting, the runtime *result* of interpolation). Recognizing
interpolation/macro-arg *syntax* so editors can highlight it is in scope;
evaluating it is not.

## 2. Scope

### In scope (Phase 2)

| # | Feature | Mechanism |
|---|---------|-----------|
| 1 | Graphics constants `` `01012323 `` | grammar token (new `_number` alt) |
| 2 | Charmap directives (structured): `CHARMAP` / `NEWCHARMAP` / `SETCHARMAP` / `PUSHC` / `POPC` | grammar rules (replace generic fallback) |
| 3 | Single-line raw strings `#"…"` | grammar token |
| 4 | Anonymous labels — define `:`, reference `:+` / `:-` / `:++` / `:--` | grammar rules |
| 5 | Symbol interpolation `{sym}` / `{fmt:sym}` — inside strings **and** in symbol-name positions | recursive grammar rule + `_symbol` |
| 6 | Macro-arg tokens recognized inside strings (`\1`–`\9`, `\@`, `\#`, `\<…>`) | restructured `string` rule |
| 7 | Multi-line strings `"""…"""` | **external scanner** + grammar |
| 8 | Triple-quoted raw strings `#"""…"""` | **external scanner** + grammar |

### Out of scope (deferred to a later phase)

- **Fragment literals `[[ … ]]`.** These nest arbitrarily and embed *full
  statements inline in an expression position*, which collides with the
  grammar's line-oriented (`\n`-separated) statement model and the `::`
  separator. An external scanner does **not** materially reduce this cost
  (the cost is grammar restructuring, not lexing), so they are deferred whole.
- The semantic *result* of any interpolation/expansion (assembler concern).
- `OPT g<chars>` custom graphics glyph sets (see Known limitations).

## 3. Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| External scanner | **Introduce a small, stateless `src/scanner.c`** | The only context-free-but-not-regular constructs in scope are the triple-quoted string terminators. A scanner makes them clean; it is standard (all bindings + nvim/Helix/Zed compile `scanner.c` automatically). |
| Scanner surface area | **Two external tokens, content-runs only** | The scanner produces only multi-line string *content*; opening/closing `"""`/`#"""` stay ordinary literal tokens. Keeps the scanner ~stateless (no nesting counters) and the grammar in charge of structure. |
| Interpolation inside `"""…"""` | **Yes — same interleaving as single-line** | Avoids a jarring inconsistency where `{d:x}` highlights in `"…"` but not `"""…"""`. Costs ~15 lines of extra stop-conditions in the scan loop. |
| Interpolation depth | **Strings + name-building** | rgbasm allows `{…}` to build symbol names (`DEF {name}`, `MACRO {name}`, `PURGE {name}`, `Color{i}_data`), not only inside strings. A shared recursive `interpolation` rule plus a `_symbol` wrapper covers both. |
| Graphics constant width | **Lenient: one or more of `[0-3]`** | The assembler requires exactly 8, but a lenient token avoids false `ERROR` nodes on malformed input and is more robust than guessing widths; width validation is a linter concern, not the parser's. Custom `OPT g` glyph sets still won't match (documented). |
| Charmap directives | **Promote to structured rules** | Phase 1 parsed them via the permissive generic `directive` fallback. Phase 2 gives them real argument shapes and removes them from `directive_keyword`. |

## 4. Grammar changes (scanner-free features)

### 4.1 Graphics constants

```js
graphics_constant: $ => token(/`[0-3]+/),
```

Added as a new alternative in `_number`. Backtick is otherwise unused in the
grammar, so it is unambiguous. Valid anywhere a number is. The token is lenient
on width (one or more digits) rather than enforcing the assembler's required 8
— width is a semantic check, not a parsing one.

### 4.2 Charmap directives

A new `charmap_directive` rule, added to `_line_body`. The five keywords are
**removed** from `directive_keyword` so they no longer fall through to the
generic rule:

```
CHARMAP    "str", val [, val …]     ; string + one-or-more integer values
NEWCHARMAP name [, basename]
SETCHARMAP name
PUSHC      [name]                   ; one-arg form exists in v0.9.4
POPC                                ; no args
```

`val`s are `_expression`; `name`/`basename` are `_symbol` (§4.5). The mapping
string accepts any string form (§4.4).

### 4.3 Single-line raw strings

```js
raw_string: $ => token(/#"[^"\n]*"/),
```

Opaque — no escapes, no interpolation (matches rgbasm raw-string semantics).
Unambiguous because identifiers cannot *start* with `#`. Added to the shared
`_string` choice (§4.4), so it is accepted everywhere a string value is
(operands, `INCLUDE`, section/`LOAD` names, `CHARMAP` mapping, …).

### 4.4 String restructuring + a shared `_string` choice

Single-line normal strings become a sequence of interleaved pieces so that
interpolation, escapes, and macro-arg tokens are individually highlightable:

```js
string: $ => seq('"',
  repeat(choice($._string_content, $.escape_sequence, $.interpolation, $.macro_argument)),
  token.immediate('"')),
_string_content: $ => token.immediate(/[^"\\{\n]+/),   // now also breaks on '{'
escape_sequence: $ => token.immediate(/\\['"{}\\nrt0]/), // unchanged; already covers \{ \}
```

A shared `_string` rule collects every string form for use at value sites:

```js
_string: $ => choice($.string, $.raw_string, $.multiline_string, $.raw_multiline_string),
```

Existing references to `$.string` at value positions (INCLUDE, SECTION/LOAD
names, etc.) move to `$._string`.

### 4.5 Symbol interpolation + name-building

One recursive `interpolation` rule, reused inside strings and in name positions:

```js
interpolation:  $ => seq('{', optional($.format_spec), $._interp_symbol, '}'),
// format_spec swallows its trailing ':' so {X} (symbol) vs {x:Y} (fmt+symbol)
// disambiguates with no lexer conflict, and nesting {{x}} / {fmt:{x}} works.
format_spec:    $ => token(/[+ ]?#?-?0?[0-9]*(\.[0-9]+)?(q[0-9]+)?[duxXbofs]:/),
_interp_symbol: $ => repeat1(choice($._interp_name_part, $.interpolation)),
```

**Name-building.** A new `interpolated_identifier` glues identifier fragments and
interpolations with **no whitespace** (`token.immediate`), and `_symbol` wraps
the choice:

```js
// immediate sequence of (identifier fragment | interpolation), containing ≥1 interpolation
interpolated_identifier: $ => /* … */,
_symbol: $ => choice($.identifier, $.interpolated_identifier),
```

`_symbol` replaces `$.identifier` at: expression references, `DEF`/`REDEF` name,
`MACRO` name, `PURGE`/`EXPORT` list entries, macro-invocation name, and
label-definition name. This covers `DEF {name}`, `MACRO {name}`, `PURGE {name}`,
`Color{i}_data`, and — via expressions — `DEF({name})`.

### 4.6 Anonymous labels

```js
anonymous_label:     $ => ':',              // bare colon: a label definition with no name
anonymous_label_ref: $ => token(/:[-+]+/),  // :+ :++ :- :-- … (an expression atom)
```

- `anonymous_label` joins the `label_definition` choice.
- `anonymous_label_ref` joins `_expression`.
- Disambiguation is purely lexical longest-match: the existing `::`
  (export/separator) token and the `:[-+]+` ref token both out-rank a bare `:`;
  the ref requires ≥1 `+`/`-`, so it never collides with a definition colon.

## 5. Scanner design (`src/scanner.c`)

Two external tokens, declared in `externals`:

```js
externals: $ => [$._ml_string_content, $._raw_ml_string_content],
```

The scanner handles **only** the triple-quoted forms; single-line `"…"` /
`#"…"` stay entirely in the grammar. Opening/closing `"""` and `#"""` are
ordinary literal tokens — the scanner produces only the content runs:

```js
multiline_string: $ => seq('"""',
  repeat(choice($._ml_string_content, $.escape_sequence, $.interpolation, $.macro_argument)),
  '"""'),
raw_multiline_string: $ => seq('#"""', optional($._raw_ml_string_content), '"""'),
```

- **`_ml_string_content`** (non-raw): consume characters, stopping before
  `"""`, `{`, or `\`. The grammar then interleaves
  `interpolation` / `escape_sequence` / `macro_argument`, so `{d:x}` and `\n`
  highlight inside `"""…"""` exactly as in single-line strings.
- **`_raw_ml_string_content`** (raw): opaque — consume everything until `"""`.

The scanner is **stateless**: `create`/`destroy` allocate nothing,
`serialize`/`deserialize` are no-ops. The scan loop is a `while` over the
lookahead with a 3-character `"""` check and the stop-conditions above. It must
return `false` (no token) when zero characters are consumed, so an empty
`""""""` resolves via the literal close.

**Known edge case — validate during implementation:** `extras` (block comments,
line continuations) at a content/interpolation boundary inside a triple-quoted
string. Add corpus cases; fix if it misbehaves, otherwise document as a
limitation.

## 6. Queries

Both query sets (`queries/` nvim/Helix, `queries/zed/`) gain captures for the
new node types, following the existing capture vocabulary:

- `highlights.scm`: `interpolation` (and `format_spec`), `graphics_constant`
  (as a number), `raw_string` / `multiline_string` / `raw_multiline_string`
  (as strings), `anonymous_label` / `anonymous_label_ref`, and the
  `charmap_directive` keyword fields (via the existing `keyword:` field
  mechanism).
- Other query files (`locals`/`outline`, `folds`/`indents`, `textobjects`,
  `injections`, Zed `brackets`/`overrides`) are reviewed for relevance and
  updated only where a new node changes scoping or structure.

## 7. Testing

- **Corpus tests** in the existing `test/corpus/` style — one new or extended
  file per feature (graphics constants → `numbers.txt`; charmap → `directives.txt`
  or a new `charmap.txt`; raw/multiline/interpolation → `strings.txt`; anonymous
  labels → `labels.txt`). Cover nesting (`{{x}}`, `{fmt:{x}}`), name-building
  (`Color{i}_data`, `DEF {name}`), multi-line content with embedded `"`/`""`,
  raw vs non-raw, and the anonymous define/reference disambiguation.
- **Smoke run**: `no-errors.sh` over the sample corpus must stay at **0 errors**.
- **Query compilation**: all query files in both sets must compile.
- **Phase-1 carry-over** (from the progress ledger): also add the three deferred
  Phase-1 corpus cases — keyword-prefix label (`ENDM_LOOP:`), empty macro body
  (`MACRO foo` / `ENDM`), and `FOR n, 256` two-arg short form.

## 8. Known limitations (Phase 2)

- **Custom graphics glyphs:** `graphics_constant` accepts the default `0-3`
  set with lenient width; `OPT g<chars>` redefinitions won't match, and the
  assembler's exact-8-digits rule is not enforced (same class of accepted
  limitation as Phase 1's globally-reserved section-type keywords).
- **Fragment literals `[[ … ]]`** remain unparsed (deferred — §2).
- **Interpolation/macro-arg highlighting is syntactic only** — the grammar
  recognizes the forms but does not expand them.
- **`extras` inside triple-quoted strings** at piece boundaries — see §5.
