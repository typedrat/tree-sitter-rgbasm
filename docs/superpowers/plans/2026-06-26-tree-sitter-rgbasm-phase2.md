# tree-sitter-rgbasm Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Phase 1 RGBASM grammar with graphics constants, structured charmap directives, raw/multi-line strings, symbol interpolation (in strings and symbol names), anonymous labels, and macro-arg recognition inside strings — adding a small stateless external scanner only for the triple-quoted string forms.

**Architecture:** Most features are pure `grammar.js` additions (token rules, `token.immediate`, recursive rules). Multi-line and triple-quoted-raw strings use a stateless `src/scanner.c` that emits only the *content runs*; their delimiters and structure stay in the grammar. Fragment literals `[[ … ]]` are explicitly deferred. Tasks are ordered by dependency: independent warm-ups → string/interpolation cluster → scanner → queries → final verification.

**Tech Stack:** tree-sitter grammar DSL (`grammar.js`), tree-sitter-cli 0.26.9 (pinned devDependency), C (external scanner), Scheme query files (`queries/`, `queries/zed/`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-26-tree-sitter-rgbasm-phase2-design.md` (read it before starting).
- **No preprocessor semantics:** recognize interpolation/macro-arg *syntax* only; never model expansion.
- **Hidden-rule convention (from Phase 1):** rules prefixed `_` are hidden (no node in the tree); `expression`/`number` are `_expression`/`_number`; operands/args appear **unwrapped** under their parent. New helper rules that should not appear in trees MUST be `_`-prefixed.
- **Keyword tokens stay prec 0:** keyword rules rely on longest-match + rule-definition order, NOT `prec`. Keyword token rules MUST be defined before `identifier`; `condition_code` before `register`. Do not reintroduce `prec` on keyword tokens.
- **Keyword highlighting mechanism:** directive/block keywords are exposed via a `keyword:` field implemented as `field('keyword', alias(kw(...), 'x_kw'))`. Query them with `(<rule> keyword: _ @cap)`. Do NOT use string-literal keyword captures.
- **Test commands:**
  - Regenerate parser: `npx tree-sitter generate`
  - Run all corpus tests: `npx tree-sitter test`
  - Run one corpus test: `npx tree-sitter test -i '<test name>'`
  - Inspect a parse: `npx tree-sitter parse <file.asm>` (or pipe a heredoc to a temp file)
  - Smoke (must stay 0 errors): `bash test/no-errors.sh`
  - Query compile check: `npx tree-sitter query -p . <query.scm> <file.asm>` (the `-p .` is required)
- **Expected trees in this plan are derived by hand.** After writing each failing test, run `npx tree-sitter test -i '<name>'`; if the *only* difference from the expected tree is hidden-node rendering (a wrapper that turned out hidden/visible), reconcile by running `npx tree-sitter parse` on the snippet and updating the expected block to match the real output — then continue. A structural mismatch (wrong nesting, ERROR/MISSING nodes) is a real failure to fix in the grammar.
- **Commit after every task** with a `feat:`/`test:` message scoped to that task. Do not push.

---

### Task 1: Graphics constants

Game Boy 2bpp pixel literals: a backtick followed by `0-3` digits, e.g. `` `01012323 ``. Lenient width (one or more digits — width is a semantic concern, not parsing).

**Files:**
- Modify: `grammar.js` (the `_number` rule and a new `graphics_constant` rule)
- Test: `test/corpus/numbers.txt` (append)

**Interfaces:**
- Consumes: existing `_number` choice.
- Produces: `graphics_constant` node (a `_number` alternative), token `/`[0-3]+/`.

- [ ] **Step 1: Write the failing test** — append to `test/corpus/numbers.txt`:

```
==================
graphics constant
==================
DW `01012323
DB `0123, `00112233
---

(source_file
  (statement (data_directive
    (argument_list (graphics_constant))))
  (statement (data_directive
    (argument_list (graphics_constant) (graphics_constant)))))
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx tree-sitter test -i 'graphics constant'`
Expected: FAIL (the backtick currently has no rule → ERROR node).

- [ ] **Step 3: Add the rule.** In `grammar.js`, change `_number` to include the new alternative, and add the `graphics_constant` rule next to the other number rules:

```js
    _number: ($) =>
      choice($.hex, $.octal, $.binary, $.fixed_point, $.decimal, $.graphics_constant, $.char_constant),
```

```js
    // Game Boy 2bpp graphics constant: backtick + pixel digits (default 0-3).
    // Lenient on width (assembler requires 8); OPT g custom glyphs unsupported.
    graphics_constant: ($) => token(/`[0-3]+/),
