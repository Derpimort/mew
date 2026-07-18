/* Quick-capture inbox (#348) — the deterministic, keyless offer engine. An
   inbox item is a captured intent that holds NO time (MEW law: optional/
   unscheduled events hold no time); it sits OFF the week grid until the owner
   places it. This module answers one question, purely: given the waiting items,
   the live week, and what local memory has learned, WHICH item fits WHICH free
   slot right now — so gbrain can OFFER a placement the owner confirms.

   It never mutates and never auto-schedules: fitOffers returns proposals, and
   the store turns a proposal into a block only on the owner's confirm, through
   the executor (human-in-the-loop). Pure + keyless: zero brain I/O, no Date.now
   (the caller passes `now`) — the same local floor #287/#321 read, so the offer
   is byte-identical with or without a key.

   The fit reads gbrain Pillars applied to WHERE a task lands: a CONFIRMED rule
   (#328) pins duration/tag/window; the learned energyProfile (#321) says which
   windows the owner DEMONSTRABLY finishes each kind of work. With neither (a
   fresh profile, no rules) it degrades to the honest floor — the soonest clear
   slot that fits — exactly the keyless "next fitting slot" the spec names. */

import type { Block, InboxItem, MemoryEvent, Tag, TimeWindow } from './types'
import { addDaysKey, dayKey, fmtDowLong, fmtTime, minOfDay } from './time'
import { DAY_END, DAY_START, findFreeSlot, nextFreeSlot } from './week'
import { aggregates } from './memory'
import {
  BAND_TO_WINDOW,
  ENERGY_BANDS,
  type EnergyProfile,
  type FocusClass,
  demonstratedDeepWindows,
  energyProfile,
  isDeepTask,
} from './energy'
import { confirmedRulesFrom } from './learn'
import { resolveTaskSpec } from './prefs'

/** A quick-capture with no duration hint becomes a 30-min block — the same
    quick-slot contract the #171 capture path and the rail's place already use. */
export const DEFAULT_DURATION_MIN = 30
/** How far forward a fit is worth offering — nextFreeSlot's own horizon. */
const HORIZON_DAYS = 13
/** Day-zero floor: never offer a slot that starts in the next quarter hour
    (proposeCaptureSlot's now+15 ethos) — the owner needs a beat to say yes. */
const NOW_GAP_MIN = 15
/** A band must complete admin/health at least this often before landing there
    counts as "fits your rhythm" — mirrors energy.DEEP_FLOOR for the other axes;
    below it the slot is still offered, just as a plain "soonest clear". */
const RATE_FLOOR = 0.5

/** One placement gbrain OFFERS for a waiting item — a proposal, never applied
    here. The store renders it as the choicesMsg/nudge the owner confirms, and
    only the confirm routes `{dayKey,startMin,durationMin}` through the executor. */
export interface InboxOffer {
  itemId: string
  dayKey: string
  startMin: number
  durationMin: number
  /** true when the slot lands where the owner DEMONSTRABLY fits this kind of
      work (a learned window / confirmed rule) — false is the honest floor: the
      soonest clear slot, offered without an energy claim. */
  fitsEnergy: boolean
  /** MEW-voiced, positive — WHY this slot fits ("you finish deep work in the
      morning" · "the soonest clear 30 min"). The store wraps it into the offer. */
  reason: string
}

const WINDOW_WORD: Record<TimeWindow, string> = {
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
}
/** the windows a preference walks through, clock order */
const WINDOW_ORDER: TimeWindow[] = ['morning', 'afternoon', 'evening']

/** A window's placement range, clamped to the app's day (DAY_START..DAY_END) —
    built from #321's bands so the inbox and the energy model agree on the edges
    (midday+late both fall in the afternoon window). Empty (from ≥ to) ⇒ the
    window doesn't fit inside the day and is skipped. */
function windowRange(w: TimeWindow): { from: number; to: number } {
  const bands = ENERGY_BANDS.filter((b) => BAND_TO_WINDOW[b.band] === w)
  const from = Math.max(DAY_START, Math.min(...bands.map((b) => b.from)))
  const to = Math.min(DAY_END, Math.max(...bands.map((b) => b.to)))
  return { from, to }
}

/** The focus class of a captured intent, from its hints alone — the owner's
    explicit `energy` wins, else it's read off tag+duration exactly as #321
    classifies a block (deep = work of an hour or more; private/short work is
    admin; health its own). Keyless and pure. */
function classify(item: InboxItem, tag: Tag, durationMin: number): FocusClass {
  if (item.energy) return item.energy
  if (tag === 'health') return 'health'
  if (isDeepTask({ tag, durationMin })) return 'deep'
  return 'admin'
}

/** The windows where the owner DEMONSTRABLY fits this class of work — deep work
    reads demonstratedDeepWindows (#321's anti-peak-ghetto rule); admin/health
    read a plain per-window completion floor. Empty ⇒ no demonstrated home, so
    the caller falls to the honest "soonest clear slot". */
function preferredWindows(cls: FocusClass, profile: EnergyProfile): TimeWindow[] {
  if (cls === 'deep') return demonstratedDeepWindows(profile)
  const winning = new Set<TimeWindow>()
  for (const b of ENERGY_BANDS) {
    const rate = profile.cells[b.band][cls].rate
    if (rate != null && rate >= RATE_FLOOR) winning.add(BAND_TO_WINDOW[b.band])
  }
  return WINDOW_ORDER.filter((w) => winning.has(w))
}

/** The earliest clear slot of `durationMin` that starts inside one of the
    preferred windows, scanning today (from now+gap) forward. Returns null when
    no preferred window has room in the horizon — the caller then offers the
    plain soonest slot. Pure: obstacles are read via findFreeSlot's own law
    (fixed/external hold time; optional/background stay transparent). */
