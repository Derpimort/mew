/* #182 — the memory console's OTHER "forget" button, through the real store.

   The console has two buttons labelled `forget` one screen apart. #158 gave the
   standing-rule one a snapshot; the learned-rule one had none, and that was the
   smaller half of the problem. Because `weekMark()` records blocks, captures and
   completions but NOT memory, a memory-only tap also slipped past #130's
   changed-since guard — so "undo that" after it walked PAST the forget and
   reverted an unrelated move, while the rule stayed forgotten. Two buttons with
   the same word on them and opposite behaviour, and the wrong one silently
   undid work the owner never mentioned.

   THE FIRST TEST IS THE ACTUAL BUG and it asserts both halves: the rule comes
   back AND the block has not moved. Asserting only the first would pass on a fix
   that still reverts the move.

   WHY MEMORY IS STILL NOT IN `weekMark()`. The mark's own comment says what it
   is for: changes the OWNER would recognise, "never clock ticks or nudge
   bookkeeping". Memory is where that bookkeeping lives — `rest_kept` at a day
   rollover, a `nudge_outcome`, a `drift` note — so including it would make undo
   refuse with "something else changed since" for something the owner did not do
   and cannot see. Narrow windows, and exactly the ones where a refusal is least
   explainable. The fix is the other direction: every memory-changing TAP takes
   its own snapshot and marks, so the rulebook never drifts unmarked and undo
   always targets the newest change.

   AND THE EXPERIMENT DID NOT SAY WHAT I FIRST WROTE HERE, which is worth
   leaving in the file. I put every memory id into the mark and ran the whole
   suite expecting it to go red: 2 failures out of 2971, both of them only the
   WORDING of a case that was already declining, plus one type error. So the
   suite would have waved that change through. Its near-silence is evidence
   about the suite, not about the product — the window this would break is a
   background write landing inside the one-message hold, and nothing here
   exercises it. A green suite is not a verdict on a change the suite cannot
   see.

   The two taps that were already correct — a checkbox and an inbox removal,
   both of which change things the mark DOES cover — are pinned below, so a
   later mark change cannot quietly take their refusals away. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearnedRule } from '../../domain/prefs'
import type { ChatMessage } from '../../domain/types'
import {
  aiAdapterMock,
  brainMock,
  desktopMock,
  freshStore,
  notifyMock,
  settle,
  storageMock,
} from './storeHarness'

vi.mock('../../adapters/storage', () => storageMock())
vi.mock('../../adapters/desktop', () => desktopMock())
vi.mock('../../adapters/notify', () => notifyMock())
vi.mock('../../adapters/brain/gbrainHttp', () => brainMock())
vi.mock('../../adapters/model/aiAdapter', () => aiAdapterMock())

import { useMew } from '../store'

const pristine = useMew.getState()
const WED = new Date(2026, 5, 10, 9, 40)
const AT_14 = 14 * 60
const DECK = {
  id: 'b1',
  title: 'Deck polish',
  dayKey: '2026-06-10',
  startMin: AT_14,
  endMin: AT_14 + 60,
  tag: 'work',
  status: 'open',
  kind: 'block',
}
const RULE: LearnedRule = { match: 'deep work', tag: 'work', durationMin: 90, window: 'morning' }

const boot = async () => {
  vi.setSystemTime(WED)
  await freshStore(useMew, {
    at: WED,
    /* a non-empty week on purpose: hydrate lays down the demo seed when the db
       is empty, which sends these probes down a different path entirely */
    blocks: [DECK] as never,
    settings: { sustenance: 'off' },
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
const picked = () => useMew.getState().memory.filter((e) => e.kind === 'learned_rule')
const dismissals = () => useMew.getState().memory.filter((e) => e.kind === 'dismissed_rule')
const deck = () => useMew.getState().blocks.find((b) => b.id === 'b1')!

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('#182 — the second "forget" is undoable, and takes back nothing else', () => {
  it('THE BUG: a move, a rule forgotten by tap, then "undo that" — the rule returns and the move stays', async () => {
    await boot()
    await say('move deck polish to 15:00')
    await tick()
    expect(deck().startMin).toBe(15 * 60) // the move landed

    useMew.getState().confirmTaskRule(RULE)
    await tick()
    expect(picked()).toHaveLength(1)

    useMew.getState().forgetRule('deep work') // the console row's forget calls exactly this
    await tick()
    expect(picked()).toHaveLength(0) // the forget really forgot

    await say('undo that')
    await tick()

    /* the half that was missing */
    expect(picked()).toHaveLength(1)
    expect(picked()[0].rule?.match).toBe('deep work')
    /* THE HALF THAT WAS THE DAMAGE: the move is untouched. Before the fix this
       read 14:00 — MEW reverted a block the owner had not mentioned. */
    expect(deck().startMin).toBe(15 * 60)
    /* and the receipt names what came back, in the console's own words for a
       rule MEW worked out rather than one it was told */
    const reply = lastMewBody()
    expect(reply).toMatch(/brought back what I'd picked up about deep work/i)
    expect(reply).not.toMatch(/Deck polish/)
    expect(reply).not.toMatch(/—\s*\.$/)
  })

  it('"yes, always" is an action too: undo takes the confirmation back and says so', async () => {
    await boot()
    useMew.getState().confirmTaskRule(RULE)
    await tick()
    expect(picked()).toHaveLength(1)

    await say('undo that')
    await tick()

    expect(picked()).toHaveLength(0)
    expect(lastMewBody()).toMatch(/took back what I'd picked up about deep work/i)
  })

  it('an unrelated undo no longer throws a just-confirmed rule away', async () => {
    /* the mirror of the first test, and the reason confirmTaskRule needed the
       same treatment: the confirmation used to be swept away by a snapshot
       taken before it, with nothing in the reply to say so. */
    await boot()
    await say('move deck polish to 15:00')
    await tick()
    useMew.getState().confirmTaskRule(RULE)
    await tick()

    await say('undo that')
    await tick()

    /* undo takes back the NEWEST change — the confirmation — and leaves the
       move alone, rather than the other way round */
    expect(picked()).toHaveLength(0)
    expect(deck().startMin).toBe(15 * 60)
  })

  it('the same chip from the chat behaves identically', async () => {
    await boot()
    await say('move deck polish to 15:00')
    await tick()

    const offer: ChatMessage = {
      id: 'n-learn',
      role: 'nudge',
      ts: Date.now(),
      nudgeType: 'learn-offer',
      body: 'want me to always do that?',
      actions: [
        { id: 'confirm', label: 'yes, always', kind: 'primary' },
        { id: 'dismiss', label: 'not a rule', kind: 'secondary' },
      ],
      payload: { match: RULE.match, rule: JSON.stringify(RULE) },
    }
    useMew.setState((s) => ({ chat: [...s.chat, offer] }))
    useMew.getState().nudgeAction('n-learn', 'confirm')
    await tick()
    expect(picked()).toHaveLength(1)

    await say('undo that')
    await tick()
    expect(picked()).toHaveLength(0)
    expect(deck().startMin).toBe(15 * 60) // still not the move
  })

  it('a forget with nothing left to forget spends no undo slot', async () => {
    /* THE GUARD ON WHERE THE SNAPSHOT SITS. Move `snapshotForUndo()` above the
       guard and this fails: the no-op forget becomes the thing "undo that"
       answers, and the owner's real last change is stranded one step away. */
    await boot()
    await say('move deck polish to 15:00')
    await tick()
    useMew.getState().forgetRule('deep work') // nothing stored → writes the first dismissal
    await tick()
    expect(dismissals()).toHaveLength(1)

    useMew.getState().forgetRule('deep work') // now a true no-op
    await tick()
    expect(dismissals()).toHaveLength(1) // no second tombstone

    await say('undo that')
    await tick()
    /* undo reached PAST the no-op to the dismissal before it */
    expect(dismissals()).toHaveLength(0)
    expect(deck().startMin).toBe(15 * 60)
  })

  it('re-enabling is undoable, and stays a different act from undoing a forget', async () => {
    await boot()
    useMew.getState().confirmTaskRule(RULE)
    await tick()
    useMew.getState().forgetRule('deep work')
    await tick()
    expect(picked()).toHaveLength(0)
    expect(dismissals()).toHaveLength(1)

    useMew.getState().reEnableRule('deep work')
    await tick()
    /* re-enable lifts the DISMISSAL so the pattern can be offered again; it does
       NOT bring the rule back. That is undo's job, and the two are not the same
       act — one returns what MEW knew, the other lets MEW ask again. */
    expect(dismissals()).toHaveLength(0)
    expect(picked()).toHaveLength(0)

    await say('undo that')
    await tick()
    expect(dismissals()).toHaveLength(1) // the re-enable itself came back
  })

  it('a tombstone earns no clause: undoing "not a rule" never claims to give back a rule', async () => {
    /* coderpa's finding on this PR, and it is the right shape: the clause
       comment in store.ts says a `dismissed_rule` is machinery rather than
       something the owner did, and NOTHING asserted it. They measured the hole —
       widening the filter to `learned_rule || dismissed_rule` survives this file
       and all four undo files, 27 passed — so the exclusion was correct and its
       REASON was unpinned. That is the same debt #176's `kind === 'preference'`
       filter carried until a mutant caught it.
       With the filter widened, this undo would announce "took back what I'd
       picked up about probe" for a rule MEW never picked up: naming a thing the
       owner did not do, in the receipt whose whole job is naming what they did. */
    await boot()
    const offer: ChatMessage = {
      id: 'n-dismiss',
      role: 'nudge',
      ts: Date.now(),
      nudgeType: 'learn-offer',
      body: 'want me to always do that?',
      actions: [
        { id: 'confirm', label: 'yes, always', kind: 'primary' },
        { id: 'dismiss', label: 'not a rule', kind: 'secondary' },
      ],
      payload: { match: 'probe', rule: JSON.stringify({ ...RULE, match: 'probe' }) },
    }
    useMew.setState((s) => ({ chat: [...s.chat, offer] }))
    useMew.getState().nudgeAction('n-dismiss', 'dismiss')
    await tick()
    expect(dismissals()).toHaveLength(1)
    expect(picked()).toHaveLength(0) // nothing was ever picked up

    await say('undo that')
    await tick()

    /* the dismissal really is taken back … */
    expect(dismissals()).toHaveLength(0)
    /* … and MEW does not dress a tombstone up as a rule */
    expect(lastMewBody()).not.toMatch(/picked up/i)
    expect(lastMewBody()).not.toMatch(/probe/i)
    expect(lastMewBody()).toBe('Undone.')
  })

  it('the two taps that were already right are unchanged: a checkbox declines cleanly', async () => {
    await boot()
    await say('move deck polish to 15:00')
    await tick()
    useMew.getState().toggleComplete('b1')
    await tick()

    await say('undo that')
    await tick()
    /* a completion is in the mark, so #130's guard refuses rather than sweeping
       it back with the move — and it names what changed */
    expect(lastMewBody()).toMatch(/something else changed since/i)
    expect(lastMewBody()).toMatch(/Deck polish was checked off/i)
    expect(deck().status).toBe('done')
    expect(deck().startMin).toBe(15 * 60)
  })

  it('…and an inbox removal declines cleanly, naming the note', async () => {
    await boot()
    useMew.getState().quickCapture('call mum', false)
    await tick()
    const id = useMew.getState().captures[0].id
    await say('move deck polish to 15:00')
    await tick()
    useMew.getState().removeInboxItem(id)
    await tick()

    await say('undo that')
    await tick()
    expect(lastMewBody()).toMatch(/something else changed since/i)
    expect(lastMewBody()).toMatch(/"call mum" left your inbox/i)
    expect(deck().startMin).toBe(15 * 60)
  })
})
