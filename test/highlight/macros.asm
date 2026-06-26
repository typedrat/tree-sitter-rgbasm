SECTION "Macros", ROM0

MACRO lb
    ld \1, (\2) << 8 | (\3)
ENDM

MACRO load_loop
    xor a, a
.loop\@
    ld [hl+], a
    dec c
    jr nz, .loop\@
ENDM

    lb hl, 20, 18
    REPT 4
        add a, c
    ENDR
    IF DEF(DEBUG)
        WARN "debug build"
    ENDC
