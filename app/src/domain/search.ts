/* Global search — pure scoring over the week's own data (blocks, captures,
   chat). No side effects, no I/O, no clock of its own: the caller passes
   `nowMs` and `weekKeys` so a fixed clock makes every ranking deterministic.
   This is the read-only floor #170 asks for — the store reads it, the palette
   renders it; nothing here mutates the week. */

import type { Block, Capture, ChatMessage } from './types'

export type SearchKind = 'block' | 'capture' | 'chat'

export interface SearchHit {
  kind: SearchKind
  /** the source id — a block/capture/message id, enough to jump to it */
  id: string
  /** the matched line, already trimmed of any "— qualifier" for blocks */
  title: string
  /** secondary line for the row: a time range, a status, a speaker+stamp */
  detail: string
  /** dayKey for blocks/captures (placement target); chat carries its own ts */
  dayKey?: string
  /** the relevance score — higher is better; only used to sort, never shown */
  score: number
  /** for chat: the speaker, so the row can label "you"/"mew"/"nudge" */
  role?: ChatMessage['role']
  /** raw timestamp for recency display + tie-breaks (captures/chat) */
  ts?: number
}

/** Match tiers, highest first. A miss is 0 (the row is dropped). The numbers
    are gaps, not magnitudes — exact always beats prefix beats word-start beats
    substring, regardless of any recency/recency-week boost added on top. */
const TIER_EXACT = 1000
const TIER_PREFIX = 600
const TIER_WORD = 400
const TIER_SUBSTRING = 200

/** Fold a string for matching: lower-cased, diacritics stripped ("café" →
    "cafe"), runs of whitespace collapsed. Pure and allocation-light — used on
    both the query and every candidate, so "café" matches "Cafe" and back. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // combining marks — the accent layer
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Score one candidate haystack against an already-folded query. Returns 0
    when the query isn't present at all — the caller drops those. Shorter
    haystacks rank a hair higher within a tier so "Deck" beats "Deck prep
    revisited" for the bare query "deck" (a gentle length nudge, never enough
    to cross a tier). */
export function scoreText(haystack: string, foldedQuery: string): number {
  if (!foldedQuery) return 0
  const h = fold(haystack)
  if (!h) return 0
  if (h === foldedQuery) return TIER_EXACT + lengthNudge(h)
  if (h.startsWith(foldedQuery)) return TIER_PREFIX + lengthNudge(h)
  // a query that starts a WORD inside the title ("prese" in "the presentation")
  if (new RegExp(`\\b${escapeRe(foldedQuery)}`).test(h)) return TIER_WORD + lengthNudge(h)
  if (h.includes(foldedQuery)) return TIER_SUBSTRING + lengthNudge(h)
  return 0
}

