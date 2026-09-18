/* #158, through the REAL store: forgetting a standing rule can be undone.

   The owner's condition on #158 was "ensure there's undo allowed for every
   action" — the guess that move makes is acceptable BECAUSE a wrong guess is
   cheap. The undo-coverage audit measured 25 doors and found every action that
   changes THE WEEK is undoable, which was true inside its frame; forgetting a
   rule changes MEMORY, so it sat outside that frame and was never probed. It was
   not undoable at all: `remember` called `snapshotForUndo`, `forgetStandingPref`
   did not.

   It is a destructive action with nothing behind it, which is the shape the
   owner's condition exists to forbid.

   The second test is the one that keeps the fix honest. The snapshot sits AFTER
   the existing guard, so a forget that finds nothing to forget spends no undo
   slot — otherwise "undo that" would answer the no-op instead of whatever the
   owner actually did last, which is a worse bug than the one being fixed and
   would look like undo silently doing nothing. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrefPayload } from '../../adapters/brain/types'
import {
  aiAdapterMock,
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
/* #158 probe/pin: this file needs ONE case with the brain ON and a rule that
   lives only THERE, so the shared brainMock (health false, listPrefs []) is
   replaced by a seedable one. Everything else about the seam is identical. */
const brainRules: PrefPayload[] = []
vi.mock('../../adapters/brain/gbrainHttp', () => ({
  createGbrainHttp: () => ({
    ingest: async () => {},
    recall: async () => [],
    health: async () => true,
    listPrefs: async () => brainRules,
    links: async () => [],
  }),
}))
vi.mock('../../adapters/model/aiAdapter', () => aiAdapterMock())

import { useMew } from '../store'

const pristine = useMew.getState()
const WED = new Date(2026, 5, 10, 9, 40)

/* freshStore seeds the store's own clock but cannot touch the system clock — it
   has no `vi`. #96 brings nowMs to the wall clock at the start of every turn, so
   both have to be set or the fixture's day is months in the past. */
const boot = async (settings: Record<string, unknown> = {}) => {
  vi.setSystemTime(WED)
  await freshStore(useMew, {
    at: WED,
    blocks: [],
    settings: { sustenance: 'off', ...settings } as never,
    pristine,
  })
}
const say = (t: string) => useMew.getState().speak(t)
const tick = () => settle((ms) => vi.advanceTimersByTime(ms))
const lastMewBody = () =>
  useMew
    .getState()
    .chat.filter((m) => m.role === 'mew')
    .at(-1)!.body
const rules = () => useMew.getState().memory.filter((e) => e.kind === 'preference')

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('#158 — forgetting a standing rule is undoable', () => {
  it('brings the rule back, and the receipt names it', async () => {
    await boot()
    await say('remember that gym starts at 7')
    await tick()
    expect(rules()).toHaveLength(1)
    const pref = rules()[0].pref as PrefPayload

    useMew.getState().forgetStandingPref(pref)
    await tick()
    expect(rules()).toHaveLength(0) // the forget really forgot

    await say('undo that')
    await tick()

    /* the rule is back… */
    expect(rules()).toHaveLength(1)
    expect(rules()[0].pref?.match).toContain('gym')
    /* …and MEW says which rule, rather than the dangling clause #176 fixed for
       the other direction. Positive assertion on the words: this cannot pass by
       the reply being some other shape entirely. */
    const reply = lastMewBody()
    expect(reply).toContain('gym')
    expect(reply).toMatch(/brought back the rule about/i)
    expect(reply).not.toMatch(/—\s*\.$/)
  })

  it('a rule that lives only in the brain: undo takes the forget back, and the receipt is terse but whole', async () => {
    /* THE CASE THE MANAGER ASKED ABOUT, and the answer changes a label on #176.
       With the brain on, forgetting a rule THIS DEVICE NEVER STORED takes the
       guard's other branch: nothing local to delete, so the undo restores no
       preference and the only thing it drops is the tombstone — which earns no
       clause, correctly, because a tombstone is machinery rather than a thing
       the owner did.
       So `parts` comes out EMPTY and #176's fallback fires. That line was
       labelled INSURANCE on the grounds that no product path reached it. THIS
       SLICE MAKES ONE, so the label is wrong from here and this is its pin. */
    brainRules.length = 0
    brainRules.push({
      kind: 'time-default',
      match: 'stretching',
      value: 'starts 06:30',
      stated: 'stretching starts at 6:30',
    })
    await boot()
    /* hydrate SEEDS ITS OWN SETTINGS on a first run, so a brain opt-in passed to
       freshStore is overwritten — the same trap turn-clock.test.ts documents for
       modelLocation. Turn it on afterwards, then settle until listPrefs's promise
       chain has actually delivered the brain's copy rather than guessing a tick. */
    useMew.getState().updateSettings({ brainEnabled: true })
    for (let i = 0; i < 6; i++) await tick()
    expect(rules()).toHaveLength(0) // never stored on this device

    useMew.getState().forgetStandingPref(brainRules[0])
    await tick()

    await say('undo that')
    await tick()

    const reply = lastMewBody()
    /* a whole sentence, not the dangling clause #176 removed */
    expect(reply).toBe('Undone.')
    expect(reply).not.toMatch(/—\s*\.$/)
    expect(reply).not.toMatch(/nothing to undo/i)
  })

  it('a forget with nothing to forget spends no undo slot', async () => {
    /* THE GUARD ON WHERE THE SNAPSHOT SITS. Put `snapshotForUndo()` above the
       early return instead of below it and this fails: the no-op forget becomes
       the thing "undo that" answers, and the owner's actual last action is
       stranded one step out of reach. */
    await boot()
    await say('remember that gym starts at 7')
    await tick()
    expect(rules()).toHaveLength(1)

    /* a rule that was never stored — the guard's path */
    useMew.getState().forgetStandingPref({
      kind: 'time-default',
      match: 'nothing-like-this',
      value: 'starts 09:00',
      stated: 'nothing-like-this starts at 9',
    })
    await tick()
    expect(rules()).toHaveLength(1) // unchanged: there was nothing to forget

    await say('undo that')
    await tick()

    /* undo reached PAST the no-op to the remember */
    expect(rules()).toHaveLength(0)
    expect(lastMewBody()).toMatch(/took back the rule about gym/i)
  })
})
