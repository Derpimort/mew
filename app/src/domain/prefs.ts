/* Applying the standing rulebook — pure. A remembered preference changes
   MECHANICS, not just prose: time-defaults choose the slot, duration-
   defaults size the block, flexibility overrides the fixed-time heuristic.
   The law throughout: prefs fill DEFAULTS — anything the user said
   explicitly in this message always wins. */

import type { PrefPayload } from './types'

/** A rule matches a block when its normalized `match` phrase appears on
    token boundaries in the normalized title (the base half, before any
    em-dash detail). Whole tokens only: "call" never hits "Recall budget". */
export function matchesPref(title: string, match: string): boolean {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .split('—')[0]
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const t = norm(title)
  const m = norm(match)
  return m.length > 0 && ` ${t} `.includes(` ${m} `)
}

/** "starts 07:00" → 420; tolerant of a bare "07:00" or "7am". */
export function parseTimeValue(value: string): number | null {
  const m = value.match(/(\d{1,2}):(\d{2})/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  const ampm = value.match(/\b(\d{1,2})\s*(am|pm)\b/i)
  if (ampm) {
    let h = Number(ampm[1])
    if (ampm[2].toLowerCase() === 'pm' && h < 12) h += 12
    if (ampm[2].toLowerCase() === 'am' && h === 12) h = 0
    return h * 60
  }
  return null
}

/** "45m" / "45 min" / "1.5h" → minutes. */
export function parseDurationValue(value: string): number | null {
  const h = value.match(/(\d+(?:\.\d+)?)\s*h\b/i)
  if (h) return Math.round(Number(h[1]) * 60)
  const m = value.match(/(\d+)\s*m(?:in)?\b/i)
  if (m) return Number(m[1])
  return null
}

export interface PlacementDefaults {
  title: string
  startMin?: number
  endMin?: number
  durationMin?: number
}

/** Fill missing placement fields from matching rules. Explicit values are
    never touched — suggest, don't seize, even against the user's own rules. */
export function applyPrefs<T extends PlacementDefaults>(
  spec: T,
  prefs: PrefPayload[],
): { spec: T & PlacementDefaults; applied: PrefPayload[] } {
  const applied: PrefPayload[] = []
  let next: T & PlacementDefaults = spec
  for (const p of prefs) {
    if (!matchesPref(spec.title, p.match)) continue
    if (p.kind === 'time-default' && next.startMin == null && next.endMin == null) {
      const min = parseTimeValue(p.value)
      if (min != null) {
        next = { ...next, startMin: min }
        applied.push(p)
      }
    }
    if (p.kind === 'duration-default' && next.durationMin == null && next.endMin == null) {
      const dur = parseDurationValue(p.value)
      if (dur != null) {
        next = { ...next, durationMin: dur }
        applied.push(p)
      }
    }
  }
  return { spec: next, applied }
}

/** A flexibility rule overrides the fixed-time word heuristic — in either
    direction. Classification only: collision honesty is untouched. */
export function flexOverride(title: string, prefs: PrefPayload[]): 'fixed' | 'flexible' | null {
  for (const p of prefs) {
    if (p.kind !== 'flexibility' || !matchesPref(title, p.match)) continue
    if (/never moves|fixed|can'?t move/i.test(p.value)) return 'fixed'
    if (/can (?:always )?move|flexible|movable/i.test(p.value)) return 'flexible'
  }
  return null
}
