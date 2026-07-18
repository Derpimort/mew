/* The weekly-review offer (#346) — the once-a-week invite to close the week
   kindly. Pure, same discipline as weekly.ts / brief.ts: the store owns WHEN
   (once per ISO week, deduped via nudgeLastFired keyed on weekKey); this file
   only decides WHETHER the moment is right and WHAT the invite says. The invite
   is a dismissable offer — it OPENS the review surface, it never rolls anything.
   Keyless-templated (the numbers are the owner's own), positive voice by law:
   mews are celebrated, unfinished work is "carried", never a failure. */

import type { WeeklyReview } from '../review'
import { spell } from '../time'

/** Friday (Mon=0 … Sun=6) — the week is winding down, the natural moment to look
    back. Distinct from Sunday's shaping ritual (#304), which opens the NEXT
    week; this one closes the current one. */
export const REVIEW_OFFER_WEEKDAY = 4

/** Is now the weekly-review moment? Friday, at/after the evening-wrap time — late
    is honest (a Friday-night launch still gets the offer). The store's persisted
    weekKey owns once-per-week; this only gates the window. */
export function shouldOfferReview(dowMon0: number, nowMin: number, wrapMin: number): boolean {
  return dowMon0 === REVIEW_OFFER_WEEKDAY && nowMin >= wrapMin
}

/** The invite copy, in the owner's own numbers. Two shapes, both warm: with
    mews it leads on the celebration; a week that carried work without a logged
    completion still gets a kind look-back. Never names anything as missed,
    behind, or a broken streak. */
export function composeReviewOffer(review: WeeklyReview): { body: string } {
  const m = review.mews.length
  const c = review.carried.length
  const mewPart =
    m > 0 ? `${spell(m)} mew${m === 1 ? '' : 's'} to celebrate` : 'a whole week to look back on'
  const carryPart =
    c > 0
      ? ` — and ${spell(c)} thing${c === 1 ? '' : 's'} you can carry into next week if you like`
      : ''
  return { body: `friday — want your week in review? ${mewPart}${carryPart}.` }
}
