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
      seq(kw('MACRO'), field('name', $.identifier), blockBody($), kw('ENDM')),

    rept_block: ($) =>
      seq(kw('REPT'), field('count', $._expression), blockBody($), kw('ENDR')),

    for_block: ($) =>
      seq(
        kw('FOR'),
        field('variable', $.identifier),
        ',',
        sepByComma($._expression),
        blockBody($),
        kw('ENDR'),
      ),

    if_block: ($) =>
      seq(
        kw('IF'),
        field('condition', $._expression),
        blockBody($),
        repeat($.elif_clause),
        optional($.else_clause),
        kw('ENDC'),
      ),

    elif_clause: ($) =>
      seq(kw('ELIF'), field('condition', $._expression), blockBody($)),

    else_clause: ($) => seq(kw('ELSE'), blockBody($)),

    union_block: ($) =>
      seq(kw('UNION'), blockBody($), repeat($.nextu_clause), kw('ENDU')),

    nextu_clause: ($) => seq(kw('NEXTU'), blockBody($)),

    load_block: ($) =>
      seq(
        kw('LOAD'),
        optional(field('modifier', $.section_modifier)),
        field('name', $.string),
        ',',
        $.section_type,
        blockBody($),
        kw('ENDL'),
      ),

    data_directive: ($) =>
      seq(field('keyword', kw('DB', 'DW', 'DL', 'DS')), optional($.argument_list)),

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

    _expression: ($) =>
      choice(
        $._number,
        $.string,
        $.identifier,
        $.local_label,
        $.program_counter,
        $.macro_argument,
        $.parenthesized_expression,
        $.unary_expression,
        $.binary_expression,
        $.exp_expression,
        $.call_expression,
      ),

    program_counter: ($) => token('@'),

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
      choice($.hex, $.octal, $.binary, $.fixed_point, $.decimal, $.char_constant),

    // Order matters only for documentation; the lexer uses longest-match.
    decimal: ($) => token(/[0-9][0-9_]*/),
    hex: ($) => token(/(\$|0[xX])[0-9A-Fa-f][0-9A-Fa-f_]*/),
    octal: ($) => token(/(&|0[oO])[0-7][0-7_]*/),
    binary: ($) => token(/(%|0[bB])[01][01_]*/),
    fixed_point: ($) => token(/[0-9][0-9_]*\.[0-9][0-9_]*([qQ][0-9]+)?/),
    char_constant: ($) => token(/'(\\['"{}\\nrt0]|[^'\\\n])'/),

    string: ($) =>
      seq('"', repeat(choice($.escape_sequence, $._string_content)), token.immediate('"')),
    _string_content: ($) => token.immediate(prec(1, /[^"\\\n]+/)),
    escape_sequence: ($) => token.immediate(/\\['"{}\\nrt0]/),

    section_directive: ($) =>
      seq(
        kw('SECTION'),
        optional($.section_modifier),
        field('name', $.string),
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
        seq(kw('BANK'), '[', $._expression, ']'),
        seq(kw('ALIGN'), '[', sepByComma($._expression), ']'),
      ),

    define_directive: ($) =>
      seq(
        kw('DEF', 'REDEF'),
        field('name', $.identifier),
        choice(
          seq(kw('EQU', 'EQUS', 'RB', 'RW', 'RL'), $._expression),
          seq($._assign_op, $._expression),
        ),
      ),

    _assign_op: (_$) =>
      choice('=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^='),

    export_directive: ($) => seq(kw('EXPORT'), sepByComma($.identifier)),

    purge_directive: ($) => seq(kw('PURGE'), sepByComma($.identifier)),

    include_directive: ($) => seq(kw('INCLUDE'), $.string),

    // Generic fallback for the many simple keyword directives.
    directive: ($) => seq($.directive_keyword, optional($.argument_list)),

    directive_keyword: (_$) =>
      kw(
        'PRINTLN', 'PRINT', 'INCBIN', 'RSSET', 'RSRESET', 'ASSERT',
        'STATIC_ASSERT', 'FAIL', 'WARN', 'FATAL', 'OPT', 'PUSHO', 'POPO',
        'PUSHS', 'POPS', 'PUSHC', 'POPC', 'NEWCHARMAP', 'SETCHARMAP', 'CHARMAP',
        'SHIFT', 'BREAK', 'ENDSECTION',
      ),

    macro_invocation: ($) =>
      seq(field('name', $.identifier), optional($.argument_list)),

    label_definition: ($) =>
      choice(
        // Global/scoped labels require a colon (distinguishes from macro calls).
        seq(field('name', $.identifier), choice('::', ':')),
        // Local labels may omit the colon.
        seq(field('name', $.local_label), optional(choice('::', ':'))),
      ),

    identifier: ($) => token(/[A-Za-z_][A-Za-z0-9_#$@]*(\.[A-Za-z_][A-Za-z0-9_#$@]*)?/),

    local_label: ($) => token(/\.[A-Za-z_][A-Za-z0-9_#$@]*/),

    comment: ($) => token(seq(';', /[^\n]*/)),

    // Non-nesting block comment; usable mid-line, so it lives in `extras`.
    block_comment: ($) => token(seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/')),
  },
});
