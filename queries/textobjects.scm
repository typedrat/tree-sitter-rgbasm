; Macro/loop/conditional bodies act as "functions"; sections as "classes".
; Dual-named for nvim (.outer/.inner) and Helix/Zed (.around/.inside).
(macro_definition) @function.around @function.outer
(rept_block) @function.around @function.outer
(for_block) @function.around @function.outer
(if_block) @function.around @function.outer
(section_directive) @class.around @class.outer

(comment) @comment.around @comment.outer
(block_comment) @comment.around @comment.outer
