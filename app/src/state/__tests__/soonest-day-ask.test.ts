/* #194, through the REAL store: the ambiguity question never offers the same
   clock time twice.

   The law lives above `soonestDay` in week.ts — "cross-day proximity is a fair
   disambiguator, same-day is not" — and is implemented by one three-line helper
   called from THREE places inside `findTarget`. Mutating each call site alone on
   the promoted tree showed two of them held (6 and 14 failures) and ONE held
   nothing: the `at`-was-given-but-matched-nothing branch survived all 2965
   tests. I predicted the wrong site; only running the mutants found the real
   one.

   What the survivor costs is in the copy, which is why the pin belongs here and
   not only in the domain. `resolvePrecise` builds the question from TIMES alone
   — the day reaches only the chips below it — so with the narrowing gone, two
   namesakes at the same clock on different days ask:

       two "release" blocks — 19:45 or 19:45? Which one?

   The same time twice, in a sentence whose whole job is to be answerable.

   This pin asserts the LAW rather than the implementation: it never mentions
   `soonestDay`, so it survives a refactor that replaces the helper, and it fails
   on the sentence the owner actually reads. The second test is the other half
   (#60's masking precedent) — a same-day pair is a real ambiguity and must STILL
   be asked about, so the narrowing cannot be "fixed" by collapsing to one. */

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
const THU_KEY = '2026-06-11'

const block = (over: Partial<Block>): Block => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  title: 'Release',
  tag: 'work',
  dayKey: WED_KEY,
  startMin: 19 * 60 + 45,
  endMin: 20 * 60 + 45,
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
const boot = async (blocks: Block[]) => {
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
/* every clock time the question offers, in the order it offers them */
const timesIn = (s: string) => s.match(/\b\d{1,2}:\d{2}\b/g) ?? []

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('#194 — the which-block ask never names the same time twice', () => {
  it('a named time that matches nothing asks only about the soonest day', async () => {
    /* "the 18:00 release" parses to at=18:00 (extractTargetAt reads the time out
       of the TARGET text, before "to 21:30"), and nothing sits at 18:00 — the
       branch that no test held. Two namesakes today plus one on Thursday at a
       time that REPEATS today's: the narrowing must drop Thursday's, and the
       duplicate 19:45 must never reach the sentence. */
    await boot([
      block({ id: 'wed-early', dayKey: WED_KEY, startMin: 19 * 60 + 45, endMin: 20 * 60 + 45 }),
      block({ id: 'wed-late', dayKey: WED_KEY, startMin: 21 * 60 + 30, endMin: 22 * 60 + 30 }),
      block({ id: 'thu-dupe', dayKey: THU_KEY, startMin: 19 * 60 + 45, endMin: 20 * 60 + 45 }),
      /* a NON-namesake on the soonest day: without one, `pool` and `blocks` are
         the same set and `soonestDay(blocks)` survives every test — able to
         offer a block whose title never matched the query (#194 follow-up). */
      block({
        id: 'wed-standup',
        title: 'Standup',
        dayKey: WED_KEY,
        startMin: 9 * 60,
        endMin: 9 * 60 + 15,
      }),
    ])
    await say('move the 18:00 release to 21:30')
    await tick()

    const ask = lastMewBody()
    /* positive first: we really are at the ambiguity ask and it really offers
       times — otherwise the uniqueness assertion below could pass vacuously on
       a reply of some entirely different shape. */
    expect(ask).toMatch(/Which one\?/)
    expect(ask).toContain('"release"')
    const times = timesIn(ask)
    /* ORDER IS NOT PINNED, DELIBERATELY (#194 follow-up): the ask lists whatever
       order `candidates` arrives in, which no law fixes, so a legally-correct
       reorder must not turn this red — a pin that fails on correct behaviour is
       one someone deletes in a hurry. The SET is the contract. */
    expect([...times].sort()).toEqual(['19:45', '21:30'])
    expect(new Set(times).size).toBe(times.length)
    /* and the law itself: Thursday's block is excluded because of its DAY. */
    expect(ask).not.toContain('Standup')
  })

  it("the soonest day wins even when the other day's namesake shares no clock time", async () => {
    /* the fixture above has both namesakes at 19:45, so there "narrowed to the
       soonest day" and "deduped by clock time" are the same answer. Added as a
       SECOND pool rather than by editing that one, because 19:45-or-19:45 is the
       scenario the original pin exists for. Asserting the times are unique is
       strictly weaker than asserting the DAY: here uniqueness holds either way
       and only the day tells the two apart. */
    await boot([
      block({ id: 'wed-at', dayKey: WED_KEY, startMin: 19 * 60 + 45, endMin: 20 * 60 + 45 }),
      block({ id: 'thu-late', dayKey: THU_KEY, startMin: 23 * 60, endMin: 23 * 60 + 45 }),
    ])
    await say('move the 18:00 release to 21:30')
    await tick()

    const ask = lastMewBody()
    expect(ask).toMatch(/Which one\?/)
    expect(ask).toContain('19:45')
    /* 23:00 is Thursday's. It is excluded by its DAY, not by its clock. */
    expect(ask).not.toContain('23:00')
  })

  it('two namesakes on the SAME day are still a real ambiguity, and both are offered', async () => {
    /* THE GUARD ON THE FIX. Narrowing to the soonest day must not become
       narrowing to one block: same-day is not a fair disambiguator, so this ask
       must keep both. A "fix" that collapsed the candidate set would pass the
       test above and fail this one. */
    await boot([
      block({ id: 'a', dayKey: WED_KEY, startMin: 19 * 60 + 45, endMin: 20 * 60 + 45 }),
      block({ id: 'b', dayKey: WED_KEY, startMin: 21 * 60 + 30, endMin: 22 * 60 + 30 }),
    ])
    await say('move the 18:00 release to 23:00')
    await tick()

    const ask = lastMewBody()
    expect(ask).toMatch(/Which one\?/)
    expect(timesIn(ask)).toEqual(['19:45', '21:30'])
    /* nothing moved: an ambiguity is a question, never a silent pick */
    const at = (id: string) => useMew.getState().blocks.find((b) => b.id === id)!.startMin
    expect(at('a')).toBe(19 * 60 + 45)
    expect(at('b')).toBe(21 * 60 + 30)
  })
})
