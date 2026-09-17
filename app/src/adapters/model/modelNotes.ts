/** Tool-result guidance written for the keyed model (#119): what it must not do
    next, riding the result it reads. The keyed model reads every tool result
    whole. The keyless floor SPEAKS a tool result to the owner as MEW's reply, so
    it drops these notes first (`ownerView`) and keeps only the owner's line. One
    home for each note, read by the executor that writes it and by the floor that
    drops it, so the two can never drift apart.

    It lives in its own module, like ./choicesPosted, so the eager keyless floor
    never loads `./types` at runtime (#80 headroom). */

/** After a capture: the when-&-where nudge already offers a slot. */
export const CAPTURE_NUDGE_NOTE =
  " (The when-&-where nudge with a proposed slot is already posted — don't propose another time yourself.)"

/** Inside a clash note's "(flexible …)": offer to drift the other block, never move it. */
export const DRIFT_OFFER_NOTE = " — offer to drift it, don't move it unasked"

const MODEL_NOTES = [CAPTURE_NUDGE_NOTE, DRIFT_OFFER_NOTE]

/** A tool result as the owner hears it: every model-only note dropped, the rest
    byte-identical. */
export function ownerView(toolResult: string): string {
  return MODEL_NOTES.reduce((out, note) => out.split(note).join(''), toolResult)
}
