# tree-sitter-rgbasm

A [tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar for RGBASM, the assembler
component of [RGBDS](https://rgbds.gbdev.io/) v1.0.1 (Game Boy assembly).

## Status: Phase 1 (core subset)

The grammar covers the core RGBASM language, including instructions, registers, condition codes,
all numeric literal formats, strings, expressions with full operator precedence, labels,
`SECTION`/`DEF`/`EQU`/`EQUS`/`RS`/assignment directives, `EXPORT`/`PURGE`/`INCLUDE`,
`MACRO`/`REPT`/`FOR`/`IF`/`UNION`/`LOAD` blocks, and macro-argument tokens.

### Phase 2 roadmap (not yet implemented)

The following features are intentionally deferred:

- Symbol interpolation: `{fmt:sym}` inside strings
- Raw strings: `#"…"`
- Multi-line strings: `"""…"""`
- Fragment literals: `[[ … ]]`
- Anonymous labels: `:+` / `:-`
- Graphics constants: `` `0123 ``
- Charmap semantics: `CHARMAP`/`NEWCHARMAP`/`SETCHARMAP`/`PUSHC`/`POPC` directives parse as
  generic directives, but charmap semantics (custom string encodings) are not modeled
- Full symbol-interpolation semantics (macro-time text expansion)

## Build & test

```bash
npm install
npx tree-sitter generate
npx tree-sitter test
./test/no-errors.sh
```

## Editor integration

### Neovim (nvim-treesitter)

Register the parser in your Neovim config:

```lua
local parser_config = require("nvim-treesitter.parsers").get_parser_configs()
parser_config.rgbasm = {
  install_info = {
    url = "https://github.com/typedrat/tree-sitter-rgbasm",
    files = { "src/parser.c" },
    branch = "main",
  },
  filetype = "rgbasm",
}
vim.filetype.add({ extension = { asm = "rgbasm", inc = "rgbasm" } })
```

The query files in `queries/` (highlights, injections, locals, folds, indents, textobjects)
will be picked up automatically by nvim-treesitter once the parser is installed.

### Helix

Add entries to your `languages.toml` (usually `~/.config/helix/languages.toml`):

```toml
[[language]]
name = "rgbasm"
scope = "source.rgbasm"
file-types = ["asm", "inc"]
comment-tokens = [";"]
block-comment-tokens = { start = "/*", end = "*/" }
indent = { tab-width = 4, unit = "    " }
grammar = "rgbasm"

[[grammar]]
name = "rgbasm"
source = { git = "https://github.com/typedrat/tree-sitter-rgbasm", rev = "main" }
```

Then copy the query files into Helix's runtime directory:

```bash
mkdir -p ~/.config/helix/runtime/queries/rgbasm
cp queries/*.scm ~/.config/helix/runtime/queries/rgbasm/
```

### Zed

Create a [Zed extension](https://zed.dev/docs/extensions/developing-extensions) with the
following structure:

```
my-rgbasm-extension/
  extension.toml
  languages/
    rgbasm/
      config.toml
      highlights.scm
      brackets.scm
      indents.scm
      injections.scm
      outline.scm
      overrides.scm
      textobjects.scm
```

**`extension.toml`:**

```toml
id = "rgbasm"
name = "RGBASM"
version = "0.1.0"
description = "RGBASM (RGBDS Game Boy assembler) language support"
authors = ["Alexis Williams <alexis@typedr.at>"]
schema_version = 1

[grammars.rgbasm]
repository = "https://github.com/typedrat/tree-sitter-rgbasm"
rev = "<commit-sha>"
```

For local development, use `repository = "file:///home/awilliams/Development/tree-sitter-rgbasm"`.

**`languages/rgbasm/config.toml`:**

```toml
name = "RGBASM"
grammar = "rgbasm"
path_suffixes = ["asm", "inc"]
line_comments = ["; "]
block_comment = ["/*", "*/"]
```

Copy the Zed query files into the extension:

```bash
cp queries/zed/*.scm languages/rgbasm/
```

## Implementation notes / Known limitations

- **Keywords are case-insensitive; identifiers are case-sensitive.** `NOP`, `nop`, and `Nop` all
  parse as the `nop` mnemonic; `MyLabel` and `mylabel` are distinct identifiers.

- **Surface syntax only.** The grammar parses surface syntax. It does NOT model macro or `EQUS`
  text expansion, or symbol interpolation — those are assembler-time transformations that happen
  before the token stream this grammar consumes.

- **Keyword disambiguation via longest-match + rule order.** Keyword tokens carry precedence 0.
  Keyword-vs-identifier disambiguation and the condition-vs-register `c` disambiguation are
  resolved by longest-match lexing combined with grammar rule order and parse-state-aware
  lexing — not by token precedence or trailing-comma heuristics.

- **Condition codes vs. registers.** The carry condition `c` and the zero/nonzero/nocarry codes
  `z`/`nz`/`nc` are `condition_code` nodes when they appear in branch condition position (after a
  branch mnemonic); `c` is a `register` node when it appears as an operand elsewhere.

- **Section-type keywords are globally reserved.** `ROM0`, `ROMX`, `VRAM`, `SRAM`, `WRAM0`,
  `WRAMX`, `OAM`, and `HRAM` are lexed as section-type tokens everywhere (along with single-letter
  register names `a`/`b`/`c`/`d`/`e`/`h`/`l` and register pairs `af`/`bc`/`de`/`hl`/`sp`). A
  symbol literally named after one of these will not parse. This is an acceptable limitation given
  how rare such symbols are in practice.

- **`keyword:` field for highlighting.** Directive and block keywords are exposed via a `keyword:`
  field on their parent node, making them straightforward to highlight without capturing anonymous
  string literals.
