/**
 * RGBASM (RGBDS v1.0.1) grammar for tree-sitter.
 * Parses surface syntax; does not model macro/EQUS expansion or interpolation.
 */

// Case-insensitive regex for a reserved keyword, e.g. ci('LD') matches ld/LD/Ld.
function ci(word) {
  return new RegExp(
    word
      .split('')
      .map((c) => (/[a-z]/i.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join(''),
  );
}

// A single token matching any of the given case-insensitive keywords.
// No explicit prec: relies on longest-match (identifier beats a keyword prefix)
// and rule-definition order for same-length ties (keyword rules are defined
// before `identifier`, so exact matches still resolve to the keyword).
function kw(...words) {
  return token(choice(...words.map(ci)));
}

// Comma-separated, non-empty list.
function sepByComma(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

// Newline-separated inner statements for block bodies (allows blank lines).
function blockBody($) {
  return seq(repeat1('\n'), repeat(seq($.statement, repeat1('\n'))));
}

const PREC = {
  or: 1,
  and: 2,
  cmp: 3,
  add: 4,
  bitwise: 5,
  shift: 6,
  mul: 7,
  exp: 9,
  unary: 8,
  call: 10,
};

module.exports = grammar({
  name: 'rgbasm',

  // identifier at the start of a line is ambiguous between the name field of
  // a _symbol-using rule (macro_invocation, define_directive, …) and the
  // identifier that begins a label_definition.  Tree-sitter uses the
  // next-token lookahead (e.g. ':', '::', a mnemonic following the name) to
  // pick the right interpretation at runtime.
  conflicts: ($) => [
    [$._symbol, $.label_definition],
  ],

  extras: ($) => [
    /[ \t]/, // horizontal whitespace
    /\\\r?\n/, // line continuation: backslash + newline
    $.block_comment,
  ],

  rules: {
    // A file is newline-separated statements, tolerating blank lines anywhere
    // and an optional missing final newline.
    source_file: ($) =>
      optional(
        seq(
          repeat('\n'),
          $.statement,
          repeat(seq(repeat1('\n'), $.statement)),
          repeat('\n'),
        ),
      ),

    statement: ($) =>
      choice(
        seq($.label_definition, optional($._line_body)),
        $._line_body,
      ),

    // Placeholder body; alternatives added in later tasks.
    _line_body: ($) =>
      choice(
        $.comment,
        $.instruction_line,
        $.data_directive,
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

    macro_definition: ($) =>
      seq(field('keyword', alias(kw('MACRO'), 'macro_kw')), field('name', $._symbol), blockBody($), field('keyword', alias(kw('ENDM'), 'endm_kw'))),

    rept_block: ($) =>
      seq(field('keyword', alias(kw('REPT'), 'rept_kw')), field('count', $._expression), blockBody($), field('keyword', alias(kw('ENDR'), 'endr_kw'))),

    for_block: ($) =>
      seq(
        field('keyword', alias(kw('FOR'), 'for_kw')),
        field('variable', $.identifier),
        ',',
        sepByComma($._expression),
        blockBody($),
        field('keyword', alias(kw('ENDR'), 'endr_kw')),
      ),

    if_block: ($) =>
      seq(
        field('keyword', alias(kw('IF'), 'if_kw')),
        field('condition', $._expression),
        blockBody($),
        repeat($.elif_clause),
        optional($.else_clause),
        field('keyword', alias(kw('ENDC'), 'endc_kw')),
      ),

    elif_clause: ($) =>
      seq(field('keyword', alias(kw('ELIF'), 'elif_kw')), field('condition', $._expression), blockBody($)),

    else_clause: ($) => seq(field('keyword', alias(kw('ELSE'), 'else_kw')), blockBody($)),

    union_block: ($) =>
      seq(field('keyword', alias(kw('UNION'), 'union_kw')), blockBody($), repeat($.nextu_clause), field('keyword', alias(kw('ENDU'), 'endu_kw'))),

    nextu_clause: ($) => seq(field('keyword', alias(kw('NEXTU'), 'nextu_kw')), blockBody($)),

    load_block: ($) =>
      seq(
        field('keyword', alias(kw('LOAD'), 'load_kw')),
        optional(field('modifier', $.section_modifier)),
        field('name', $._string),
        ',',
        $.section_type,
        blockBody($),
        field('keyword', alias(kw('ENDL'), 'endl_kw')),
      ),

    data_directive: ($) =>
      seq(field('keyword', alias(kw('DB', 'DW', 'DL', 'DS'), 'data_kw')), optional($.argument_list)),

    argument_list: ($) => sepByComma($._expression),

    instruction_line: ($) => seq($.instruction, repeat(seq('::', $.instruction))),

    instruction: ($) => choice($._plain_instruction, $._branch_instruction),

    _plain_instruction: ($) => seq(field('mnemonic', $.mnemonic), optional($._operand_list)),

    _branch_instruction: ($) =>
      seq(
        field('mnemonic', $.branch_mnemonic),
        optional(
          choice(
            seq($.condition_code, optional(seq(',', $._operand_list))),
            $._operand_list,
          ),
        ),
      ),

    branch_mnemonic: ($) => kw('jr', 'jp', 'call', 'ret'),

    // No explicit prec: `c`/`nz`/`nc`/`z` lex as condition_code ONLY in states
    // where condition_code is valid (first operand of a branch). In other states
    // these are resolved as register by longest-match + rule order.
    // condition_code is defined BEFORE register so same-length `c` → condition_code
    // when both are valid in a given parse state.
    condition_code: ($) => token(choice(ci('nz'), ci('nc'), ci('z'), ci('c'))),

    _operand_list: ($) => sepByComma($._operand),

    _operand: ($) => choice($.mem_access, $.register, $._expression),

    mem_access: ($) => seq('[', choice($.register_increment, $.register, $._expression), ']'),

    // Atomic token: hli, hld, hl+, or hl- (case-insensitive for the hl/i/d parts).
    // No explicit prec: relies on longest-match so `hli` (len 3) beats `hl` (len 2),
    // and an identifier like `hlines` (len 6) beats `hli` (len 3).
    register_increment: ($) =>
      token(/[hH][lL]([iI]|[dD]|[+]|[-])/),

    mnemonic: ($) =>
      kw(
        'adc', 'add', 'and', 'bit', 'ccf', 'cpl', 'cp', 'daa', 'dec', 'di', 'ei',
        'halt', 'inc', 'ldh', 'ld', 'nop', 'or', 'pop', 'push', 'res', 'reti',
        'rlca', 'rlc', 'rla', 'rl', 'rrca', 'rrc', 'rra', 'rr', 'rst', 'sbc',
        'scf', 'set', 'sla', 'sra', 'srl', 'stop', 'sub', 'swap', 'xor',
      ),

    // Prec 0 (no explicit prec) so that a longer identifier beats a register
    // prefix at the same starting position. Same-length ties (e.g. `l` vs `l`)
    // are resolved by grammar ordering: register is defined before identifier.
    register: ($) =>
      token(choice(
        ci('af'), ci('bc'), ci('de'), ci('hl'), ci('sp'),
        ci('a'), ci('b'), ci('c'), ci('d'), ci('e'), ci('h'), ci('l'),
      )),

    // Macro-arg references: \1-\9, \<...>, \@, \#, \,, \(, \). Recognized only;
    // no interpolation semantics in Phase 1.
    macro_argument: ($) => token(/\\([1-9]|<[^>\n]*>|@|#|,|\(|\))/),

    // Suffixed symbol reference: identifier or local_label followed by one or
    // more macro-argument tokens (e.g. `.loop\@`, `Name\@`).  prec(1) prefers
    // the combined reading over a bare identifier/local_label + stray macro_argument.
    _label_ref: ($) =>
      prec(1, seq(choice($.identifier, $.local_label), repeat1($.macro_argument))),

    _expression: ($) =>
      choice(
        $._number,
        $.string,
        $.raw_string,
        $._label_ref,
        $.identifier,
        $.interpolation,
        $.interpolated_identifier,
        $.local_label,
        $.program_counter,
        $.anonymous_label_ref,
        $.macro_argument,
        $.parenthesized_expression,
        $.unary_expression,
        $.binary_expression,
        $.exp_expression,
        $.call_expression,
      ),

    program_counter: ($) => token('@'),

    // Anonymous label reference: ':' followed by one or more '+'/'-'.
    // The '+'/'-' run is required, so this never collides with a bare ':'.
    anonymous_label_ref: ($) => token(/:[-+]+/),

    parenthesized_expression: ($) => seq('(', $._expression, ')'),

    call_expression: ($) =>
      prec(
        PREC.call,
        seq(field('function', $.identifier), '(', optional($.argument_list), ')'),
      ),

    unary_expression: ($) =>
      prec(PREC.unary, seq(field('operator', choice('+', '-', '~', '!')), $._expression)),

    exp_expression: ($) =>
      prec.right(PREC.exp, seq($._expression, '**', $._expression)),

    binary_expression: ($) => {
      const table = [
        [PREC.mul, choice('*', '/', '%')],
        [PREC.shift, choice('<<', '>>>', '>>')],
        [PREC.bitwise, choice('&', '|', '^')],
        [PREC.add, choice('++', '+', '-')],
        [PREC.cmp, choice('===', '!==', '==', '!=', '<=', '>=', '<', '>')],
        [PREC.and, '&&'],
        [PREC.or, '||'],
      ];
      return choice(
        ...table.map(([p, op]) =>
          prec.left(
            p,
            seq(field('left', $._expression), field('operator', op), field('right', $._expression)),
          ),
        ),
      );
    },

    _number: ($) =>
      choice($.hex, $.octal, $.binary, $.fixed_point, $.decimal, $.graphics_constant, $.char_constant),

    // Order matters only for documentation; the lexer uses longest-match.
    decimal: ($) => token(/[0-9][0-9_]*/),
    hex: ($) => token(/(\$|0[xX])[0-9A-Fa-f][0-9A-Fa-f_]*/),
    octal: ($) => token(/(&|0[oO])[0-7][0-7_]*/),
    binary: ($) => token(/(%|0[bB])[01][01_]*/),
    fixed_point: ($) => token(/[0-9][0-9_]*\.[0-9][0-9_]*([qQ][0-9]+)?/),
    char_constant: ($) => token(/'(\\['"{}\\nrt0]|[^'\\\n])'/),

    // Game Boy 2bpp graphics constant: backtick + pixel digits (default 0-3).
    // Lenient on width (assembler requires 8); OPT g custom glyphs unsupported.
    graphics_constant: ($) => token(/`[0-3]+/),

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

    // Raw string: opaque, no escapes or interpolation. Cannot contain '"'.
    raw_string: ($) => token(/#"[^"\n]*"/),

    // All single-line string forms. Extended with multi-line forms in later tasks.
    _string: ($) => choice($.string, $.raw_string),

    // A symbol name: a plain identifier, a bare {interpolation}, or an
    // identifier/interpolation head glued (no whitespace) to more pieces.
    _symbol: ($) => choice($.identifier, $.interpolation, $.interpolated_identifier),

    // Head (identifier or interpolation) followed by ≥1 immediate pieces with
    // no intervening whitespace.  Aliases _immediate_interpolation to $.interpolation
    // so the child node type is uniform regardless of whether whitespace was
    // legal at that position.
    interpolated_identifier: ($) =>
      seq(
        choice($.identifier, $.interpolation),
        repeat1(choice(
          alias($._immediate_interpolation, $.interpolation),
          $._immediate_id_fragment,
        )),
      ),

    // token.immediate prevents any whitespace between the closing '}' of the
    // prior token and this '{'.
    _immediate_interpolation: ($) =>
      seq(token.immediate('{'), optional($.format_spec), $._interp_symbol, '}'),

    _immediate_id_fragment: ($) => token.immediate(/[A-Za-z0-9_#$@.]+/),

    section_directive: ($) =>
      seq(
        field('keyword', alias(kw('SECTION'), 'section_kw')),
        optional($.section_modifier),
        field('name', $._string),
        ',',
        $.section_type,
        repeat(seq(',', $.section_constraint)),
      ),

    section_modifier: ($) => kw('UNION', 'FRAGMENT'),

    section_type: ($) =>
      seq(
        kw('ROM0', 'ROMX', 'VRAM', 'SRAM', 'WRAM0', 'WRAMX', 'OAM', 'HRAM'),
        optional($.section_constraint),
      ),

    // [addr] / BANK[n] / ALIGN[n] / ALIGN[n,ofs]
    section_constraint: ($) =>
      choice(
        seq('[', $._expression, ']'),
        seq(field('keyword', alias(kw('BANK'), 'bank_kw')), '[', $._expression, ']'),
        seq(field('keyword', alias(kw('ALIGN'), 'align_kw')), '[', sepByComma($._expression), ']'),
      ),

    define_directive: ($) =>
      seq(
        field('keyword', alias(kw('DEF', 'REDEF'), 'def_kw')),
        field('name', $._symbol),
        choice(
          seq(field('keyword', alias(kw('EQU', 'EQUS', 'RB', 'RW', 'RL'), 'value_kw')), $._expression),
          seq($._assign_op, $._expression),
        ),
      ),

    _assign_op: (_$) =>
      choice('=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^='),

    export_directive: ($) => seq(field('keyword', alias(kw('EXPORT'), 'export_kw')), sepByComma($._symbol)),

    purge_directive: ($) => seq(field('keyword', alias(kw('PURGE'), 'purge_kw')), sepByComma($._symbol)),

    include_directive: ($) => seq(field('keyword', alias(kw('INCLUDE'), 'include_kw')), $._string),

    charmap_directive: ($) =>
      choice(
        seq(field('keyword', alias(kw('CHARMAP'), 'charmap_kw')), field('mapping', $._string), ',', sepByComma($._expression)),
        seq(field('keyword', alias(kw('NEWCHARMAP'), 'newcharmap_kw')), field('name', $._symbol), optional(seq(',', field('base', $._symbol)))),
        seq(field('keyword', alias(kw('SETCHARMAP'), 'setcharmap_kw')), field('name', $._symbol)),
        seq(field('keyword', alias(kw('PUSHC'), 'pushc_kw')), optional(field('name', $._symbol))),
        field('keyword', alias(kw('POPC'), 'popc_kw')),
      ),

    // Generic fallback for the many simple keyword directives.
    directive: ($) => seq($.directive_keyword, optional($.argument_list)),

    directive_keyword: (_$) =>
      kw(
        'PRINTLN', 'PRINT', 'INCBIN', 'RSSET', 'RSRESET', 'ASSERT',
        'STATIC_ASSERT', 'FAIL', 'WARN', 'FATAL', 'OPT', 'PUSHO', 'POPO',
        'PUSHS', 'POPS', 'SHIFT', 'BREAK', 'ENDSECTION',
      ),

    macro_invocation: ($) =>
      seq(field('name', $._symbol), optional($.argument_list)),

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

    identifier: ($) => token(/[A-Za-z_][A-Za-z0-9_#$@]*(\.[A-Za-z_][A-Za-z0-9_#$@]*)?/),

    local_label: ($) => token(/\.[A-Za-z_][A-Za-z0-9_#$@]*/),

    comment: ($) => token(seq(';', /[^\n]*/)),

    // Non-nesting block comment; usable mid-line, so it lives in `extras`.
    block_comment: ($) => token(seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/')),
  },
});
