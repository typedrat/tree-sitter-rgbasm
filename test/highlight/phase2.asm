SECTION "Phase2", ROM0

DB `01012323, `00112233
CHARMAP "A", 42
NEWCHARMAP custom, main

Greeting:
    PRINTLN "Hi {WHO}, sum={d:TOTAL}"
    DB #"raw \1 {literal}"
    DB """multi
line {x:N}"""

:
    jr :-
    jp :+
:

DEF {prefix}_value = 1
