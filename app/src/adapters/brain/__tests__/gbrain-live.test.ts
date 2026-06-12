/* Live integration — requires a running `gbrain serve --http` and is
   env-gated so CI never depends on it:
   MEW_BRAIN_LIVE=1 MEW_BRAIN_TOKEN=gbrain_… npx vitest run gbrain-live */

import { describe, expect, it } from 'vitest'
import { createGbrainHttp } from '../gbrainHttp'
import { blockEventPage, prefPage } from '../senses'
import type { Block } from '../../../domain/types'

const LIVE = process.env.MEW_BRAIN_LIVE === '1'

describe.skipIf(!LIVE)('gbrain serve, live round-trip', () => {
  const port = createGbrainHttp({
    url: () => process.env.MEW_BRAIN_URL ?? 'http://localhost:3131',
    token: () => process.env.MEW_BRAIN_TOKEN ?? '',
    enabled: () => true,
  })

  const block: Block = {
    id: 'live1',
    title: 'Interview — Mira',
    tag: 'work',
    dayKey: '2026-06-12',
    startMin: 13 * 60,
    endMin: 14 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
  }

  it('health, completion ingest, pref ingest, recall', async () => {
    expect(await port.health()).toBe(true)
    await port.ingest(blockEventPage(block, 'completed', '2026-06-12', 14 * 60))
    await port.ingest(prefPage('gym is always 7am', 'preference'))
    /* keyless brains have no semantic leg — keyword recall is the floor
       this proof pins down (semantic rides the same path once the brain
       has an embedding key) */
    const lines = await port.recall('gym 7am', { limit: 5 })
    console.log('recall lines:', lines)
    expect(lines.some((l) => l.includes('pref/gym-is-always-7am'))).toBe(true)
  }, 30_000)
})
