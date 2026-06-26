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
  unary: 8,
  exp: 9,
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
    _line_body: ($) => $.comment,

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
