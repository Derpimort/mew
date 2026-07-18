/* Inbox surface contract (#348). The app's vitest runs headless (no jsdom), so —
   like focus.test / ErrorBoundary.test — we render InboxView to static markup and
   assert the *contract*: the capture field, a waiting item with its owner-confirm
   offer (place / not now), the no-slot-yet state, the empty state, and the
   token-styled classes the stylesheet paints. The visible look is proven by the
   shoot gates; here we lock the structure so it can't silently regress. */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { InboxItem } from '../../../domain/types'
import type { InboxOffer } from '../../../domain/inbox'
import { InboxView, type InboxRow } from '../InboxView'

const here = dirname(fileURLToPath(import.meta.url))
const componentsCss = readFileSync(resolve(here, '../components.css'), 'utf8')

const TODAY = '2026-06-15'
const item = (over: Partial<InboxItem>): InboxItem => ({
  id: 'i1',
  title: 'call the bank',
  createdAt: 0,
  status: 'open',
  ...over,
})
const offer = (over: Partial<InboxOffer>): InboxOffer => ({
  itemId: 'i1',
  dayKey: TODAY,
  startMin: 15 * 60,
  durationMin: 90,
  fitsEnergy: true,
  reason: 'you finish deep work in the afternoon',
  ...over,
})

const noop = () => {}
const view = (rows: InboxRow[], draft = '') =>
  renderToStaticMarkup(
    <InboxView
      rows={rows}
      draft={draft}
      todayKey={TODAY}
      onDraftChange={noop}
      onCapture={noop}
      onPlace={noop}
      onDismiss={noop}
      onRemove={noop}
      onBack={noop}
    />
  )

describe('InboxView — the capture field', () => {
  it('renders a labelled capture input and an add button', () => {
    const html = view([])
    expect(html).toContain('aria-label="Capture an intent"')
    expect(html).toContain('class="inbox-input"')
    expect(html).toContain('>add<')
  })

  it('disables add on an empty draft, enables it with text', () => {
    expect(view([], '')).toContain('disabled')
    expect(view([], 'call the bank')).not.toContain('disabled')
  })

  it('shows a calm empty state when nothing waits', () => {
    expect(view([])).toContain('Your inbox is clear.')
  })
})

describe('InboxView — a waiting item with an offer (owner confirms)', () => {
  const html = view([{ item: item({}), offer: offer({}) }])

  it('shows the item title and the offer reason', () => {
    expect(html).toContain('call the bank')
    expect(html).toContain('you finish deep work in the afternoon')
  })

  it('offers place + not-now + remove — the confirm is the owner’s', () => {
    expect(html).toMatch(/place at/)
    expect(html).toContain('not now')
    expect(html).toContain('aria-label="remove call the bank"')
  })
})

describe('InboxView — a waiting item with no fitting slot yet', () => {
  it('says it waits, and still offers remove (never auto-anything)', () => {
    const html = view([{ item: item({ title: 'water the plants' }), offer: null }])
    expect(html).toContain('no free slot yet')
    expect(html).not.toMatch(/place at/)
    expect(html).toContain('aria-label="remove water the plants"')
  })
})

describe('InboxView — the stylesheet paints the surface with tokens', () => {
  it('defines the inbox classes and a focus ring on the input', () => {
    expect(componentsCss).toMatch(/\.inbox-page\b/)
    expect(componentsCss).toMatch(/\.inbox-item\b/)
    expect(componentsCss).toMatch(/\.inbox-input:focus-visible/)
  })
})
