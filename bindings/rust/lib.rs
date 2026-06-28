//! This crate provides Rgbasm language support for the [tree-sitter] parsing library.
//!
//! Typically, you will use the [`LANGUAGE`] constant to add this language to a
//! tree-sitter [`Parser`], and then use the parser to parse some code:
//!
//! ```
//! let code = "nop\n";
//! let mut parser = tree_sitter::Parser::new();
//! let language = tree_sitter_rgbasm::LANGUAGE;
//! parser
//!     .set_language(&language.into())
//!     .expect("Error loading Rgbasm parser");
//! let tree = parser.parse(code, None).unwrap();
//! assert!(!tree.root_node().has_error());
//! ```
//!
//! [`Parser`]: https://docs.rs/tree-sitter/0.26.9/tree_sitter/struct.Parser.html
//! [tree-sitter]: https://tree-sitter.github.io/

use tree_sitter_language::LanguageFn;

extern "C" {
    fn tree_sitter_rgbasm() -> *const ();
}

/// The tree-sitter [`LanguageFn`] for this grammar.
pub const LANGUAGE: LanguageFn = unsafe { LanguageFn::from_raw(tree_sitter_rgbasm) };

/// The content of the [`node-types.json`] file for this grammar.
///
/// [`node-types.json`]: https://tree-sitter.github.io/tree-sitter/using-parsers/6-static-node-types
pub const NODE_TYPES: &str = include_str!("../../src/node-types.json");

#[cfg(with_highlights_query)]
/// The syntax highlighting query for this grammar.
pub const HIGHLIGHTS_QUERY: &str = include_str!("../../queries/highlights.scm");

#[cfg(with_injections_query)]
/// The language injection query for this grammar.
pub const INJECTIONS_QUERY: &str = include_str!("../../queries/injections.scm");

#[cfg(with_locals_query)]
/// The local variable query for this grammar.
pub const LOCALS_QUERY: &str = include_str!("../../queries/locals.scm");

#[cfg(with_tags_query)]
/// The symbol tagging query for this grammar.
pub const TAGS_QUERY: &str = include_str!("../../queries/tags.scm");

// Strongly-typed AST structs and enums generated from `node-types.json` at
// build time (see build.rs). Named nodes become structs, supertypes become
// enums, optional fields are `Option<T>`, repeated fields are `Vec<T>`.
// Construct the root with `SourceFile::from_node` and walk via the generated
// accessors. Runtime traits and the matching `tree_sitter` re-export come from
// the `treesitter-types` crate.
include!(concat!(env!("OUT_DIR"), "/treesitter_types_generated.rs"));

#[cfg(test)]
mod tests {
    #[test]
    fn test_can_load_grammar() {
        let mut parser = tree_sitter::Parser::new();
        parser
            .set_language(&super::LANGUAGE.into())
            .expect("Error loading Rgbasm parser");
    }

    #[test]
    fn typed_ast_root_exposes_statements() {
        use treesitter_types::FromNode;

        let src = b"nop\n";
        let mut parser = tree_sitter::Parser::new();
        parser
            .set_language(&super::LANGUAGE.into())
            .expect("Error loading Rgbasm parser");
        let tree = parser.parse(src, None).unwrap();

        let source_file = super::SourceFile::from_node(tree.root_node(), src)
            .expect("root node is a source_file");
        assert_eq!(source_file.children.len(), 1);
    }
}
