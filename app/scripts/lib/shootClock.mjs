/* One pinned calendar day for the canon shoot gates.
   The first-run seed anchors its lived-in week to the app's TODAY (state/seed.ts):
   the days already behind today carry the "done" history. On a Monday there is no
   day behind today, so at ?t=9:40 the visible week held no done block and
   shoot.mjs's remove-affordance phase timed out — the dependabot runs of
   ui-overlap.yml on Mondays Aug 17/24/31 all went red there (Sep 7 failed earlier,
   at build), while the Wednesday run passed. The app already honours a day override
   (`?d=YYYY-MM-DD`, state/store.ts clockOffsetMs, #304), so the gates pin the DAY
   as well as the time: the seeded week, the Node-side weekday math and the canon
   PNGs are the same on whatever weekday the runner wakes up.
   SHOOT_DATE=YYYY-MM-DD probes another day (PROBING). Only a probe may self-seed
   remove-affordance's done block: on the pin, a week with no seeded done block is a
   seed regression, and the gate fails on it. */

/** A Wednesday: two lived days behind it, the heavy tomorrow ahead of it. */
export const DEFAULT_DATE = '2026-09-16'
const raw = process.env.SHOOT_DATE ?? ''
if (raw !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
  /* never fall back silently: a typo would run the pinned day and report green for it */
  throw new Error(`SHOOT_DATE must be YYYY-MM-DD, got ${JSON.stringify(raw)}`)
}
export const SHOOT_DATE = raw || DEFAULT_DATE
/** true only when SHOOT_DATE probes a day other than the pin; the gate is the pin */
export const PROBING = SHOOT_DATE !== DEFAULT_DATE

/** The pinned day as a local Date at noon — weekday math can never straddle midnight. */
export const shootDay = () => new Date(`${SHOOT_DATE}T12:00:00`)

/** base + `?d=<pinned day>&t=<HH:MM>`. EVERY page load must carry the day, or the app
    snaps back to the real date and the seeded week turns into last week. Built with
    URL, so a trailing slash or an existing query on the base can't break it. */
export const clockUrl = (base, t) => {
  const url = new URL(base)
  url.searchParams.set('d', SHOOT_DATE)
  url.searchParams.set('t', t)
  return url.toString()
}
