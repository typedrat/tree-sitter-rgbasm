; A small but representative RGBASM sample.
INCLUDE "hardware.inc"

DEF SCREEN_WIDTH  EQU 160
DEF COUNT = 0

SECTION "Main", ROM0[$0150]
Main::
    ld sp, $FFFE
.loop
    ld a, [hli]
    cp a, $00
    jr nz, .loop
    call DrawScreen
    jp Main

SECTION "Data", ROMX, BANK[2], ALIGN[4]
Greeting:
    db "Hello, world!\n", 0
Squares:
    FOR n, 0, 8
        dw n * n
    ENDR
