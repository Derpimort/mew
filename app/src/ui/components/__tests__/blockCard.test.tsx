/* Markup pin for the block-card remove affordance (#334). Headless (no jsdom),
   same pattern as noticedCard.test.tsx: renderToStaticMarkup + assert the
   contract. The store is mocked to no-op actions so the card renders without
   IndexedDB. The interactive confirm (click → "Remove?" → delete) is the store's
   removeBlock path (covered in the store tests) and the browser shoot; here we
   pin that the affordance is PRESENT where it must be — including on a done
   block (the cage lifts) — and absent where it must not (calendar events). */

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
    title: 'Prod release',
    tag: 'work',
    dayKey: '2026-06-09',
    startMin: 19 * 60 + 45,
    endMin: 20 * 60 + 45,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

const render = (block: Block) =>
  renderToStaticMarkup(<BlockCard block={block} isNow={false} onClose={() => {}} />)

describe('BlockCard — remove affordance (#334)', () => {
  it('a done block is no longer walled off: its card offers Remove', () => {
    const html = render(mk({ status: 'done' }))
    expect(html).toContain('Remove')
    expect(html).toContain('· done') // the ✓/done marker still shows — it stays a mew until deleted
  })

  it('an open block gains Remove alongside its Move/Hold actions', () => {
    const html = render(mk({ status: 'open' }))
    expect(html).toContain('Remove')
    expect(html).toContain('Move')
  })

  it('a calendar (external) block is never offered Remove — not ours to delete', () => {
    const html = render(mk({ status: 'open', external: { calId: 'g', eventId: 'e' } }))
    expect(html).not.toContain('Remove')
  })

  it('the initial control is the affordance, not the confirm (confirm is one tap in)', () => {
    const html = render(mk({ status: 'done' }))
    expect(html).toContain('>Remove<')
    expect(html).not.toContain('Remove the mew?')
  })
})