```

- [ ] **Step 4: Regenerate and test**

Run: `npx tree-sitter generate && npx tree-sitter test -i 'graphics constant'`
Expected: PASS.

- [ ] **Step 5: Full regression + smoke**

Run: `npx tree-sitter test && bash test/no-errors.sh`
Expected: all corpus tests PASS; smoke prints `OK:` for every file, exit 0.

- [ ] **Step 6: Commit**

```bash
git add grammar.js src/ test/corpus/numbers.txt
git commit -m "feat: add Game Boy graphics constants (\`0123)"
```

---

### Task 2: Anonymous labels

Definition is a bare colon `:` (a label with no name). Reference is a colon followed by one or more `+`/`-`: `:+` `:++` `:-` `:--`.

**Files:**
- Modify: `grammar.js` (`label_definition`, `_expression`, two new rules)
- Test: `test/corpus/labels.txt` (append)

**Interfaces:**
- Consumes: existing `label_definition` choice, `_expression` choice.
- Produces: `anonymous_label` node (in `label_definition`), `anonymous_label_ref` node (in `_expression`, token `/:[-+]+/`).

- [ ] **Step 1: Write the failing test** — append to `test/corpus/labels.txt`:

```
==================
anonymous labels
==================
:
    jr :+
    jr :-
:
    jp :++
---

(source_file
  (statement (label_definition (anonymous_label)))
  (statement (instruction (branch_mnemonic) (anonymous_label_ref)))
  (statement (instruction (branch_mnemonic) (anonymous_label_ref)))
  (statement (label_definition (anonymous_label)))
  (statement (instruction (branch_mnemonic) (anonymous_label_ref))))
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx tree-sitter test -i 'anonymous labels'`
Expected: FAIL (bare `:` and `:+` unrecognized → ERROR).

- [ ] **Step 3: Add the rules.** In `grammar.js`:

Add `anonymous_label` to the `label_definition` choice (as a new alternative):

```js
    label_definition: ($) =>
      choice(
        // Global/scoped labels require a colon (distinguishes from macro calls).
        seq(field('name', $.identifier), repeat($.macro_argument), choice('::', ':')),
        // Local labels may omit the colon.
        seq(field('name', $.local_label), repeat($.macro_argument), optional(choice('::', ':'))),
        // Anonymous label definition: a bare colon, no name.
        $.anonymous_label,
      ),

    anonymous_label: ($) => ':',
```

Add `anonymous_label_ref` to `_expression` (insert near `program_counter`):

```js
        $.program_counter,
        $.anonymous_label_ref,
```

```js
    // Anonymous label reference: ':' followed by one or more '+'/'-'.
    // The '+'/'-' run is required, so this never collides with a bare ':'.
    anonymous_label_ref: ($) => token(/:[-+]+/),
```

- [ ] **Step 4: Regenerate and test**

Run: `npx tree-sitter generate && npx tree-sitter test -i 'anonymous labels'`
Expected: PASS. If `tree-sitter generate` reports a conflict involving `:` / `::`, add to the grammar's `conflicts` array (create it if absent, just before `rules:`):

```js
  conflicts: ($) => [
    // bare ':' anonymous-label def vs ':' / '::' label colon
    [$.anonymous_label, $.label_definition],
  ],
```
Re-run generate + test until PASS. (Note: `::` and `:[-+]+` out-rank bare `:` by longest-match, so the conflict is only at the parser level, resolved by this declaration.)

- [ ] **Step 5: Full regression + smoke**

Run: `npx tree-sitter test && bash test/no-errors.sh`
Expected: all PASS, smoke exit 0.

- [ ] **Step 6: Commit**

```bash
git add grammar.js src/ test/corpus/labels.txt
git commit -m "feat: add anonymous labels (: definition, :+/:- references)"
```

---

### Task 3: Single-line raw strings + shared `_string` choice

Raw strings `#"…"` are opaque (no escapes, no interpolation). This task also introduces a hidden `_string` choice used at every string value site, so later tasks can extend the set of string forms in one place.

**Files:**
- Modify: `grammar.js` (new `raw_string`, new hidden `_string`, migrate value sites, add `raw_string` to `_expression`)
- Test: `test/corpus/strings.txt` (append)

**Interfaces:**
- Consumes: existing `string` rule and its current call sites (`include_directive`, `section_directive` name, `load_block` name, `_expression`).
- Produces: `raw_string` node (token `/#"[^"\n]*"/`); hidden `_string` = `choice($.string, $.raw_string)` (extended by Tasks 6/7).

