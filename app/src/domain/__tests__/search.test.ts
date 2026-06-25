/* domain/search.ts — the pure scoring floor behind global search (#170).
   Every acceptance criterion that is "given these items, this is the ranked
   answer" lives here; the store/UI only wire it up. Fixed inputs, no clock. */

import { describe, expect, it } from 'vitest'
import type { Block, Capture, ChatMessage } from '../types'
import { excerpt, flatten, fold, scoreText, search, totalHits } from '../search'

const WEEK = [
  '2026-06-08',
  '2026-06-09',
  '2026-06-10',
  '2026-06-11',
  '2026-06-12',
  '2026-06-13',
  '2026-06-14',
]
const NOW = new Date(2026, 5, 9, 12, 0).getTime() // Tue Jun 9, noon

function mkBlock(over: Partial<Block>): Block {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'X',
    tag: 'work',
    dayKey: '2026-06-09',
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}
function mkCap(over: Partial<Capture>): Capture {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'X',
    createdAt: NOW,
    status: 'open',
    ...over,
  }
}
function mkMsg(over: Partial<ChatMessage>): ChatMessage {
  return { id: Math.random().toString(36).slice(2), role: 'mew', body: 'X', ts: NOW, ...over }
}

function run(
  query: string,
  parts: { blocks?: Block[]; captures?: Capture[]; chat?: ChatMessage[] }
) {
  return search({
    query,
    blocks: parts.blocks ?? [],
    captures: parts.captures ?? [],
    chat: parts.chat ?? [],
    weekKeys: WEEK,
    nowMs: NOW,
  })
}

describe('fold — case + diacritics + whitespace', () => {
  it('lower-cases and collapses whitespace', () => {
    expect(fold('  Present   Deck ')).toBe('present deck')
  })
  it('strips accents so café matches cafe (acceptance: diacritics ignored)', () => {
    expect(fold('Café')).toBe('cafe')
    expect(fold('résumé')).toBe('resume')
  })
})

describe('scoreText — exact > prefix > word-start > substring', () => {
  it('orders the four tiers strictly', () => {
    const q = 'deck'
    const exact = scoreText('deck', q)
    const prefix = scoreText('deck prep', q)
    const word = scoreText('present deck', q) // starts the second word
    const sub = scoreText('redeck', q) // mid-word substring only
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(word)
    expect(word).toBeGreaterThan(sub)
    expect(sub).toBeGreaterThan(0)
  })
  it('a miss scores 0', () => {
    expect(scoreText('lunch', 'deck')).toBe(0)
  })
  it('an empty query scores 0 (palette shows commands, not everything)', () => {
    expect(scoreText('anything', '')).toBe(0)
  })
})

describe("search 'deck' — blocks grouped, capture separate (acceptance #1)", () => {
  const blocks = [
    mkBlock({ title: 'Present deck', dayKey: '2026-06-11' }),
    mkBlock({ title: 'Deck prep', dayKey: '2026-06-09' }),
    mkBlock({ title: 'Lunch', dayKey: '2026-06-09' }), // not a match
  ]
  const captures = [mkCap({ title: 'Deck review' }), mkCap({ title: 'Call bank' })]

  it('returns the two matching blocks and the one matching capture', () => {
    const r = run('deck', { blocks, captures })
    expect(r.block.map((h) => h.title).sort()).toEqual(['Deck prep', 'Present deck'])
    expect(r.capture.map((h) => h.title)).toEqual(['Deck review'])
    expect(totalHits(r)).toBe(3)
  })

  it('blocks carry their day so the UI can jump to it', () => {
    const r = run('deck', { blocks, captures })
    const present = r.block.find((h) => h.title === 'Present deck')!
    expect(present.dayKey).toBe('2026-06-11')
    expect(present.detail).toMatch(/^\d\d:\d\d–\d\d:\d\d/)
  })
})

describe('exact match floats to top + live reorder as the query grows (acceptance #2)', () => {
  const blocks = [mkBlock({ title: 'Deck prep' }), mkBlock({ title: 'Present deck' })]

  it("exact 'present deck' beats the prefix 'deck prep'", () => {
    const r = run('present deck', { blocks })
    expect(r.block[0].title).toBe('Present deck')
  })

  it("'Pre' shows both, 'Prese' narrows to just 'Present deck'", () => {
    const pre = run('pre', { blocks })
    // "pre" prefixes "Present deck" and starts a word in "Deck prep" → both present
    expect(pre.block.map((h) => h.title).sort()).toEqual(['Deck prep', 'Present deck'])
    const prese = run('prese', { blocks })
    expect(prese.block.map((h) => h.title)).toEqual(['Present deck'])
  })
})

describe('case-insensitive + diacritic-insensitive end to end (acceptance #4)', () => {
  it("'CAFE' matches a 'Café catch-up' block", () => {
    const blocks = [mkBlock({ title: 'Café catch-up' })]
    const r = run('CAFE', { blocks })
    expect(r.block).toHaveLength(1)
    expect(r.block[0].title).toBe('Café catch-up')
  })
})

