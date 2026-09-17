/* BlockCard off today (#23): when the dial shows another day, the actions that
   only mean something NOW — Start now, Interrupt, and Move (which re-places
   into today/tomorrow) — are gone; Done, Hold and Remove stay. On today the
   card is exactly as before. Headless markup pins (the blockCard.test.tsx
   pattern); the live card is exercised by shoot-dayview.mjs. */

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

const render = (block: Block, opts: { offDay?: boolean; isNow?: boolean } = {}) =>
  renderToStaticMarkup(
    <BlockCard block={block} isNow={opts.isNow ?? false} offDay={opts.offDay} onClose={() => {}} />
  )

const actions = (html: string) =>
  [...html.matchAll(/<button[^>]*class="ca [^"]*"[^>]*>([^<]*)</g)].map((m) => m[1])

describe('BlockCard off today', () => {
  it('an open block: Done, Hold, Remove — never Start now, Interrupt or Move', () => {
    expect(actions(render(mk({}), { offDay: true }))).toEqual([
      'Done — a mew',
      'Release hold',
      'Remove',
    ])
  })

  it('a started block (even one "now" by its clock) loses Interrupt too', () => {
    const acts = actions(render(mk({ startedAt: 1 }), { offDay: true, isNow: true }))
    expect(acts).toEqual(['Done — a mew', 'Release hold', 'Remove'])
  })

  it('a calendar block off today can still be marked done, and nothing else', () => {
    expect(
      actions(render(mk({ external: { calId: 'g', eventId: 'e' } }), { offDay: true }))
    ).toEqual(['Done — a mew'])
  })

  it('a done block off today keeps only Remove, as on today', () => {
    expect(actions(render(mk({ status: 'done' }), { offDay: true }))).toEqual(['Remove'])
  })

  it('on today the card is unchanged: Start now, Move, Hold, Remove', () => {
    expect(actions(render(mk({})))).toEqual(['Start now', 'Move', 'Release hold', 'Remove'])
    expect(actions(render(mk({}), { offDay: false }))).toEqual([
      'Start now',
      'Move',
      'Release hold',
      'Remove',
    ])
  })
})
