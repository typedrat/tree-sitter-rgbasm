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
  exp: 8,
  unary: 9,
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
    _line_body: ($) => choice($.comment, $.data_directive),

    data_directive: ($) =>
      seq(field('keyword', kw('DB', 'DW', 'DL', 'DS')), optional($.argument_list)),

    argument_list: ($) => sepByComma($._expression),

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
