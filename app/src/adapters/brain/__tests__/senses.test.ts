/* Senses — the pure mapping layer is where wrong knowledge would enter the
   graph, so it carries the tests: slugs, people extraction (deliberate
   patterns only), event pages, and the chat batcher's coalescing. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage } from '../../../domain/types'
import {
  blockEventPage,
  chatBatchPage,
  debriefPage,
  explicitProjectFrom,
  knownProjectsFrom,
  makeChatBatcher,
  parsePrefBody,
  peopleFrom,
  prefPage,
  projectsFrom,
  slugify,
  taskSlug,
} from '../senses'

const D = '2026-06-09'

function mk(over: Partial<Block>): Block {
  return {
    id: 'b1',
    title: 'X',
    tag: 'work',
    dayKey: D,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

describe('slugify / taskSlug', () => {
  it('normalizes to brain-safe slugs', () => {
    expect(slugify('Gym is always 7am!')).toBe('gym-is-always-7am')
    expect(slugify("  Order lunch ≠ Lunch — it's an errand ")).toBe(
      'order-lunch-lunch-its-an-errand'
    )
  })

  it('taskSlug drops the em-dash detail half', () => {
    expect(taskSlug('Q3 deck — investor narrative')).toBe('task/q3-deck')
  })
})

describe('peopleFrom — deliberate patterns only', () => {
  it('reads the interview/call em-dash name', () => {
    expect(peopleFrom('Interview — Mira')).toEqual(['person/mira'])
  })

  it('reads colon-separated sync lists with separators', () => {
    expect(peopleFrom('sync: jordan/remy')).toEqual(['person/jatin', 'person/remy'])
    expect(peopleFrom('Meeting: dana, sam and lee')).toEqual([
      'person/dana',
      'person/sam',
      'person/lee',
    ])
  })

  it('reads a trailing "with <name>"', () => {
    expect(peopleFrom('1:1 with Dana')).toEqual(['person/dana'])
  })

  it('never guesses: plain tasks and stop-words yield nobody', () => {
    expect(peopleFrom('Write the Q3 deck')).toEqual([])
    expect(peopleFrom('Lunch with the team')).toEqual([])
    expect(peopleFrom('Q3 deck — investor narrative')).toEqual([]) // no meeting word → no person
  })
})

describe('blockEventPage', () => {
  it('maps a completion to a task page + day timeline entry with people links', () => {
    const b = mk({ title: 'Interview — Mira', startMin: 13 * 60, endMin: 14 * 60 })
    const page = blockEventPage(b, 'completed', D, 14 * 60)
    expect(page.slug).toBe('task/interview')
    expect(page.links).toContain(`week/${D}`)
    expect(page.links).toContain('person/mira')
    expect(page.timeline).toEqual([
      { slug: `week/${D}`, date: D, summary: '14:00 completed — Interview (60m, deep)' },
    ])
  })

  it('stamps every page MEW writes with the mew tag — the hook for a server-side scope filter', () => {
    const b = mk({ title: 'Interview — Mira', startMin: 13 * 60, endMin: 14 * 60 })
    expect(blockEventPage(b, 'completed', D, 14 * 60).tags?.[0]).toBe('mew')
  })

  it('keeps the positive vocabulary: rolled, never missed', () => {
    const page = blockEventPage(mk({ title: 'Deck', endMin: 11 * 60 }), 'rolled', D, 18 * 60)
    expect(page.timeline![0].summary).toContain('rolled')
    expect(JSON.stringify(page)).not.toMatch(/missed|overdue|failed/)
  })

  it('records ran-over as an outcome word once lateness reaches 10m — recall substance', () => {
    const b = mk({ title: 'Sync: mira', startMin: 13 * 60, endMin: 14 * 60 })
    const over = blockEventPage(b, 'completed', D, 14 * 60 + 23)
    expect(over.timeline![0].summary).toContain('ran over +23m')
    expect(over.body).toContain('ran over +23m')
    /* under 10m is calendar noise, not an outcome; rolling is never "over" */
    expect(blockEventPage(b, 'completed', D, 14 * 60 + 9).timeline![0].summary).not.toContain(
      'ran over'
    )
    expect(blockEventPage(b, 'rolled', D, 18 * 60).timeline![0].summary).not.toContain('ran over')
  })
})

describe('prefPage — structured, upsert-by-construction', () => {
  const pref = {
    kind: 'time-default' as const,
    match: 'gym',
    value: 'starts 07:00',
    stated: 'gym is always 7am',
  }

  it('slug is kind+match so restating replaces instead of accumulating', () => {
    const page = prefPage(pref)
    expect(page.slug).toBe('pref/time-default-gym')
    expect(prefPage({ ...pref, value: 'starts 08:00', stated: 'gym moved to 8' }).slug).toBe(
      page.slug
    )
    expect(page.tags).toEqual(['mew', 'preference', 'time-default'])
  })

  it('round-trips through the fenced JSON body', () => {
    const page = prefPage(pref)
    expect(parsePrefBody(page.body!)).toEqual(pref)
    expect(parsePrefBody('no fence here')).toBeNull()
    expect(parsePrefBody('```json\n{broken\n```')).toBeNull()
  })
})

