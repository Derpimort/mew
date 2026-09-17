/* #139 slice 1: typing a live chip's own label does what tapping it does. Before
   this, only a remove ask read typed answers (#131) — elsewhere the words on
   screen did nothing: "roll to tomorrow" and "tomorrow 9:15" became inbox
   thoughts, "do it" and "just this one" got the generic help line. The four
   audited families are driven here through the REAL offers (a pulled meeting, a
   full day, a wide sweep, a repeating split), and each typed label goes through
   pickChoice, so the tap's own pick-time re-checks (#94) and chip retirement
   are not re-implemented. Adapters faked at their seams; no jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, MemoryEvent, Settings } from '../../domain/types'
import { addDaysKey, dayKey } from '../../domain/time'
import { chatOrder } from '../../adapters/storage-port'
import { choicesActive } from '../../domain/choices'

/* ── fakes ────────────────────────────────────────────────────────── */

const fakeDb = {
  blocks: new Map<string, unknown>(),
  captures: new Map<string, unknown>(),
  chat: new Map<string, unknown>(),
  memory: new Map<string, unknown>(),
  settings: null as Settings | null,
  chatAsc(): ChatMessage[] {
    return ([...this.chat.values()] as ChatMessage[]).sort(chatOrder)
  },
  reset() {
    this.blocks.clear()
    this.captures.clear()
    this.chat.clear()
    this.memory.clear()
    this.settings = null
  },
}

vi.mock('../../adapters/storage', () => ({
  createDexieStorage: () => ({
    load: async () => ({
      blocks: [...fakeDb.blocks.values()],
      captures: [...fakeDb.captures.values()],
      chat: fakeDb.chatAsc(),
      memory: [...fakeDb.memory.values()],
      settings: fakeDb.settings,
    }),
    putBlocks: async (bs: { id: string }[]) => bs.forEach((b) => fakeDb.blocks.set(b.id, b)),
    deleteBlocks: async (ids: string[]) => ids.forEach((i) => fakeDb.blocks.delete(i)),
    putCaptures: async (cs: { id: string }[]) => cs.forEach((c) => fakeDb.captures.set(c.id, c)),
    deleteCaptures: async (ids: string[]) => ids.forEach((i) => fakeDb.captures.delete(i)),
    putChat: async (ms: { id: string }[]) => ms.forEach((m) => fakeDb.chat.set(m.id, m)),
    countChat: async () => fakeDb.chat.size,
    loadChatBefore: async () => [],
    loadChatOlderThan: async () => [],
    deleteChat: async (ids: string[]) => ids.forEach((i) => fakeDb.chat.delete(i)),
    putMemory: async (es: { id: string }[]) => es.forEach((e) => fakeDb.memory.set(e.id, e)),
    deleteMemory: async (ids: string[]) => ids.forEach((i) => fakeDb.memory.delete(i)),
    putSettings: async (s: Settings) => {
      fakeDb.settings = s
    },
    loadSyncMap: async () => [],
    saveSyncMap: async () => {},
    deleteSyncForCalendar: async () => {},
    exportJson: async () => '{}',
    importJson: async () => {},
    getAuditLog: async () => [],
    wipe: async () => fakeDb.reset(),
  }),
}))

vi.mock('../../adapters/desktop', () => ({
  isTauri: () => false,
  readBackup: async () => null,
  latestBackupDate: async () => null,
  writeBackup: async () => {},
  registerCloseFlush: () => {},
  backupPath: () => '',
  openBackupFolder: async () => {},
  onUpdateReady: () => {},
  applyUpdate: async () => {},
  brainEndpoint: async () => null,
  brainStatus: async () => null,
  onBrainEndpoint: () => {},
  onBrainStatus: () => {},
  onShellTick: () => {},
  onTrayAction: () => {},
  updateTray: async () => {},
}))

vi.mock('../../adapters/notify', () => {
  const stub = () => ({ mirror: () => {} })
  return { createNotifier: stub, createBrowserNotifier: stub }
})

vi.mock('../../adapters/brain/gbrainHttp', () => ({
  createGbrainHttp: () => ({
    ingest: async () => {},
    recall: async () => [],
    health: async () => false,
    listPrefs: async () => [],
    links: async () => [],
  }),
}))

import { useMew } from '../store'

/* ── harness ──────────────────────────────────────────────────────── */

const pristine = useMew.getState()
const TUE = (h: number, m = 0) => new Date(2026, 5, 9, h, m) // Tuesday, June 9
const TODAY = '2026-06-09'
const WED = addDaysKey(TODAY, 1)
const THU = addDaysKey(TODAY, 2)
const WED_0005 = new Date(2026, 5, 10, 0, 5)

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Deck polish',
    tag: 'work',
    dayKey: TODAY,
    startMin: 9 * 60,
    endMin: 11 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