- [ ] **Step 1: Write the failing test** — append to `test/corpus/strings.txt`:

```
==================
raw string
==================
DB #"\t\1{s}", "x"
INCLUDE #"path\to\file.inc"
---

(source_file
  (statement (data_directive
    (argument_list (raw_string) (string))))
  (statement (include_directive (raw_string))))
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx tree-sitter test -i 'raw string'`
Expected: FAIL (`#"…"` unrecognized; also `INCLUDE` only accepts `$.string` so the raw form errors).

- [ ] **Step 3: Add `raw_string` and the `_string` choice; migrate value sites.** In `grammar.js`:

```js
    // Raw string: opaque, no escapes or interpolation. Cannot contain '"'.
    raw_string: ($) => token(/#"[^"\n]*"/),

    // All single-line string forms. Extended with multi-line forms in later tasks.
    _string: ($) => choice($.string, $.raw_string),
```

Add `raw_string` to `_expression` (next to `$.string`):

```js
        $._number,
        $.string,
        $.raw_string,
```

Replace `$.string` with `$._string` at these value sites:
- `include_directive`: `seq(field('keyword', alias(kw('INCLUDE'), 'include_kw')), $._string)`
- `section_directive` name: `field('name', $._string)`
- `load_block` name: `field('name', $._string)`

(Leave the bare `$.string` alternative in `_expression` as-is and add `$.raw_string` beside it — `_expression` lists the concrete forms directly rather than via `_string`, matching the existing style.)

- [ ] **Step 4: Regenerate and test**

Run: `npx tree-sitter generate && npx tree-sitter test -i 'raw string'`
Expected: PASS.

- [ ] **Step 5: Full regression + smoke**

Run: `npx tree-sitter test && bash test/no-errors.sh`
Expected: all PASS, smoke exit 0.

- [ ] **Step 6: Commit**

```bash
git add grammar.js src/ test/corpus/strings.txt
git commit -m "feat: add single-line raw strings and shared _string choice"
```

---

### Task 4: Symbol interpolation + macro-args inside strings

Restructure normal `string` so interpolation `{sym}` / `{fmt:sym}`, escapes, and macro-arg tokens are individually parsed and highlightable. Adds the recursive `interpolation` rule reused by Tasks 5 and 7.

**Files:**
- Modify: `grammar.js` (`string`, `_string_content`, add `interpolation`, `format_spec`, `_interp_symbol`, `_interp_name_part`)
- Test: `test/corpus/strings.txt` (append)

**Interfaces:**
- Consumes: existing `string`, `escape_sequence`, `macro_argument`.
- Produces: `interpolation` node = `seq('{', optional($.format_spec), $._interp_symbol, '}')`; `format_spec` token (includes trailing `:`); hidden `_interp_symbol` = `repeat1(choice($._interp_name_part, $.interpolation))`. `string` body now interleaves `_string_content | escape_sequence | interpolation | macro_argument`.

- [ ] **Step 1: Write the failing test** — append to `test/corpus/strings.txt`:

```
==================
string interpolation
==================
PRINTLN "sum = {d:TOTAL}"
PRINTLN "raw {SYM} and {{nested}} and arg \1"
---

(source_file
  (statement (directive
    (argument_list (string (interpolation (format_spec))))))
  (statement (directive
    (argument_list (string
      (interpolation)
      (interpolation (interpolation))
      (macro_argument))))))
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx tree-sitter test -i 'string interpolation'`
Expected: FAIL (`{…}` currently lexes as part of string content; no `interpolation` node).

- [ ] **Step 3: Restructure the string rules.** In `grammar.js`, replace the existing `string`, `_string_content`, `escape_sequence` block with:

```js
    string: ($) =>
      seq(
        '"',
        repeat(choice($._string_content, $.escape_sequence, $.interpolation, $.macro_argument)),
        token.immediate('"'),
      ),
    // Now also breaks on '{' so interpolation can start.
    _string_content: ($) => token.immediate(prec(1, /[^"\\{\n]+/)),
    escape_sequence: ($) => token.immediate(/\\['"{}\\nrt0]/),

    // {sym} or {fmt:sym}; nests as {{sym}} / {fmt:{sym}}.
    interpolation: ($) => seq('{', optional($.format_spec), $._interp_symbol, '}'),
    // The format spec swallows its trailing ':' so {X} (symbol) and {x:Y}
    // (fmt + symbol) disambiguate at the lexer with no conflict.
    format_spec: ($) => token(/[+ ]?#?-?0?[0-9]*(\.[0-9]+)?(q[0-9]+)?[duxXbofs]:/),
    _interp_symbol: ($) => repeat1(choice($._interp_name_part, $.interpolation)),
    _interp_name_part: ($) => token(/[A-Za-z0-9_#$@.]+/),
```

