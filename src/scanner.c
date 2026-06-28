#include "tree_sitter/parser.h"

enum TokenType {
  ML_STRING_CONTENT,      // non-raw """...""": stops before """, '{', or '\\'
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