async function fresh(blocks: Block[], memory: MemoryEvent[] = [], start = TUE(8, 0)) {
  fakeDb.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  memory.forEach((e) => fakeDb.memory.set(e.id, e))
  fakeDb.settings = { ...pristine.settings, sustenance: 'off' }
  vi.setSystemTime(start)
  useMew.setState(
    {
      ...pristine,
      lastTickDay: dayKey(start),
      nowMs: start.getTime(),
      lastActivityMs: start.getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
}

const fmtT = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
const chat = () => useMew.getState().chat
const chipMsgs = () => chat().filter((m) => (m.choices?.length ?? 0) > 0)
const blocks = () => useMew.getState().blocks
const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!
/** the words themselves: the harness's lastMew is the MESSAGE, and asserting
    toContain on an object passes for the wrong reason (it did, until it didn't) */
const lastBody = () => lastMew().body
const settle = async () => {
  await Promise.resolve()
  vi.advanceTimersByTime(1)
  await Promise.resolve()
}
/** the clock rolls to `d` and the store ticks, as the shell does */
const rollTo = (d: Date) => {
  vi.setSystemTime(d)
  useMew.getState().tick()
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/* ── fixtures ─────────────────────────────────────────────────────── */

/** #286: a meeting pulled onto today's Deck polish (9:00–11:00) at 9:30–10:15 */
async function rescueOffer() {
  await fresh([block({ id: 'deck' })])
  useMew
    .getState()
    .simulatePull([{ eventId: 'sim1', title: 'Product sync', startMin: 570, endMin: 615 }])
  await settle()
  return chipMsgs()[0]
}

/* ── the four audited families ────────────────────────────────────── */

const say = (text: string) => useMew.getState().speak(text)
const captures = () => useMew.getState().captures
const labels = () =>
  chipMsgs()
    .at(-1)!
    .choices!.map((c) => c.label)
const at = (id: string) => {
  const b = blocks().find((x) => x.id === id)
  return b ? [b.dayKey, b.startMin, b.endMin] : null
}

describe("#139 — a typed chip label is that chip's pick, in every family", () => {
  it('the rescue offer: "roll to tomorrow" rolls it, instead of landing in the inbox', async () => {
    const offer = await rescueOffer()
    expect(offer.choices!.map((c) => c.label)).toContain('roll to tomorrow')
    await say('roll to tomorrow')
    await settle()
    expect(at('deck')![0]).toBe(WED)
    /* the bug this closes: it used to read as a thought */
    expect(captures()).toEqual([])
    expect(lastBody()).not.toContain('Captured')
    /* the chips are retired by the pick, exactly as a tap retires them */
    expect(
      choicesActive(
        chat(),
        chat().find((m) => m.id === offer.id)!
      )
    ).toBe(false)
  })

  it('the no-room offer: typing the offered time places it there', async () => {
    /* a day with no room left for an hour of work, so #116 offers tomorrow */
    /* the plannable day is 8:00–22:30 (#22), so the wall has to cover all of it
       for #116 to have nothing left to offer today */
    await fresh([block({ id: 'wall', title: 'Workshop', startMin: 8 * 60, endMin: 22 * 60 + 30 })])
    await say('block 1h for the report today')
    await settle()
    const offered = labels().find((l) => l.startsWith('tomorrow '))!
    expect(offered).toMatch(/^tomorrow \d+:\d\d$/)
    expect(blocks().filter((b) => /report/i.test(b.title))).toHaveLength(0)
    await say(offered)
    await settle()
    const report = blocks().find((b) => /report/i.test(b.title))!
    expect(report.dayKey).toBe(WED)
    expect(fmtT(report.startMin)).toBe(offered.replace('tomorrow ', ''))
    expect(captures()).toEqual([])
  })

  it('the batch confirm: "do it" moves the blocks, instead of the help line', async () => {
    await fresh([
      block({ id: 'a', title: 'Deck', startMin: 17 * 60, endMin: 18 * 60 }),
      block({ id: 'b', title: 'Inbox', startMin: 18 * 60, endMin: 18 * 60 + 30 }),
      block({ id: 'c', title: 'Notes', startMin: 19 * 60, endMin: 19 * 60 + 30 }),
    ])
    await say('push everything after 4pm later by 30 min')
    await settle()
    expect(labels()).toEqual(['do it', 'not now'])
    await say('do it')
    await settle()
    expect(lastBody()).toMatch(/^Moved 3 blocks 30 min later today — /)
    expect(at('a')).toEqual([TODAY, 17 * 60 + 30, 18 * 60 + 30])
  })

  it('the series-scope ask: "just this one" splits that occurrence only', async () => {
    await fresh([
      block({
        id: 'g1',
        title: 'Gym',
        tag: 'health',
        startMin: 9 * 60,
        endMin: 11 * 60,
        recurringBlockId: 'r1',
      }),
      block({
        id: 'g2',
        title: 'Gym',
        tag: 'health',
        dayKey: WED,
        startMin: 9 * 60,
        endMin: 11 * 60,
        recurringBlockId: 'r1',
      }),
    ])
    await say('split the gym around 10:00-10:30')
    await settle()
    expect(labels()).toEqual(['just this one', 'this & the ones after', 'the whole series'])
    await say('just this one')
    await settle()
    /* today's occurrence is in two pieces around the gap; tomorrow's is whole */
    expect(blocks().filter((b) => b.dayKey === TODAY && b.title.startsWith('Gym'))).toHaveLength(2)
    expect(at('g2')).toEqual([WED, 9 * 60, 11 * 60])
    expect(captures()).toEqual([])
  })

  it("the batch scope ask (#150, the RC's newest chips): typed, it answers the sweep", async () => {
    /* #150 landed a FIFTH family after this slice was written, and it speaks two
         of the same words as the split's scope ask. The resolver reads whatever
         labels the LIVE ask carries rather than keying on a family, so the newest
         chip in the RC answers to its own words — pinned here because the owner
         will meet this ask first, and a fix for "typing a chip label works" that
         failed on it would be worse than no fix. */
    await fresh([
      block({
        id: 'g1',
        title: 'Gym',
        tag: 'health',
        startMin: 18 * 60,
        endMin: 19 * 60,
        recurringBlockId: 'r1',
      }),
      block({
        id: 'g2',
        title: 'Gym',
        tag: 'health',
        dayKey: WED,
        startMin: 18 * 60,
        endMin: 19 * 60,
        recurringBlockId: 'r1',
      }),
    ])
    await say('push all health after 4pm today later by 30 min')
    await settle()
    expect(labels()).toEqual(['just this one', 'this & the ones after', 'the whole series'])
    await say('the whole series')
    await settle()
    /* two occurrences is a narrow change, so the answer acts straight away — and
       the receipt names each row with its own day, #150's own copy fix */
    expect(lastBody()).toBe(
      'Moved 2 blocks 30 min later — Gym today 18:00→18:30 · Gym tomorrow 18:00→18:30.'
    )
    expect(at('g1')).toEqual([TODAY, 18 * 60 + 30, 19 * 60 + 30])
    expect(at('g2')).toEqual([WED, 18 * 60 + 30, 19 * 60 + 30])
    expect(captures()).toEqual([])
  })
})

describe('#139 — and only while the words really are a live chip', () => {
  it('a label typed after the chips are spent is an ordinary message again', async () => {
    const offer = await rescueOffer()
    await useMew.getState().pickChoice(offer.id, offer.choices!.find((c) => c.id === 'roll')!.id)
    await settle()
    const where = at('deck')
    const turns = chat().filter((m) => m.role === 'user').length
    await say('roll to tomorrow')
    await settle()
    /* the chips are spent, so the second time those words are just words: the
       week does not move again behind the owner's back — and, just as important,
       the words are not swallowed either. They land as an ordinary turn and MEW
       answers, which is what a resolver that ignored `choicesActive` would lose:
       pickChoice would refuse the spent chip and the message would vanish. */
    expect(at('deck')).toEqual(where)
    expect(chat().filter((m) => m.role === 'user').length).toBe(turns + 1)
    expect(lastMew().role).toBe('mew')
    expect(lastBody()).not.toBe('')
  })

  it('a label buried in a longer sentence is not a pick: the match is the whole message', async () => {
    /* "do it" inside a sentence is conversation, not a tap — a substring reading
       would act on words the owner never meant as an answer */
    await fresh([
      block({ id: 'a', title: 'Deck', startMin: 17 * 60, endMin: 18 * 60 }),
      block({ id: 'b', title: 'Inbox', startMin: 18 * 60, endMin: 18 * 60 + 30 }),
      block({ id: 'c', title: 'Notes', startMin: 19 * 60, endMin: 19 * 60 + 30 }),
    ])
    await say('push everything after 4pm later by 30 min')
    await settle()
    expect(labels()).toEqual(['do it', 'not now'])
    await say('do it after the gym instead')
    await settle()
    expect(at('a')).toEqual([TODAY, 17 * 60, 18 * 60])
    expect(lastBody()).not.toMatch(/^Moved /)
  })

  it('a remove ask keeps its own richer reading: "both" for three still answers', async () => {
    await fresh([
      block({ id: 'l1', title: 'Lunch', dayKey: TODAY, startMin: 12 * 60, endMin: 12 * 60 + 30 }),
      block({ id: 'l2', title: 'Lunch', dayKey: WED, startMin: 12 * 60, endMin: 12 * 60 + 30 }),
      block({ id: 'l3', title: 'Lunch', dayKey: THU, startMin: 12 * 60, endMin: 12 * 60 + 30 }),
    ])
    await say('remove the lunch')
    await settle()
    await say('both')
    await settle()
    expect(blocks().filter((b) => b.title === 'Lunch')).toHaveLength(3)
    expect(captures()).toEqual([])
  })

  it('#94 still guards a typed label: offered yesterday, it acts only if it still means the same', async () => {
    await rescueOffer()
    rollTo(WED_0005)
    await say('roll to tomorrow')
    await settle()
    expect(lastBody()).toContain('offered on Tuesday')
    expect(at('deck')![0]).toBe(TODAY)
    expect(captures()).toEqual([])
  })
})
