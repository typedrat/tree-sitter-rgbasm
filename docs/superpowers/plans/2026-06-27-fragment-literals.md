# Fragment Literals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement RGBDS fragment literals `[[ … ]]` as a recursive `_expression` node, and generalize the `::` separator to chain data directives as well as instructions.

**Architecture:** Two cohesive `grammar.js` changes. (1) Replace the `instruction_line` rule with a hidden `_code_line`/`_code_element` chain so `::` separates `instruction | data_directive` and both become direct children of `statement`. (2) Add a `fragment_literal` rule — `[[` + a newline-separated `statement` list + `]]` — inserted once into `_expression`, which makes it legal in every value site and lets nesting fall out of the `statement → _expression → fragment_literal` recursion. Then queries, docs, and a whole-grammar verification pass.

**Tech Stack:** tree-sitter grammar DSL (`grammar.js`), tree-sitter-cli 0.26.9 (pinned devDependency), Scheme query files (`queries/`, `queries/zed/`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-27-fragment-literals-design.md` (read it before starting).
- **No preprocessor/linker semantics:** recognize fragment-literal *syntax* only; never model the implicit `SECTION FRAGMENT` or the start-address value.
- **Hidden-rule convention:** rules prefixed `_` are hidden (no node in the tree); their children appear unwrapped under the parent. New helper rules that should not appear in trees MUST be `_`-prefixed.
- **Keyword tokens stay prec 0:** keyword rules rely on longest-match + rule-definition order, NOT `prec`. Do not reintroduce `prec` on keyword tokens.
- **Test commands:**
  - Regenerate parser: `npx tree-sitter generate`
  - Run all corpus tests: `npx tree-sitter test`
  - Run one corpus test: `npx tree-sitter test -i '<test name>'`
  - Inspect a parse: `npx tree-sitter parse <file.asm>`
  - Smoke (must stay 0 errors): `bash test/no-errors.sh`
  - Query compile check: `npx tree-sitter query -p . <query.scm> <file.asm>` (the `-p .` is required)
- **Expected trees in this plan are derived by hand.** After a test fails, run `npx tree-sitter parse` on the snippet; if the only difference is hidden-node rendering, reconcile the expected block to the real output and continue. A structural mismatch (wrong nesting, `ERROR`/`MISSING` nodes) is a real grammar failure to fix.
- **Commit after every task** with a `feat:`/`test:`/`docs:` message scoped to that task. Do not push.

---

### Task 1: Generalize the `::` separator

RGBDS separates *instructions and data directives* on one line with `::`. Today only `instruction_line` chains `::` (and it wraps even a lone instruction); `data_directive` cannot chain. Replace both with one hidden chain whose element is `instruction | data_directive`. Result: instructions and data directives become direct, sibling children of `statement`; the old `instruction_line` wrapper disappears.

**Files:**
- Modify: `grammar.js` (`_line_body`, delete `instruction_line`, add `_code_line`/`_code_element`)
- Test: `test/corpus/instructions.txt` (append a `::`-mixing case); reconcile `test/corpus/{instructions,blocks,branches,lexing,labels}.txt` expected trees

**Interfaces:**
- Consumes: existing `$.instruction`, `$.data_directive`.
- Produces: hidden `_code_line` = `seq($._code_element, repeat(seq('::', $._code_element)))`; hidden `_code_element` = `choice($.instruction, $.data_directive)`. After this task, a code line's instructions/data directives appear as direct children of `statement` with no wrapper node.

- [ ] **Step 1: Write the failing test** — append to `test/corpus/instructions.txt`:

```
==================
double-colon data and mixed
==================
    db 1 :: db 2
    ld a, b :: db 3
---

(source_file
  (statement
    (data_directive (argument_list (decimal)))
    (data_directive (argument_list (decimal))))
  (statement
    (instruction (mnemonic) (register) (register))
    (data_directive (argument_list (decimal)))))
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx tree-sitter test -i 'double-colon data and mixed'`
Expected: FAIL (`data_directive` cannot follow `::` today → `ERROR`).

- [ ] **Step 3: Change the grammar.** In `grammar.js`:

In the `_line_body` choice (currently around lines 78–97), remove the two lines `$.instruction_line,` and `$.data_directive,` and add `$._code_line,` in their place, so the choice reads:

```js
    _line_body: ($) =>
      choice(
        $.comment,
        $._code_line,
        $.section_directive,
        $.define_directive,
        $.export_directive,
        $.purge_directive,
        $.include_directive,
        $.charmap_directive,
        $.directive,
        $.macro_definition,
        $.rept_block,
        $.for_block,
        $.if_block,
        $.union_block,
        $.load_block,
        $.macro_invocation,
      ),
```

Delete the `instruction_line` rule (currently `instruction_line: ($) => seq($.instruction, repeat(seq('::', $.instruction))),`) and add in its place:

```js
    // `::` separates instructions and data directives on one line (rgbasm(5)).
    // Hidden: the chained elements are direct children of `statement`.
    _code_line: ($) => seq($._code_element, repeat(seq('::', $._code_element))),
    _code_element: ($) => choice($.instruction, $.data_directive),
```

Leave the `data_directive` rule definition itself unchanged (it is now reached via `_code_element`).

- [ ] **Step 4: Regenerate and test the new case**

Run: `npx tree-sitter generate && npx tree-sitter test -i 'double-colon data and mixed'`
Expected: PASS. If `generate` reports a conflict between the label-export `::` and the separator `::`, add a `conflicts` entry (create the `conflicts:` array just before `extras:` if absent) and re-run; the likely entry is:

```js
  conflicts: ($) => [
    [$.label_definition, $._code_line],
  ],
```

Reconcile the expected tree against `npx tree-sitter parse` if hidden-node rendering differs.

- [ ] **Step 5: Reconcile the existing instruction trees.**

The full suite now fails everywhere an expected tree contains `instruction_line`, because the wrapper is gone. Run `npx tree-sitter test` and update each failing expected block by removing the `(instruction_line …)` wrapper and promoting its `(instruction …)` children up one level (de-indent them by 2 spaces). Example transformation:

```
; before
  (statement (instruction_line (instruction (mnemonic))))
  (statement (instruction_line
    (instruction (mnemonic) (register) (register))
    (instruction (mnemonic) (register) (register))))
; after
  (statement (instruction (mnemonic)))
  (statement
    (instruction (mnemonic) (register) (register))
    (instruction (mnemonic) (register) (register)))
```

Apply across `test/corpus/instructions.txt`, `test/corpus/blocks.txt`, `test/corpus/branches.txt`, `test/corpus/lexing.txt`, and `test/corpus/labels.txt`. Re-run `npx tree-sitter test` until green; for any block where the diff is more than wrapper removal, run `npx tree-sitter parse` on that snippet and match the real output.

- [ ] **Step 6: Full regression + smoke**

Run: `npx tree-sitter test && bash test/no-errors.sh`
Expected: all corpus tests PASS; smoke prints `OK:` for every file, exit 0.

- [ ] **Step 7: Commit**

```bash
git add grammar.js src/ test/corpus/
git commit -m "feat: generalize :: to chain data directives (drop instruction_line wrapper)"
```

---

### Task 2: `fragment_literal`

Add the `[[ … ]]` fragment literal: a `statement` list in expression position, nesting arbitrarily.

**Files:**
- Modify: `grammar.js` (add `$.fragment_literal` to `_expression`; add the `fragment_literal` rule)
- Test: `test/corpus/expressions.txt` (append)

**Interfaces:**
- Consumes: `$.statement` (recursive), literal tokens `[[` / `]]`.
- Produces: `fragment_literal` node = `seq('[[', repeat('\n'), optional(seq($.statement, repeat(seq(repeat1('\n'), $.statement)), repeat('\n'))), ']]')`. Reachable everywhere `_expression` is (operands, `mem_access` interiors, data arguments, branch targets).

- [ ] **Step 1: Write the failing tests** — append to `test/corpus/expressions.txt`:

```
==================
fragment literal inline and multi-line
==================
DW [[ db 1 ]]
    call [[
        ld de, $1003
        jp Print
    ]]
---

(source_file
  (statement (data_directive
    (argument_list
      (fragment_literal
        (statement (data_directive (argument_list (decimal))))))))
  (statement (instruction
    (branch_mnemonic)
    (fragment_literal
      (statement (instruction (mnemonic) (register) (hex)))
      (statement (instruction (branch_mnemonic) (identifier)))))))

==================
fragment literal nested and in mem access
==================
DW [[ jp [[ ret ]] ]]
    ld a, [ [[ db 20 ]] ]
---

(source_file
  (statement (data_directive
    (argument_list
      (fragment_literal
        (statement (instruction
          (branch_mnemonic)
          (fragment_literal
            (statement (instruction (branch_mnemonic))))))))))
  (statement (instruction
    (mnemonic)
    (register)
    (mem_access
      (fragment_literal
        (statement (data_directive (argument_list (decimal)))))))))
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx tree-sitter test -i 'fragment literal'`
Expected: FAIL (`[[` unrecognized → `ERROR`).

- [ ] **Step 3: Add the rule.** In `grammar.js`, add `$.fragment_literal,` to the `_expression` choice (next to `$.parenthesized_expression`), and add the rule (near `parenthesized_expression`):

```js
    // Inline section fragment: [[ statements ]] in expression position.
    // Body is a newline-separated `statement` list, so inner labels/
    // instructions/data/directives and nested [[…]] are fully structured.
    // `[[`/`]]` are literal tokens; longest-match beats `[`/`]`, so a fragment
    // nests cleanly inside a `[ … ]` mem_access.
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

- [ ] **Step 4: Regenerate and test**

Run: `npx tree-sitter generate && npx tree-sitter test -i 'fragment literal'`
Expected: PASS. If `generate` reports a conflict (e.g. `mem_access` `[` vs `[[`, or the statement/expression recursion), add the reported pair to the `conflicts:` array and re-run until clean. Reconcile any hidden-node rendering differences against `npx tree-sitter parse` on the snippet; an `ERROR`/`MISSING` node is a real failure — adjust and retry.

- [ ] **Step 5: Verify the empty and bracket-adjacency edge cases.** Write `/tmp/claude-1000/-home-awilliams-Development-tree-sitter-rgbasm/ab175963-e762-48b1-b731-2a6db0b4ea46/scratchpad/frag.asm`:

```
DW [[ ]]
DW [[
]]
    ld hl, [[[db 1]]]
```

Run: `npx tree-sitter parse /tmp/claude-1000/-home-awilliams-Development-tree-sitter-rgbasm/ab175963-e762-48b1-b731-2a6db0b4ea46/scratchpad/frag.asm`
Expected: the two empty forms parse as `(fragment_literal)` with no `ERROR`/`MISSING`. The `[[[db 1]]]` line is a stress case (mem_access `[` + fragment `[[ … ]]` + `]`); confirm it is either a clean nest or a single `ERROR` localized to that line — if it errors, that is acceptable (documented adjacency ambiguity), but the two empty-fragment lines above it MUST be clean. If an empty fragment errors, fix the body rule before continuing.

- [ ] **Step 6: Full regression + smoke**

Run: `npx tree-sitter test && bash test/no-errors.sh`
Expected: all PASS, smoke exit 0.

- [ ] **Step 7: Commit**

```bash
git add grammar.js src/ test/corpus/expressions.txt
git commit -m "feat: add fragment literals ([[ … ]])"
```

---

### Task 3: Query coverage

Highlight the `[[`/`]]` delimiters, fold multi-line fragments, and add a textobject, in both query sets.

**Files:**
- Modify: `queries/highlights.scm`, `queries/folds.scm`, `queries/textobjects.scm`
- Modify: `queries/zed/highlights.scm`, `queries/zed/brackets.scm`, `queries/zed/textobjects.scm`
- Test: query compilation against `test/highlight/phase2.asm`

**Interfaces:**
- Consumes: node `fragment_literal` and the `[[` / `]]` anonymous tokens.
- Produces: capture coverage for the fragment delimiters and body.

- [ ] **Step 1: Highlight the delimiters (nvim/Helix).** In `queries/highlights.scm`, add after the existing bracket line (`["[" "]" "(" ")"] @punctuation.bracket`):

```scheme
["[[" "]]"] @punctuation.bracket
```

- [ ] **Step 2: Fold multi-line fragments.** In `queries/folds.scm`, add `(fragment_literal)` to the fold list so it reads:

```scheme
[
  (macro_definition)
  (rept_block)
  (for_block)
  (if_block)
  (union_block)
  (load_block)
  (fragment_literal)
] @fold
```

- [ ] **Step 3: Add a textobject (nvim/Helix).** In `queries/textobjects.scm`, add next to the other block bodies:

```scheme
(fragment_literal) @function.around @function.outer
```

- [ ] **Step 4: Zed query set.** In `queries/zed/highlights.scm`, add after its bracket line:

```scheme
["[[" "]]"] @punctuation.bracket
```

In `queries/zed/brackets.scm`, add:

```scheme
("[[" @open "]]" @close)
```

In `queries/zed/textobjects.scm`, add:

```scheme
(fragment_literal) @function.around
```

(Zed has no `folds.scm` in this repo — skip folds there.)

- [ ] **Step 5: Compile every query file.**

Run:
```bash
for q in queries/*.scm queries/zed/*.scm; do
  echo "== $q =="; npx tree-sitter query -p . "$q" test/highlight/phase2.asm >/dev/null && echo OK || echo "FAIL $q";
done
```
Expected: every file prints `OK` (a harmless "parser directories" warning on stderr is fine). Fix any `FAIL` before continuing.

- [ ] **Step 6: Commit**

```bash
git add queries/
git commit -m "feat(queries): highlight/fold fragment literals in nvim/Helix and Zed sets"
```

---

### Task 4: Smoke sample, README, final verification

Exercise the new features in the smoke set, update the roadmap, and run a whole-grammar verification pass.

**Files:**
- Modify: `test/highlight/phase2.asm` (append a fragment + `::`-data sample)
- Modify: `README.md` (roadmap)

- [ ] **Step 1: Extend the smoke sample.** Append to `test/highlight/phase2.asm`:

```
FragTest:
    call [[
        ld a, 1
        ret
    ]]
    DW [[ db 1 ]], [[ db 2 :: db 3 ]]
```

- [ ] **Step 2: Confirm the sample parses clean.**

Run: `npx tree-sitter parse test/highlight/phase2.asm | grep -nE '\(ERROR|\(MISSING' || echo CLEAN`
Expected: `CLEAN`.

- [ ] **Step 3: Update the README roadmap.** In `README.md`:

Add fragment literals to the Phase 2 supported paragraph (after the charmap clause, lines ~17–18), e.g. append:
`, and inline fragment literals (`[[ … ]]`).`

Replace the "Deferred / future work" section (currently the fragment-literals bullet at lines ~20–23) with a known-limitations note:

```markdown
### Known limitations

- **Fragment-literal inline rewrite.** The rgbasm(5) docs show a space-separated
  inline rewrite (`call [[…]] jr [[…]]` with no separator between the two inner
  statements). That is documentation shorthand, not real syntax: fragment bodies
  separate statements by newlines (and `::` within the instruction/data subset).
```

- [ ] **Step 4: Whole-grammar verification.**

Run:
```bash
npx tree-sitter generate
npx tree-sitter test
bash test/no-errors.sh
for q in queries/*.scm queries/zed/*.scm; do npx tree-sitter query -p . "$q" test/highlight/phase2.asm >/dev/null && echo "OK $q" || echo "FAIL $q"; done
```
Expected: all corpus tests PASS; smoke prints `OK:` for every `.asm`, exit 0; every query prints `OK`.

- [ ] **Step 5: Commit**

```bash
git add test/highlight/phase2.asm README.md
git commit -m "test: fragment-literal smoke sample; docs: README roadmap"
```

---

## Self-Review

**Spec coverage** (each §2 in-scope item → task):
- `::` generalization (instruction + data, mixed) → Task 1 ✓
- `fragment_literal` in `_expression`, recursive body, nesting, every value site → Task 2 ✓
- Empty `[[ ]]` allowed → Task 2 Step 5 ✓
- Corpus tests (`::` data/mixed; fragment inline/multi-line/nested/mem-access) → Tasks 1–2 ✓
- Query coverage, both sets (bracket highlight, fold, textobject) → Task 3 ✓
- Smoke sample + README roadmap + inline-rewrite limitation → Task 4 ✓
- Linker/semantic results → out of scope (not implemented), matching spec §2 ✓

**Type/name consistency:** `_code_line`/`_code_element` introduced and consumed in Task 1; `fragment_literal` introduced in Task 2 and queried in Tasks 3–4; the `[[`/`]]` literal tokens captured in Task 3 match the rule in Task 2. The `conflicts:` array is created on first need (Task 1 Step 4) and appended to (Task 2 Step 4).

**Placeholder scan:** every grammar/query/test step shows full content. The only deliberately open items are the empirical conflict-resolution loops (named candidate entries given) and the reconcile-against-`tree-sitter parse` workflow for hidden-node rendering — both bounded and documented.
