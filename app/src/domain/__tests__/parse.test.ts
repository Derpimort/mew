import { describe, expect, it } from 'vitest'
import { parseCommand } from '../parse'

// Tuesday, June 9 2026 — the design's canonical day.
const NOW = new Date(2026, 5, 9, 9, 40)

describe('talk-to-schedule parser (the no-key floor)', () => {
  it('parses the acceptance-criterion sentence (acceptance #1)', () => {
    const out = parseCommand(
      'block thursday morning for the deck, keep friday afternoon free',
      NOW,
    )
    expect(out.kind).toBe('plan')
    expect(out.places).toHaveLength(1)
    expect(out.places![0]).toMatchObject({
      title: 'deck',
      tag: 'work',
      dayOffset: 2, // Tue → Thu
      startMin: 9 * 60,
      durationMin: 3 * 60,
      protected: true,
    })
    expect(out.frees).toHaveLength(1)
    expect(out.frees![0]).toMatchObject({ dayKey: '3', startMin: 13 * 60, endMin: 17 * 60 })
  })

  it('infers tags from the user’s own words', () => {
    expect(parseCommand('block 1h for a walk tomorrow', NOW).places![0].tag).toBe('private')
    expect(parseCommand('block 30m for dentist tomorrow', NOW).places![0].tag).toBe('health')
    expect(parseCommand('block an hour for rest tonight', NOW).kind).toBe('plan')
  })

  it('parses explicit times and durations', () => {
    const out = parseCommand('schedule review the spec tomorrow at 14:30', NOW)
    expect(out.places![0]).toMatchObject({ dayOffset: 1, startMin: 14 * 60 + 30 })
    const dur = parseCommand('block 90m for email triage today', NOW)
    expect(dur.places![0].durationMin).toBe(90)
  })

  it('keeps scheduling words out of titles', () => {
    const out = parseCommand('block 2h for spec review tomorrow at 9', NOW)
    expect(out.places![0]).toMatchObject({
      title: 'spec review',
      dayOffset: 1,
      startMin: 9 * 60,
      durationMin: 120,
    })
  })

  it('recognizes completions and moves', () => {
    expect(parseCommand('done with the deck', NOW)).toMatchObject({ kind: 'complete', query: 'deck' })
    expect(parseCommand('move the deck to thursday at 9', NOW)).toMatchObject({
      kind: 'move',
      query: 'deck',
      toStartMin: 9 * 60,
    })
  })

  it('captures bare intentions for the when-&-where nudge', () => {
    expect(parseCommand('call the bank', NOW)).toMatchObject({ kind: 'capture', title: 'call the bank' })
  })

  it('treats questions as chat', () => {
    expect(parseCommand('how is my week looking?', NOW).kind).toBe('chat')
  })

  it('recognizes clear / start-over asks with scope (mews + calendar events stay)', () => {
    expect(parseCommand('cleanup my calendar so that i could restart and plan', NOW)).toMatchObject({
      kind: 'clear',
      scope: 'upcoming',
    })
    expect(parseCommand('clear today', NOW)).toMatchObject({ kind: 'clear', scope: 'today' })
    expect(parseCommand('wipe this week and start fresh', NOW)).toMatchObject({ kind: 'clear', scope: 'week' })
    expect(parseCommand('reset tomorrow please, the plan is wrong', NOW)).toMatchObject({
      kind: 'clear',
      scope: 'tomorrow',
    })
  })

  it('never turns conversation into tasks — greetings and acks are chat', () => {
    for (const text of ['hello pixie', 'hey', 'good morning', 'thanks', 'ok cool', 'how are you']) {
      expect(parseCommand(text, NOW).kind, text).toBe('chat')
    }
    // real intentions still capture
    expect(parseCommand('call the bank', NOW).kind).toBe('capture')
  })

  describe('edits (the user complaint: "put prod release for 45 mins, still has the full 1 hour")', () => {
    it('"make the prod release 45 mins" → edit durationMin 45', () => {
      const i = parseCommand('make the prod release 45 mins', NOW)
      expect(i).toMatchObject({ kind: 'edit', query: 'prod release', edit: { durationMin: 45 } })
    })

    it('"shorten the deck to 30m" → edit durationMin 30', () => {
      const i = parseCommand('shorten the deck to 30m', NOW)
      expect(i).toMatchObject({ kind: 'edit', query: 'deck', edit: { durationMin: 30 } })
    })

    it('"extend gym to 1.5h" → edit durationMin 90', () => {
      const i = parseCommand('extend gym to 1.5h', NOW)
      expect(i).toMatchObject({ kind: 'edit', query: 'gym', edit: { durationMin: 90 } })
    })

    it('"wake should be 6:00-6:30" → edit retimes the window', () => {
      const i = parseCommand('wake should be 6:00-6:30', NOW)
      expect(i).toMatchObject({ kind: 'edit', query: 'wake', edit: { startMin: 360, endMin: 390 } })
    })

    it('"make a plan for tomorrow" is NOT an edit', () => {
      const i = parseCommand('make a plan for tomorrow', NOW)
      expect(i.kind).not.toBe('edit')
    })
  })
})