- [ ] **Step 4: Regenerate and test**

Run: `npx tree-sitter generate && npx tree-sitter test -i 'string interpolation'`
Expected: PASS. Also re-run the earlier string tests: `npx tree-sitter test -i 'string'` — the `string with escapes` and `raw string` cases must still PASS (raw strings are opaque, unaffected).

- [ ] **Step 5: Full regression + smoke**

Run: `npx tree-sitter test && bash test/no-errors.sh`
Expected: all PASS, smoke exit 0. (`test/highlight/macros.asm` contains `WARN "debug build"` and macro bodies — confirm no regressions.)

- [ ] **Step 6: Commit**

```bash
git add grammar.js src/ test/corpus/strings.txt
git commit -m "feat: parse symbol interpolation and macro-args inside strings"
```

---

### Task 5: Name-building interpolation (`_symbol` / `interpolated_identifier`)

Allow `{…}` in symbol-name positions: `DEF {name}`, `MACRO {name}`, `PURGE {name}`, embedded `Color{i}_data`, and (via expressions) references. Reuses the `interpolation` rule from Task 4.

**Files:**
- Modify: `grammar.js` (add `_symbol`, `interpolated_identifier`, immediate helpers; migrate symbol sites; likely a `conflicts` entry)
- Test: `test/corpus/expressions.txt` and `test/corpus/directives.txt` (append)

**Interfaces:**
- Consumes: `identifier`, `interpolation` (Task 4), `format_spec`, `_interp_symbol`.
- Produces: hidden `_symbol` = `choice($.identifier, $.interpolation, $.interpolated_identifier)`; `interpolated_identifier` node = a no-whitespace sequence gluing an `identifier`/`interpolation` head with ≥1 immediate `interpolation`/id-fragment piece.

- [ ] **Step 1: Write the failing tests.**

Append to `test/corpus/directives.txt`:

```
==================
interpolated symbol names
==================
DEF {name} = 1
PURGE {prefix}_table
MACRO {macro_name}
ENDM
---

(source_file
  (statement (define_directive
    (interpolation)
    (decimal)))
  (statement (purge_directive
    (interpolated_identifier (interpolation))))
  (statement (macro_definition
    (interpolation))))
```

Append to `test/corpus/expressions.txt`:

```
==================
interpolated identifier reference
==================
DB Color{i}_data
---

(source_file
  (statement (data_directive
    (argument_list
      (interpolated_identifier (interpolation))))))
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx tree-sitter test -i 'interpolated'`
Expected: FAIL (`{name}` in name positions and `Color{i}_data` not recognized).

- [ ] **Step 3: Add `_symbol` and `interpolated_identifier`; migrate sites.** In `grammar.js`:

```js
    // A symbol name: plain, a pure {interpolation}, or fragments+interpolations
    // glued with no whitespace.
    _symbol: ($) => choice($.identifier, $.interpolation, $.interpolated_identifier),

    interpolated_identifier: ($) =>
      seq(
        choice($.identifier, $.interpolation),
        repeat1(choice(
          alias($._immediate_interpolation, $.interpolation),
          $._immediate_id_fragment,
        )),
      ),
    _immediate_interpolation: ($) =>
      seq(token.immediate('{'), optional($.format_spec), $._interp_symbol, '}'),
    _immediate_id_fragment: ($) => token.immediate(/[A-Za-z0-9_#$@.]+/),
```

Migrate these sites from `$.identifier` to `$._symbol`:
- `define_directive` `field('name', ...)`
- `macro_definition` `field('name', ...)`
- `purge_directive` list: `sepByComma($._symbol)`
- `export_directive` list: `sepByComma($._symbol)`
- `macro_invocation` `field('name', ...)`
- `_expression`: add `$.interpolation` and `$.interpolated_identifier` as alternatives beside `$.identifier`.

Leave `label_definition` names as `$.identifier` for now (label interpolation is rarer and increases conflict surface; revisit only if a corpus case needs it).

- [ ] **Step 4: Regenerate and resolve conflicts.**

Run: `npx tree-sitter generate`
If it reports a conflict such as `identifier` vs `interpolated_identifier` (both can start a `_symbol`), add to `conflicts`:

