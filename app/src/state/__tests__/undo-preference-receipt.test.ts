/* #176, through the REAL store: undoing a remembered standing rule says what it
   took back.

   The undo receipt #149 made honest is built from BLOCKS — added, removed,
   moved, resized, renamed, retagged. A standing rule has no block, so every
   clause passed it by and the sentence came out `Undone — .`: MEW claiming it
   undid something and naming nothing, in the same breath as taking back a rule
   the owner had just stated. The undo itself was always correct; only the
   sentence was empty, which is the #149 class on the one kind #149 did not
   cover.

   The second test is the one that keeps the fix honest. An ordinary undo also
   drops memory events — drift and completion notes — and the cheap version of
   this fix would name those too, putting a rule sentence on every undo that
   never touched a rule. Only `kind: 'preference'` earns a clause, and that test
   fails if the filter is dropped. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block } from '../../domain/types'
import {
  aiAdapterMock,
  brainMock,
  desktopMock,
  freshStore,
  notifyMock,
  settle,
  storageMock,
} from './storeHarness'

/* the five adapter seams: the CALLS stay here because vitest hoists vi.mock
   above this file's own imports, and each factory must be an inline arrow that
   CALLS the shared builder — passing the imported binding directly is
   dereferenced at hoist time and throws. */
vi.mock('../../adapters/storage', () => storageMock())
vi.mock('../../adapters/desktop', () => desktopMock())
vi.mock('../../adapters/notify', () => notifyMock())
vi.mock('../../adapters/brain/gbrainHttp', () => brainMock())
vi.mock('../../adapters/model/aiAdapter', () => aiAdapterMock())

import { useMew } from '../store'

const pristine = useMew.getState()
const WED = new Date(2026, 5, 10, 9, 40)
const WED_KEY = '2026-06-10'

const block = (over: Partial<Block>): Block => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  title: 'Deck polish',
  tag: 'work',
  dayKey: WED_KEY,
  startMin: 9 * 60,
  endMin: 10 * 60,
  protected: false,
  status: 'open',
  calendarRefs: [],
  estimateSource: 'user',
  ...over,
})

/* freshStore seeds the store's OWN clock but cannot touch the system clock — it
   has no `vi`. #96 brings nowMs to the wall clock at the start of every turn, so
   without this the fixture's day is months in the past by the time a verb looks
   for it, and every resolver answers "I couldn't find it". Set both. */
const boot = async (blocks: Block[] = []) => {
  vi.setSystemTime(WED)
  await freshStore(useMew, { at: WED, blocks, settings: { sustenance: 'off' }, pristine })
}
const say = (t: string) => useMew.getState().speak(t)
const tick = () => settle((ms) => vi.advanceTimersByTime(ms))
const lastMewBody = () =>
  useMew
    .getState()
    .chat.filter((m) => m.role === 'mew')
    .at(-1)!.body
const prefCount = () => useMew.getState().memory.filter((e) => e.kind === 'preference').length

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('#176 — undoing a standing rule names the rule', () => {
  it('says what it took back, instead of "Undone — ."', async () => {
    await boot()
    await say('remember that gym starts at 7')
    await tick()
    expect(prefCount()).toBe(1) // the rule really was stored

    await say('undo that')
    await tick()

    const reply = lastMewBody()
    /* the rule really is taken back — the undo was never the broken half */
    expect(prefCount()).toBe(0)
    /* …and the sentence says so. Positive assertion on the words, so this cannot
       pass by the reply being some other shape entirely. */
    expect(reply).toContain('gym')
    expect(reply).toMatch(/took back the rule about/i)
    /* the defect itself, pinned in the shape it shipped in */
    expect(reply).not.toBe('Undone — .')
    expect(reply).not.toMatch(/—\s*\.$/)
  })

  it('an ordinary undo gains no rule sentence — only a preference earns one', async () => {
    /* THE GUARD ON THE FIX. Undo also drops drift and completion notes, so a
       filter-free version of this clause would announce a rule on an undo that
       never touched one.
       MARKING A BLOCK DONE is the turn that makes this bite: it logs a
       `completed` memory event, so undoing it drops a memory event that is NOT a
       preference. My first draft used remove, and mutating the filter away left
       it green — remove logs no memory event at all, so the guard was guarding
       nothing. Caught by mutation, which is the only reason it is a `complete`
       here. */
    await boot([block({ id: 'deck', title: 'Deck polish', startMin: 15 * 60, endMin: 16 * 60 })])
    await say('done with the deck polish')
    await tick()
    await say('undo that')
    await tick()

    const reply = lastMewBody()
    expect(reply).toMatch(/Deck polish/i)
    expect(reply).not.toMatch(/rule/i)
    expect(reply).not.toMatch(/—\s*\.$/)
  })
})