function slotInWindows(
  blocks: readonly Block[],
  todayKey: string,
  nowMin: number,
  durationMin: number,
  preferred: readonly TimeWindow[]
): { dayKey: string; startMin: number } | null {
  if (!preferred.length) return null
  const pool = blocks as Block[]
  for (let off = 0; off <= HORIZON_DAYS; off++) {
    const key = addDaysKey(todayKey, off)
    for (const w of WINDOW_ORDER) {
      if (!preferred.includes(w)) continue
      const { from, to } = windowRange(w)
      const start = off === 0 ? Math.max(from, nowMin + NOW_GAP_MIN) : from
      if (start + durationMin > to) continue
      const slot = findFreeSlot(pool, key, durationMin, start, to)
      if (slot) return { dayKey: key, startMin: slot.startMin }
    }
  }
  return null
}

function reasonFor(
  fitsEnergy: boolean,
  cls: FocusClass,
  window: TimeWindow | null,
  ruleFirm: boolean,
  durationMin: number
): string {
  if (!fitsEnergy || !window) return `the soonest clear ${fmtDurWord(durationMin)}`
  if (ruleFirm) return `your usual ${WINDOW_WORD[window]}`
  if (cls === 'deep') return `you finish deep work in the ${WINDOW_WORD[window]}`
  if (cls === 'health') return `when you keep to health, ${WINDOW_WORD[window]}s`
  return `a clear ${WINDOW_WORD[window]} slot to knock it out`
}

/** "30 min" / "1h 30m" — the offer's duration in words. */
function fmtDurWord(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m} min`
}

/** The one-line offer body the store shows, MEW voice, positive:
    "Free 90 min at 15:00 today — you finish deep work in the afternoon. Drop
    'call the bank' in?" */
export function offerBody(title: string, offer: InboxOffer, todayKey: string): string {
  const when = offer.dayKey === todayKey ? 'today' : fmtDowLong(offer.dayKey)
  return `Free ${fmtDurWord(offer.durationMin)} at ${fmtTime(offer.startMin)} ${when} — ${offer.reason}. Drop “${title}” in?`
}

/** For each WAITING inbox item, the single best slot that fits it right now, or
    nothing when the horizon holds no room. Deterministic and keyless: a
    confirmed rule (#328) and the learned energyProfile (#321) shape the fit; with
    neither it's the soonest clear slot that fits. Offers are returned soonest
    first (then by id) so the caller's "offer one" pick is stable. Does NOT read
    lastOfferedDay — that once-per-day dedupe is the store's policy; this only
    answers "what fits now". `opts.energyFit` false omits the energy read (the
    Settings.energyFit 'off' gear), leaving the honest floor. */
export function fitOffers(
  inbox: readonly InboxItem[],
  blocks: readonly Block[],
  memory: readonly MemoryEvent[],
  now: Date,
  opts?: { energyFit?: boolean }
): InboxOffer[] {
  const todayKey = dayKey(now)
  const nowMin = minOfDay(now)
  const learned = confirmedRulesFrom(memory)
  const profile =
    opts?.energyFit === false ? null : energyProfile([...memory], aggregates([...memory], now), now)

  const offers: InboxOffer[] = []
  for (const item of inbox) {
    if (item.status !== 'open') continue

    /* the same resolver the executor uses at placement (#328): a confirmed rule
       fills the duration/tag it left open, and a FIRM window it pins outranks
       the learned profile (stated/confirmed word wins). Stated PrefPayloads and
       history stay for the actual placement (placeCaptureAt); the OFFER reads
       the confirmed rule + energy so the proposal already matches the owner. */
    const res = resolveTaskSpec(
      item.title,
      { tag: item.tag, durationMin: item.durationMin },
      [],
      undefined,
      learned
    )
    const durationMin = res.spec.durationMin ?? item.durationMin ?? DEFAULT_DURATION_MIN
    const tag: Tag = res.spec.tag ?? item.tag ?? 'work'
    const cls = classify(item, tag, durationMin)

    let preferred: TimeWindow[] = []
    const ruleFirm = res.spec.window != null && res.spec.windowFirm === true
    if (ruleFirm) preferred = [res.spec.window as TimeWindow]
    else if (profile) preferred = preferredWindows(cls, profile)

    let slot = slotInWindows(blocks, todayKey, nowMin, durationMin, preferred)
    let fitsEnergy = slot != null
    if (!slot) {
      slot = nextFreeSlot([...blocks], todayKey, nowMin + NOW_GAP_MIN, durationMin, HORIZON_DAYS)
      fitsEnergy = false
    }
    if (!slot) continue // the horizon is full — no honest slot to offer

    const window = ruleFirm ? (res.spec.window as TimeWindow) : windowOfMin(slot.startMin)
    offers.push({
      itemId: item.id,
      dayKey: slot.dayKey,
      startMin: slot.startMin,
      durationMin,
      fitsEnergy,
      reason: reasonFor(fitsEnergy, cls, window, ruleFirm, durationMin),
    })
  }

  offers.sort(
    (a, b) =>
      a.dayKey.localeCompare(b.dayKey) ||
      a.startMin - b.startMin ||
      a.itemId.localeCompare(b.itemId)
  )
  return offers
}

/** The window a minute falls in, via #321's bands (one home for the edges). */
function windowOfMin(min: number): TimeWindow | null {
  const band = ENERGY_BANDS.find((b) => min >= b.from && min < b.to)
  return band ? BAND_TO_WINDOW[band.band] : null
}