```js
  conflicts: ($) => [
    // ... any earlier entries ...
    [$.identifier, $.interpolated_identifier],
  ],
```
Re-run `npx tree-sitter generate` until clean. Then `npx tree-sitter test -i 'interpolated'`.
Expected: PASS. If the parse nests differently than the expected blocks (e.g. `macro_invocation` vs `interpolated_identifier` ambiguity on `{macro_name}`), inspect with `npx tree-sitter parse` on the snippet and reconcile the expected tree; a remaining ERROR/MISSING node is a real failure — adjust precedence (e.g. `prec` on `interpolated_identifier`) and retry.

- [ ] **Step 5: Full regression + smoke**

Run: `npx tree-sitter test && bash test/no-errors.sh`
Expected: all PASS, smoke exit 0.

- [ ] **Step 6: Commit**

```bash
git add grammar.js src/ test/corpus/directives.txt test/corpus/expressions.txt
git commit -m "feat: interpolation in symbol-name positions (_symbol)"
```

---

### Task 6: Structured charmap directives

Promote `CHARMAP`/`NEWCHARMAP`/`SETCHARMAP`/`PUSHC`/`POPC` from the permissive generic fallback to real rules with correct argument shapes.

**Files:**
- Modify: `grammar.js` (new `charmap_directive`; remove the five keywords from `directive_keyword`; add `charmap_directive` to `_line_body`)
- Test: `test/corpus/directives.txt` (append)

**Interfaces:**
- Consumes: `_string` (Task 3), `_symbol` (Task 5), `_expression`, `kw`, `sepByComma`.
- Produces: `charmap_directive` node with a `keyword:` field per the keyword mechanism.

- [ ] **Step 1: Write the failing test** — append to `test/corpus/directives.txt`:

```
==================
charmap directives
==================
CHARMAP "A", 42
CHARMAP "<br>", 13, 10
NEWCHARMAP main
NEWCHARMAP copy, main
SETCHARMAP main
PUSHC
PUSHC main
POPC
---

(source_file
  (statement (charmap_directive (string) (decimal)))
  (statement (charmap_directive (string) (decimal) (decimal)))
  (statement (charmap_directive (identifier)))
  (statement (charmap_directive (identifier) (identifier)))
  (statement (charmap_directive (identifier)))
  (statement (charmap_directive))
  (statement (charmap_directive (identifier)))
  (statement (charmap_directive)))
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx tree-sitter test -i 'charmap directives'`
Expected: FAIL — currently these parse as generic `directive`, so the tree shows `(directive (directive_keyword) …)`, not `charmap_directive`.

- [ ] **Step 3: Add the structured rule; remove the keywords from the fallback.** In `grammar.js`:

Add to the `_line_body` choice (next to the other directives):

```js
        $.charmap_directive,
```

Add the rule:

```js
    charmap_directive: ($) =>
      choice(
        seq(field('keyword', alias(kw('CHARMAP'), 'charmap_kw')), field('mapping', $._string), ',', sepByComma($._expression)),
        seq(field('keyword', alias(kw('NEWCHARMAP'), 'newcharmap_kw')), field('name', $._symbol), optional(seq(',', field('base', $._symbol)))),
        seq(field('keyword', alias(kw('SETCHARMAP'), 'setcharmap_kw')), field('name', $._symbol)),
        seq(field('keyword', alias(kw('PUSHC'), 'pushc_kw')), optional(field('name', $._symbol))),
        field('keyword', alias(kw('POPC'), 'popc_kw')),
      ),
```

Remove `'PUSHC', 'POPC', 'NEWCHARMAP', 'SETCHARMAP', 'CHARMAP'` from the `directive_keyword` list (leave the remaining keywords untouched).

- [ ] **Step 4: Regenerate and test**

Run: `npx tree-sitter generate && npx tree-sitter test -i 'charmap directives'`
Expected: PASS. If `generate` reports a conflict between `charmap_directive` and `macro_invocation`/`directive` (a bare `POPC` line), the dedicated keyword tokens out-rank `identifier` by rule order; if a parser conflict remains, add `[$.charmap_directive, $.macro_invocation]` to `conflicts` and retry.

- [ ] **Step 5: Full regression + smoke**

Run: `npx tree-sitter test && bash test/no-errors.sh`
Expected: all PASS, smoke exit 0.

- [ ] **Step 6: Commit**

```bash
git add grammar.js src/ test/corpus/directives.txt
git commit -m "feat: structured charmap directives (CHARMAP/NEWCHARMAP/...)"
```

---

### Task 7: External scanner — multi-line and triple-quoted-raw strings

Add a stateless `src/scanner.c` emitting two content tokens; wire them into `multiline_string` and `raw_multiline_string`, and extend `_string`/`_expression`.