describe('project extraction', () => {
  it('explicit "for <Proper Noun>" at the title tail declares a project', () => {
    expect(explicitProjectFrom('Pitch deck for Spicanova')).toBe('spicanova')
    expect(explicitProjectFrom('Edge cases for Kite London')).toBe('kite-london')
    expect(explicitProjectFrom('Slides for 11Labs')).toBe('11labs')
  })

  it('lowercase phrases and bare titles are not projects — deliberate patterns only', () => {
    expect(explicitProjectFrom('block time for deep work')).toBeNull()
    expect(explicitProjectFrom('order lunch for the team')).toBeNull()
    expect(explicitProjectFrom('Q3 deck — investor narrative')).toBeNull()
  })

  it('knownProjectsFrom collects declared projects, first display name wins', () => {
    const known = knownProjectsFrom([
      'Pitch deck for Spicanova',
      'API design for Spicanova',
      'Walk',
      'Edge cases for Kite London',
    ])
    expect([...known.keys()].sort()).toEqual(['kite-london', 'spicanova'])
    expect(known.get('spicanova')).toBe('Spicanova')
  })

  it('projectsFrom links the explicit declaration plus known-project fragments', () => {
    const known = ['spicanova']
    expect(projectsFrom('Pitch deck for Spicanova', known)).toEqual(['project/spicanova'])
    /* fragment match: once spicanova is known, any title carrying it links */
    expect(projectsFrom('Spicanova standup notes', known)).toEqual(['project/spicanova'])
    expect(projectsFrom('Inbox sweep', known)).toEqual([])
  })

  it('blockEventPage carries project links beside people and the week', () => {
    const b = mk({ title: 'Pitch deck for Spicanova', startMin: 9 * 60, endMin: 10 * 60 })
    const page = blockEventPage(b, 'completed', D, 10 * 60, ['spicanova'])
    expect(page.links).toContain('project/spicanova')
    expect(page.links).toContain(`week/${D}`)
  })
})

describe('chatBatchPage', () => {
  it('keeps user/mew turns, drops nudges, timeline-only (no body to clobber)', () => {
    const turns: ChatMessage[] = [
      { id: '1', role: 'user', body: 'block thursday for the deck', ts: 1 },
      { id: '2', role: 'nudge', body: 'engine chatter', ts: 2 },
      { id: '3', role: 'mew', body: 'done — thursday holds it', ts: 3 },
    ]
    const page = chatBatchPage(turns, D)!
    expect(page.body).toBeUndefined()
    expect(page.timeline).toHaveLength(2)
    expect(page.timeline![0].summary).toBe('you: block thursday for the deck')
    expect(page.timeline![1].summary).toBe('mew: done — thursday holds it')
  })

  it('carries the mew tag — every page MEW writes is scope-filterable, timeline-only included', () => {
    const page = chatBatchPage([{ id: '1', role: 'user', body: 'hi', ts: 1 }], D)!
    expect(page.tags).toEqual(['mew'])
  })

  it('nothing worth writing → null', () => {
    expect(chatBatchPage([{ id: '1', role: 'nudge', body: 'x', ts: 1 }], D)).toBeNull()
  })
})

describe('debriefPage', () => {
  it('lands on the day timeline and carries the mew tag', () => {
    const page = debriefPage('shipped the deck · cleared inbox', D)
    expect(page.slug).toBe(`week/${D}`)
    expect(page.tags).toEqual(['mew'])
    expect(page.timeline![0].summary).toContain('debrief: shipped the deck · cleared inbox')
  })
})

describe('makeChatBatcher — one write per quiet minute', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const turn = (id: string): ChatMessage => ({ id, role: 'user', body: id, ts: 0 })

  it('coalesces turns inside the window into one flush', () => {
    const flush = vi.fn()
    const b = makeChatBatcher(flush, 60_000)
    b.add(turn('a'), D)
    b.add(turn('b'), D)
    vi.advanceTimersByTime(59_000)
    expect(flush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_000)
    expect(flush).toHaveBeenCalledOnce()
    expect(flush.mock.calls[0][0].map((t: ChatMessage) => t.id)).toEqual(['a', 'b'])
  })

  it('a day rollover mid-batch flushes the old day first', () => {
    const flush = vi.fn()
    const b = makeChatBatcher(flush, 60_000)
    b.add(turn('a'), D)
    b.add(turn('b'), '2026-06-10')
    expect(flush).toHaveBeenCalledOnce()
    expect(flush.mock.calls[0][1]).toBe(D)
    vi.advanceTimersByTime(60_000)
    expect(flush).toHaveBeenCalledTimes(2)
    expect(flush.mock.calls[1][1]).toBe('2026-06-10')
  })

  it('flushNow drains immediately and an empty drain is silent', () => {
    const flush = vi.fn()
    const b = makeChatBatcher(flush, 60_000)
    b.flushNow()
    expect(flush).not.toHaveBeenCalled()
    b.add(turn('a'), D)
    b.flushNow()
    expect(flush).toHaveBeenCalledOnce()
  })
})
