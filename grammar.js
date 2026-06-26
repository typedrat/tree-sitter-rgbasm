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

// A single token matching any of the given case-insensitive keywords, with
// precedence 1 so it wins over `identifier` (precedence 0) on exact matches.
function kw(...words) {
  return token(prec(1, choice(...words.map(ci))));
}

// Comma-separated, non-empty list.
function sepByComma(rule) {
  return seq(rule, repeat(seq(',', rule)));
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
    _line_body: ($) => choice($.comment, $.data_directive, $.instruction_line),

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

    // Precedence 2 so `c` lexes as a condition (not register) ONLY in states
    // where a condition is valid — i.e. the first operand slot of a branch.
    condition_code: ($) => token(prec(2, choice(ci('nz'), ci('nc'), ci('z'), ci('c')))),

    _operand_list: ($) => sepByComma($._operand),

    _operand: ($) => choice($.mem_access, $.register, $.macro_argument, $._expression),

    mem_access: ($) => seq('[', choice($.register_increment, $.register, $._expression), ']'),

    // Atomic token: hli, hld, hl+, or hl- (case-insensitive for the hl/i/d parts).
    // Must be a single lexical token so the lexer does not commit to register_increment
    // when it sees bare `hl` (e.g. in `[hl]`).
    register_increment: ($) =>
      token(prec(2, /[hH][lL]([iI]|[dD]|[+]|[-])/)),

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