**Files:**
- Create: `src/scanner.c`
- Modify: `grammar.js` (`externals`, `multiline_string`, `raw_multiline_string`, extend `_string` and `_expression`)
- Test: `test/corpus/strings.txt` (append)

**Interfaces:**
- Consumes: `interpolation`, `escape_sequence`, `macro_argument` (Task 4).
- Produces: external tokens `_ml_string_content`, `_raw_ml_string_content`; `multiline_string` = `seq('"""', repeat(choice($._ml_string_content, $.escape_sequence, $.interpolation, $.macro_argument)), '"""')`; `raw_multiline_string` = `seq('#"""', optional($._raw_ml_string_content), '"""')`.

- [ ] **Step 1: Write the scanner.** Create `src/scanner.c`:

```c
#include "tree_sitter/parser.h"

enum TokenType {
  ML_STRING_CONTENT,      // non-raw """..."": stops before """, '{', or '\\'
  RAW_ML_STRING_CONTENT,  // raw #"""...""": stops only before """
};

// Consume a run of multi-line string content. For raw strings, only the
// closing `"""` terminates; for non-raw, `{` and `\` also yield control back
// to the grammar (for interpolation / escapes). Never consumes the closing
// `"""`. Returns true iff at least one character was consumed.
static bool scan_content(TSLexer *lexer, bool raw) {
  bool consumed = false;
  for (;;) {
    if (lexer->eof(lexer)) break;
    int32_t c = lexer->lookahead;
    if (!raw && (c == '{' || c == '\\')) {
      lexer->mark_end(lexer);
      break;
    }
    if (c == '"') {
      lexer->mark_end(lexer);          // tentative end: before this quote run
      int count = 0;
      while (lexer->lookahead == '"' && count < 3) {
        lexer->advance(lexer, false);
        count++;
      }
      if (count == 3) {
        // Closing delimiter: excluded from the token (mark_end is behind it).
        return consumed;
      }
      // One or two quotes are literal content; extend the token past them.
      consumed = true;
      lexer->mark_end(lexer);
      continue;
    }
    lexer->advance(lexer, false);
    consumed = true;
  }
  if (consumed) lexer->mark_end(lexer);
  return consumed;
}

void *tree_sitter_rgbasm_external_scanner_create(void) { return NULL; }
void tree_sitter_rgbasm_external_scanner_destroy(void *payload) {}
unsigned tree_sitter_rgbasm_external_scanner_serialize(void *payload, char *buffer) { return 0; }
void tree_sitter_rgbasm_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

bool tree_sitter_rgbasm_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  if (valid_symbols[RAW_ML_STRING_CONTENT]) {
    if (scan_content(lexer, true)) { lexer->result_symbol = RAW_ML_STRING_CONTENT; return true; }
    return false;
  }
  if (valid_symbols[ML_STRING_CONTENT]) {
    if (scan_content(lexer, false)) { lexer->result_symbol = ML_STRING_CONTENT; return true; }
    return false;
  }
  return false;
}
```

- [ ] **Step 2: Wire the grammar.** In `grammar.js`, add an `externals` field (just before `extras:` or `conflicts:`), declaring the tokens in the SAME ORDER as the C enum:

```js
  externals: ($) => [$._ml_string_content, $._raw_ml_string_content],
```

Add the two rules:

```js
    multiline_string: ($) =>
      seq(
        '"""',
        repeat(choice($._ml_string_content, $.escape_sequence, $.interpolation, $.macro_argument)),
        '"""',
      ),
    raw_multiline_string: ($) =>
      seq('#"""', optional($._raw_ml_string_content), '"""'),
```

Extend `_string`:

```js
    _string: ($) => choice($.string, $.raw_string, $.multiline_string, $.raw_multiline_string),
```

Add both to `_expression` (beside `$.string` / `$.raw_string`):

```js
        $.string,
        $.raw_string,
        $.multiline_string,
        $.raw_multiline_string,
```

- [ ] **Step 3: Write the failing test** — append to `test/corpus/strings.txt`:

```
==================
multi-line strings
==================
DB """line one
line "two" with quotes
sum = {d:N}""", #"""raw
multi \no escapes"""
---

(source_file
  (statement (data_directive
    (argument_list
      (multiline_string (interpolation (format_spec)))
      (raw_multiline_string)))))
```

- [ ] **Step 4: Regenerate and test**

Run: `npx tree-sitter generate && npx tree-sitter test -i 'multi-line strings'`
Expected: PASS. `tree-sitter generate` and the test run both compile `src/scanner.c` automatically.