describe('current-week blocks rank above older/future ones (recency law)', () => {
  it('a same-title block in this week outranks one outside it', () => {
    const thisWeek = mkBlock({ title: 'Roadmap', dayKey: '2026-06-10' })
    const lastMonth = mkBlock({ title: 'Roadmap', dayKey: '2026-05-10' })
    const r = run('roadmap', { blocks: [lastMonth, thisWeek] })
    expect(r.block[0].id).toBe(thisWeek.id)
  })

  it('an open block outranks a settled (done/rolled) one of the same match', () => {
    const open = mkBlock({ title: 'Ship', status: 'open' })
    const done = mkBlock({ title: 'Ship', status: 'done' })
    const r = run('ship', { blocks: [done, open] })
    expect(r.block[0].id).toBe(open.id)
    // but the settled one is still findable — "did I already do X?"
    expect(r.block).toHaveLength(2)
  })
})

describe('captures — open (unplaced) first, then placed/done', () => {
  it('an open capture outranks a placed one of equal text match', () => {
    const open = mkCap({ title: 'Invoice', status: 'open' })
    const placed = mkCap({ title: 'Invoice', status: 'placed' })
    const r = run('invoice', { captures: [placed, open] })
    expect(r.capture[0].id).toBe(open.id)
    expect(r.capture[0].detail).toBe('unplaced')
  })
})

describe('chat — recency boost + query-centered excerpt + speaker label', () => {
  it('a fresher message of equal match ranks above an older one', () => {
    const old = mkMsg({ body: 'we should redesign the deck', ts: NOW - 10 * 24 * 3600 * 1000 })
    const fresh = mkMsg({ body: 'we should redesign the deck', ts: NOW - 60 * 1000 })
    const r = run('deck', { chat: [old, fresh] })
    expect(r.chat[0].id).toBe(fresh.id)
  })

  it('labels the speaker and excerpts around the match', () => {
    const m = mkMsg({
      role: 'user',
      body: 'reminder: '.padEnd(80, 'x') + ' deck ' + 'y'.repeat(80),
    })
    const r = run('deck', { chat: [m] })
    expect(r.chat[0].detail).toBe('you')
    expect(r.chat[0].title).toContain('deck')
    expect(r.chat[0].title.startsWith('…')).toBe(true) // trimmed lead
    expect(r.chat[0].title.endsWith('…')).toBe(true) // trimmed tail
  })

  it('skips empty-body messages (streaming placeholders)', () => {
    const r = run('deck', { chat: [mkMsg({ body: '   ' }), mkMsg({ body: 'deck' })] })
    expect(r.chat).toHaveLength(1)
  })
})

describe('flatten — keyboard order is blocks, then captures, then chat', () => {
  it('concatenates the three groups in render order', () => {
    const r = run('x-none', {})
    expect(flatten(r)).toEqual([])
    const blocks = [mkBlock({ title: 'deck' })]
    const captures = [mkCap({ title: 'deck' })]
    const chat = [mkMsg({ body: 'deck' })]
    const flat = flatten(run('deck', { blocks, captures, chat }))
    expect(flat.map((h) => h.kind)).toEqual(['block', 'capture', 'chat'])
  })
})

describe('empty / blank query → no hits (acceptance: palette shows commands)', () => {
  it('returns empty groups for an empty or whitespace query', () => {
    expect(totalHits(run('', { blocks: [mkBlock({ title: 'deck' })] }))).toBe(0)
    expect(totalHits(run('   ', { blocks: [mkBlock({ title: 'deck' })] }))).toBe(0)
  })
})

describe('performance — 100+ blocks, 20+ captures, 200+ chat under budget (acceptance #6)', () => {
  it('scores a large corpus in well under the 500ms ceiling', () => {
    const blocks = Array.from({ length: 150 }, (_, i) =>
      mkBlock({ title: `Task ${i} ${i % 7 === 0 ? 'deck' : 'misc'}`, dayKey: WEEK[i % 7] })
    )
    const captures = Array.from({ length: 30 }, (_, i) => mkCap({ title: `Capture ${i} deck` }))
    const chat = Array.from({ length: 250 }, (_, i) =>
      mkMsg({ body: `message ${i} about ${i % 5 === 0 ? 'deck' : 'things'}`, ts: NOW - i * 60000 })
    )
    const t0 = performance.now()
    const r = search({ query: 'deck', blocks, captures, chat, weekKeys: WEEK, nowMs: NOW })
    const dt = performance.now() - t0
    expect(dt).toBeLessThan(500)
    // caps keep any one kind from burying the others
    expect(r.block.length).toBeLessThanOrEqual(8)
    expect(r.capture.length).toBeLessThanOrEqual(8)
    expect(r.chat.length).toBeLessThanOrEqual(8)
  })
})

describe('excerpt — single line, clamped, ellipsis on trimmed edges', () => {
  it('collapses newlines and returns the head when no match', () => {
    expect(excerpt('a\n\nb   c', '')).toBe('a b c')
  })
})