function lengthNudge(h: string): number {
  // ≤ 50, shrinking with length — never enough to jump a 200-point tier gap
  return Math.max(0, 50 - h.length)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The base title of a block — the part before any "— qualifier", matching how
    the store and confirmations name blocks everywhere else. */
function baseTitle(title: string): string {
  return title.split('—')[0].trim()
}

export interface SearchInput {
  query: string
  blocks: Block[]
  captures: Capture[]
  chat: ChatMessage[]
  /** the seven dayKeys of the current week — blocks inside get a relevance
      boost over older/future ones (recency law for the planner). */
  weekKeys: string[]
  nowMs: number
  /** cap per kind so a noisy chat history can't bury blocks (default 8) */
  limitPerKind?: number
}

const WEEK_BOOST = 60 // inside the current week — under one tier, over length
const RECENCY_MAX = 50 // freshest chat/capture, decaying over ~14 days
const RECENCY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

function recencyBoost(ts: number, nowMs: number): number {
  const age = Math.max(0, nowMs - ts)
  if (age >= RECENCY_WINDOW_MS) return 0
  return Math.round(RECENCY_MAX * (1 - age / RECENCY_WINDOW_MS))
}

/** Search blocks, captures, and chat in one pass and return hits grouped by
    kind, each group sorted best-first. Empty/blank query → empty groups (the
    palette shows its command list instead). Rolled blocks and placed/done
    captures are still findable — "did I already plan X?" is exactly the
    question this answers — but live items rank above settled ones. */
export function search(input: SearchInput): Record<SearchKind, SearchHit[]> {
  const { blocks, captures, chat, weekKeys, nowMs } = input
  const limit = input.limitPerKind ?? 8
  const q = fold(input.query)
  const out: Record<SearchKind, SearchHit[]> = { block: [], capture: [], chat: [] }
  if (!q) return out

  const inWeek = new Set(weekKeys)

  for (const b of blocks) {
    const base = baseTitle(b.title)
    const s = scoreText(base, q)
    if (!s) continue
    const weekBonus = inWeek.has(b.dayKey) ? WEEK_BOOST : 0
    // an open block outranks a settled (done/rolled) one of the same match
    const liveBonus = b.status === 'open' ? 20 : 0
    out.block.push({
      kind: 'block',
      id: b.id,
      title: base,
      detail: blockDetail(b),
      dayKey: b.dayKey,
      score: s + weekBonus + liveBonus,
    })
  }

  for (const c of captures) {
    const s = scoreText(c.title, q)
    if (!s) continue
    // open (unplaced) captures first — they're the ones still asking for a home
    const openBonus = c.status === 'open' ? 40 : 0
    out.capture.push({
      kind: 'capture',
      id: c.id,
      title: c.title,
      detail: c.status === 'open' ? 'unplaced' : c.status,
      score: s + openBonus + recencyBoost(c.createdAt, nowMs),
      ts: c.createdAt,
    })
  }

  for (const m of chat) {
    const body = m.body.trim()
    if (!body) continue
    const s = scoreText(body, q)
    if (!s) continue
    out.chat.push({
      kind: 'chat',
      id: m.id,
      title: excerpt(body, q),
      detail: speakerLabel(m.role),
      score: s + recencyBoost(m.ts, nowMs),
      role: m.role,
      ts: m.ts,
    })
  }

  const byScore = (a: SearchHit, b: SearchHit) => b.score - a.score || (b.ts ?? 0) - (a.ts ?? 0)
  out.block.sort(byScore)
  out.capture.sort(byScore)
  out.chat.sort(byScore)
  out.block = out.block.slice(0, limit)
  out.capture = out.capture.slice(0, limit)
  out.chat = out.chat.slice(0, limit)
  return out
}

/** Total hit count across all kinds — for the palette's "n found" line and
    the empty-state branch. */
export function totalHits(groups: Record<SearchKind, SearchHit[]>): number {
  return groups.block.length + groups.capture.length + groups.chat.length
}

/** Flatten the grouped hits into the keyboard-navigation order the palette
    walks with ↑/↓: blocks, then captures, then chat — the same top-to-bottom
    order they render in. */
export function flatten(groups: Record<SearchKind, SearchHit[]>): SearchHit[] {
  return [...groups.block, ...groups.capture, ...groups.chat]
}

/* ── detail formatters (pure presentation strings) ──────────────────── */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** A compact HH:MM–HH:MM for a block row (local minutes-of-day). Kept here so
    search has no dependency on time.ts's locale formatters — a row is a label,
    not a clock. */
function hhmm(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
}

function blockDetail(b: Block): string {
  const range = `${hhmm(b.startMin)}–${hhmm(b.endMin)}`
  const flags = [
    b.status === 'done' ? 'done' : b.status === 'rolled' ? 'rolled' : null,
    b.external ? 'calendar' : null,
  ].filter(Boolean)
  return flags.length ? `${range} · ${flags.join(' · ')}` : range
}

function speakerLabel(role: ChatMessage['role']): string {
  return role === 'user' ? 'you' : role === 'nudge' ? 'nudge' : 'mew'
}

/** A short, query-centered excerpt of a chat body: a window around the first
    match so the row shows context, not the head of a long message. Single line
    (newlines collapsed); an ellipsis marks a trimmed edge. */
export function excerpt(body: string, foldedQuery: string, radius = 32): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  if (!foldedQuery) return clamp(flat, radius * 2)
  const idx = fold(flat).indexOf(foldedQuery)
  if (idx < 0) return clamp(flat, radius * 2)
  const start = Math.max(0, idx - radius)
  const end = Math.min(flat.length, idx + foldedQuery.length + radius)
  const lead = start > 0 ? '…' : ''
  const tail = end < flat.length ? '…' : ''
  return `${lead}${flat.slice(start, end)}${tail}`
}

function clamp(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}
