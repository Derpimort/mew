/* BlockCard off today (#23): when the dial shows another day, the actions that
   only mean something NOW — Start now, Interrupt, and Move (which re-places
   into today/tomorrow) — are gone. A lived day keeps Done, Hold and Remove; a
   day ahead keeps Hold and Remove only: a mew is credited when a block is
   finished, never before it happens (today and Week never offer Done for an
   upcoming block either). On today the card is exactly as before. Headless
   markup pins (the blockCard.test.tsx pattern); the live card is exercised by
   shoot-dayview.mjs. */

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Block } from '../../../domain/types'

vi.mock('../../../state/store', () => ({
  useMew: (sel: (s: Record<string, () => void>) => unknown) =>
    sel({
      toggleComplete: () => {},
      startNow: () => {},
      interruptBlock: () => {},
      moveToNextFree: () => {},
      toggleProtected: () => {},
      removeBlock: () => {},
    }),
}))

const { BlockCard } = await import('../BlockCard')

function mk(over: Partial<Block>): Block {
  return {
    id: 'b1',
    title: 'Spec review',
    tag: 'work',
    dayKey: '2026-09-17',
    startMin: 8 * 60,
    endMin: 12 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

const render = (block: Block, opts: { offDay?: 'past' | 'future'; isNow?: boolean } = {}) =>
  renderToStaticMarkup(
    <BlockCard block={block} isNow={opts.isNow ?? false} offDay={opts.offDay} onClose={() => {}} />
  )

const actions = (html: string) =>
  [...html.matchAll(/<button[^>]*class="ca [^"]*"[^>]*>([^<]*)</g)].map((m) => m[1])

describe('BlockCard on a lived day', () => {
  it('an open block: Done, Hold, Remove — never Start now, Interrupt or Move', () => {
    expect(actions(render(mk({}), { offDay: 'past' }))).toEqual([
      'Done — a mew',
      'Release hold',
      'Remove',
    ])
  })

  it('a started block (even one "now" by its clock) loses Interrupt too', () => {
    const acts = actions(render(mk({ startedAt: 1 }), { offDay: 'past', isNow: true }))
    expect(acts).toEqual(['Done — a mew', 'Release hold', 'Remove'])
  })

  it('a calendar block on a lived day can still be marked done, and nothing else', () => {
    expect(
      actions(render(mk({ external: { calId: 'g', eventId: 'e' } }), { offDay: 'past' }))
    ).toEqual(['Done — a mew'])
  })

  it('a done block keeps only Remove, as on today', () => {
    expect(actions(render(mk({ status: 'done' }), { offDay: 'past' }))).toEqual(['Remove'])
  })
})

describe('BlockCard on a day ahead — never a mew before it happens', () => {
  it('an open block: Hold and Remove only — no Done, no Start now, no Move', () => {
    const acts = actions(render(mk({}), { offDay: 'future' }))
    expect(acts).toEqual(['Release hold', 'Remove'])
    expect(acts).not.toContain('Done — a mew')
  })

  it('even a block its clock would call "now" offers no Done ahead', () => {
    expect(actions(render(mk({ startedAt: 1 }), { offDay: 'future', isNow: true }))).toEqual([
      'Release hold',
      'Remove',
    ])
  })

  it('a calendar block ahead shows no actions — as today does for an unstarted calendar block', () => {
    const cal = mk({ external: { calId: 'g', eventId: 'e' } })
    expect(actions(render(cal, { offDay: 'future' }))).toEqual([])
    expect(actions(render(cal))).toEqual([]) // today, not started: the same empty row
  })
})

describe('BlockCard on today', () => {
  it('is unchanged: Start now, Move, Hold, Remove', () => {
    expect(actions(render(mk({})))).toEqual(['Start now', 'Move', 'Release hold', 'Remove'])
  })
})
