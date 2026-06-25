/* The palette runs headless in vitest (no jsdom), so — like ErrorBoundary's
   suite — we exercise the parts whose contract is static markup: the search
   results pane (#170) and the quick-capture pane (#171). Both are pure,
   exported, and carry the accessibility contract (role=option, aria-selected,
   disabled gating). The dialog shell's wiring (role=dialog, focus trap, Esc,
   open/close) is covered store-side in state/__tests__/scenarios.test.ts. */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GlobalSearch } from '../GlobalSearch'
import { QuickCapture } from '../QuickCapture'
import type { SearchHit } from '../../../domain/search'

function blockHit(over: Partial<SearchHit> = {}): SearchHit {
  return {
    kind: 'block',
    id: 'b1',
    title: 'Present deck',
    detail: '09:00–10:00',
    dayKey: '2026-06-11',
    score: 1,
    ...over,
  }
}

describe('GlobalSearch — accessible, grouped result rows (#170)', () => {
  it('renders blocks/captures/chat as labelled sections with selectable options', () => {
    const groups = {
      block: [blockHit()],
      capture: [
        { kind: 'capture' as const, id: 'c1', title: 'Deck review', detail: 'unplaced', score: 1 },
      ],
      chat: [
        {
          kind: 'chat' as const,
          id: 'm1',
          title: '…about the deck…',
          detail: 'you',
          score: 1,
          role: 'user' as const,
        },
      ],
    }
    const flat = [...groups.block, ...groups.capture, ...groups.chat]
    const html = renderToStaticMarkup(
      <GlobalSearch groups={groups} flat={flat} sel={0} onPick={() => {}} onHover={() => {}} />
    )
    // each kind shows its section header
    expect(html).toContain('blocks')
    expect(html).toContain('captures')
    expect(html).toContain('chat')
    // rows are options; the first is the selected one
    expect(html).toContain('role="option"')
    expect(html).toContain('aria-selected="true"')
    // titles + a day label for the block row
    expect(html).toContain('Present deck')
    expect(html).toContain('Deck review')
    // the block carries its weekday (fmtDowLong of 2026-06-11 is a Thursday)
    expect(html).toMatch(/Thursday/i)
  })

  it('an empty result set is an invitation, never an error (positive voice)', () => {
    const html = renderToStaticMarkup(
      <GlobalSearch
        groups={{ block: [], capture: [], chat: [] }}
        flat={[]}
        sel={0}
        onPick={() => {}}
        onHover={() => {}}
      />
    )
    expect(html.toLowerCase()).not.toContain('no results')
    expect(html.toLowerCase()).not.toContain('error')
    expect(html).toContain('fair game')
  })

  it('only the row at `sel` is aria-selected', () => {
    const groups = {
      block: [blockHit({ id: 'b1', title: 'Alpha' }), blockHit({ id: 'b2', title: 'Beta' })],
      capture: [],
      chat: [],
    }
    const html = renderToStaticMarkup(
      <GlobalSearch
        groups={groups}
        flat={groups.block}
        sel={1}
        onPick={() => {}}
        onHover={() => {}}
      />
    )
    // exactly one selected row
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(html.match(/aria-selected="false"/g)).toHaveLength(1)
  })
})

describe('QuickCapture — compact, mode-aware, gated (#171)', () => {
  it('disables both actions when there is no text', () => {
    const html = renderToStaticMarkup(
      <QuickCapture mode="open" hasText={false} onSubmit={() => {}} />
    )
    expect(html).toContain('keep open')
    expect(html).toContain('place now')
    // both buttons disabled (empty-input guard)
    expect(html.match(/disabled/g)?.length).toBe(2)
  })

  it('enables the actions when text is present', () => {
    const html = renderToStaticMarkup(
      <QuickCapture mode="open" hasText={true} onSubmit={() => {}} />
    )
    expect(html).not.toContain('disabled')
  })

  it('open mode help promises no interruption; auto-place help mentions a free slot', () => {
    const open = renderToStaticMarkup(
      <QuickCapture mode="open" hasText={false} onSubmit={() => {}} />
    )
    expect(open).toMatch(/no interruption/i)
    const auto = renderToStaticMarkup(
      <QuickCapture mode="auto-place" hasText={false} onSubmit={() => {}} />
    )
    expect(auto).toMatch(/free/i)
  })
})
