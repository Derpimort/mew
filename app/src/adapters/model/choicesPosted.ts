/** Tool results beginning with this token mean the executor already posted the
    question as clickable chips (#254): a model should END its turn and say
    nothing more; the keyless floor yields nothing at all — the chips message
    IS the reply. One token, both paths, so the two can never disagree.

    It lives in its own module so the eager code that reads it (the keyless
    floor, the store) never has to load `./types` at runtime: that module also
    holds MEW_VOICE, the keyed model's ~15 KB system prompt, which only the lazy
    AI adapter needs (#80 headroom). */
export const CHOICES_POSTED = 'The options are on screen as clickable chips'
