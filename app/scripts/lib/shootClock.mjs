/* One pinned calendar day for the canon shoot gates.
   The first-run seed anchors its lived-in week to the app's TODAY (state/seed.ts):
   the days already behind today carry the "done" history. On a Monday there is no
   day behind today, so at ?t=9:40 the visible week held no done block and
   shoot.mjs's remove-affordance phase timed out — every dependabot run of
   ui-overlap.yml landed on a Monday (Aug 17/24/31, Sep 7) and every one went red,
   while the Wednesday run passed. The app already honours a day override
   (`?d=YYYY-MM-DD`, state/store.ts clockOffsetMs, #304), so the gates pin the DAY
   as well as the time: the seeded week, the Node-side weekday math and the canon
   PNGs are the same on whatever weekday the runner wakes up.
   SHOOT_DATE=YYYY-MM-DD overrides the pin (a Monday proves the gate no longer
   depends on the seed's history at all — remove-affordance seeds its own done
   block when the week has none). */

/** A Wednesday: two lived days behind it, the heavy tomorrow ahead of it. */
const DEFAULT_DATE = '2026-09-16'
const override = process.env.SHOOT_DATE ?? ''
export const SHOOT_DATE = /^\d{4}-\d{2}-\d{2}$/.test(override) ? override : DEFAULT_DATE

/** The pinned day as a local Date at noon — weekday math can never straddle midnight. */
export const shootDay = () => new Date(`${SHOOT_DATE}T12:00:00`)

/** `${base}/?d=<pinned day>&t=<HH:MM>` — EVERY page load must carry the day, or the app
    snaps back to the real date and the seeded week turns into last week. */
export const clockUrl = (base, t) => `${base}/?d=${SHOOT_DATE}&t=${t}`