- [ ] **Step 5: Verify the `extras` boundary edge case.** Create `/tmp/claude-1000/-home-awilliams-Development-tree-sitter-rgbasm/6d54b388-8ce6-4c24-a583-2dc2d697940f/scratchpad/ml.asm`:

```
DB """  leading and  internal   spaces
and a /* not-a-comment */ sequence"""
```

Run: `npx tree-sitter parse /tmp/claude-1000/-home-awilliams-Development-tree-sitter-rgbasm/6d54b388-8ce6-4c24-a583-2dc2d697940f/scratchpad/ml.asm`
Expected: a single `(multiline_string)` with NO `ERROR`/`MISSING` and NO `block_comment` node inside. If internal spaces are dropped or `/* */` is parsed as a `block_comment`, the extras-boundary issue is real: add a corpus test capturing it, document it in the README "Known limitations", and (only if it produces ERROR nodes) escalate at the review checkpoint. Whitespace/`/* */` rendered as plain content is the success case.

- [ ] **Step 6: Full regression + smoke**

Run: `npx tree-sitter test && bash test/no-errors.sh`
Expected: all PASS, smoke exit 0.

- [ ] **Step 7: Commit**

```bash
git add grammar.js src/ test/corpus/strings.txt
git commit -m "feat: multi-line and triple-quoted raw strings via external scanner"
```

---

### Task 8: Query updates (both query sets)

Add highlight (and where relevant, other) captures for the new node types in `queries/` (nvim/Helix) and `queries/zed/`.

**Files:**
- Modify: `queries/highlights.scm`, `queries/zed/highlights.scm`
- Review/modify as needed: `queries/locals.scm`, `queries/textobjects.scm`, `queries/zed/outline.scm`, `queries/zed/overrides.scm`
- Test: query compilation + smoke

**Interfaces:**
- Consumes: node types `graphics_constant`, `raw_string`, `multiline_string`, `raw_multiline_string`, `interpolation`, `format_spec`, `anonymous_label`, `anonymous_label_ref`, `charmap_directive`, `interpolated_identifier`.
- Produces: capture coverage for all of the above.

- [ ] **Step 1: Inspect the existing capture vocabulary.**

Run: `sed -n '1,200p' queries/highlights.scm` and `sed -n '1,200p' queries/zed/highlights.scm`
Note the capture names already used for `string`, numbers, labels, and directive keyword fields (the `keyword:` field pattern). Mirror them.

- [ ] **Step 2: Add captures to `queries/highlights.scm`.** Append (adapting capture names to those already used in the file):

```scheme
; Phase 2 nodes
(graphics_constant) @number
(raw_string) @string
(multiline_string) @string
(raw_multiline_string) @string
(interpolation) @punctuation.special
(format_spec) @string.special
(anonymous_label) @label
(anonymous_label_ref) @label
(charmap_directive keyword: _ @keyword)
```

- [ ] **Step 3: Add equivalent captures to `queries/zed/highlights.scm`** using the Zed vocabulary already present in that file (e.g. `@string`, `@number`, `@label`/`@variable`, `@keyword`, `@punctuation.special`). Match the existing file's conventions rather than copying nvim names verbatim.

- [ ] **Step 4: Review the structural query files** for whether the new nodes affect them:
- `queries/locals.scm` / `queries/zed/outline.scm`: anonymous labels have no name — do NOT add them as named definitions. `interpolated_identifier` in a definition position MAY belong as a definition; add only if the file already captures `identifier` definitions and it compiles cleanly.
- `queries/textobjects.scm`: no change unless a new block node was added (none were).
- `queries/zed/overrides.scm` / `brackets.scm`: no new bracket pairs (`{`/`}` interpolation is not an autoclose concern here) — leave unless the file already scopes string interiors.

Make only the changes that compile and are clearly correct; note any skipped.

- [ ] **Step 5: Compile every query file.**

Run, for each `.scm` in `queries/` and `queries/zed/`:
```bash
for q in queries/*.scm queries/zed/*.scm; do
  echo "== $q =="; npx tree-sitter query -p . "$q" test/highlight/sample.asm >/dev/null && echo OK || echo "FAIL $q";
done
```
Expected: every file prints `OK` (a harmless "parser directories" warning on stderr is fine). Fix any `FAIL` before continuing.

- [ ] **Step 6: Commit**

```bash
git add queries/
git commit -m "feat(queries): highlight Phase 2 nodes in nvim/Helix and Zed sets"
```

---

### Task 9: Phase-1 carry-over corpus cases + final verification

Add the three deferred Phase-1 corpus cases noted in the progress ledger, then do a whole-grammar verification pass.

**Files:**
- Test: `test/corpus/labels.txt`, `test/corpus/blocks.txt`, `test/corpus/conditionals.txt` (append)
- Optionally add a representative Phase-2 sample to `test/highlight/` for the smoke set.

- [ ] **Step 1: Add the carry-over corpus cases.**

Append to `test/corpus/labels.txt`:

```
==================
keyword-prefix label
==================
ENDM_LOOP:
    nop
---

(source_file
  (statement (label_definition (identifier)))
  (statement (instruction (mnemonic))))
```

Append to `test/corpus/blocks.txt`:

```
==================
empty macro body
==================
MACRO foo
ENDM
---

(source_file
  (statement (macro_definition (identifier))))
```

Append to `test/corpus/blocks.txt` (FOR two-arg short form):

```
==================
for two-arg short form
==================
FOR n, 256
    db n
ENDR
---

(source_file
  (statement (for_block
    (identifier)
    (decimal)
    (statement (data_directive (argument_list (identifier)))))))
```

- [ ] **Step 2: Run the new cases**

Run: `npx tree-sitter test -i 'keyword-prefix label' && npx tree-sitter test -i 'empty macro body' && npx tree-sitter test -i 'for two-arg short form'`
Expected: PASS. Reconcile expected trees against `npx tree-sitter parse` if hidden-node rendering differs.

- [ ] **Step 3: Add a Phase-2 smoke sample.** Create `test/highlight/phase2.asm` exercising every new feature so the smoke script covers them:

```
SECTION "Phase2", ROM0

DB `01012323, `00112233
CHARMAP "A", 42
NEWCHARMAP custom, main

Greeting:
    PRINTLN "Hi {WHO}, sum={d:TOTAL}"
    DB #"raw \1 {literal}"
    DB """multi
line {x:N}"""

:
    jr :-
    jp :+
:

DEF {prefix}_value = 1
```

- [ ] **Step 4: Full verification.**

Run:
```bash
npx tree-sitter generate
npx tree-sitter test
bash test/no-errors.sh
for q in queries/*.scm queries/zed/*.scm; do npx tree-sitter query -p . "$q" test/highlight/phase2.asm >/dev/null && echo "OK $q" || echo "FAIL $q"; done
```
Expected: all corpus tests PASS; smoke prints `OK:` for every `.asm` (including `phase2.asm`), exit 0; every query prints `OK`.

- [ ] **Step 5: Update the README roadmap.** In `README.md`, move the now-implemented features out of the deferred/Phase-2 list and into the supported list; leave fragment literals `[[ … ]]` (and any other un-done item) in a "Known limitations / future" note, plus the graphics-constant width and triple-quoted-string `extras` caveats.

- [ ] **Step 6: Commit**

```bash
git add test/ README.md
git commit -m "test: Phase-1 carry-over cases + Phase 2 smoke sample; docs: README roadmap"
```

---

## Self-Review

**Spec coverage** (each §2 in-scope feature → task):
1. Graphics constants → Task 1 ✓
2. Charmap directives (structured) → Task 6 ✓
3. Single-line raw strings → Task 3 ✓
4. Anonymous labels → Task 2 ✓
5. Symbol interpolation (strings) → Task 4 ✓; (name-building) → Task 5 ✓
6. Macro-args inside strings → Task 4 ✓
7. Multi-line strings → Task 7 ✓
8. Triple-quoted raw strings → Task 7 ✓
- Queries for all new nodes → Task 8 ✓
- Phase-1 carry-over + README roadmap + final verification → Task 9 ✓
- Fragment literals → explicitly deferred (no task), matching spec §2.

**Type/name consistency:** `_string` introduced in Task 3, extended in Tasks 6/7; `interpolation`/`format_spec`/`_interp_symbol`/`_interp_name_part` introduced in Task 4, reused in Tasks 5/7; `_symbol` introduced in Task 5, consumed in Task 6; external tokens `_ml_string_content`/`_raw_ml_string_content` declared in `externals` in the same order as the C `enum TokenType` (Task 7). Scanner function names use the `tree_sitter_rgbasm_external_scanner_*` prefix matching `name: 'rgbasm'`.

**Placeholder scan:** every grammar/scanner/query/test step shows full content. Conflict-resolution steps name the specific likely conflict and the exact `conflicts` entry; the only deliberately open items are reconcile-against-`tree-sitter parse` for hidden-node rendering (a documented, bounded workflow) and the §5 `extras` edge case (Task 7 Step 5 gives the concrete check and fallback).
