/* #139 slice 2, the audit's covered half: typing a live chip's own label works
   for the DRIFT choices and the ROOM offer too. Both were audited on the real
   store and found already covered — slice 1's resolver reads whatever labels the
   live ask carries and never keys on a family — so what was missing was not a
   fix but a test saying so. One case per family, driven through the REAL ask
   rather than a hand-built chips message: the per-family risk lives in the ask,
   not in the shared reader. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, MemoryEvent, Settings } from '../../domain/types'
import { addDaysKey, dayKey } from '../../domain/time'
import { chatOrder } from '../../adapters/storage-port'

/* ── fakes (identical seams to dayload.test.ts) ───────────────────────── */

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

import { typedChipLabel } from '../../domain/choices'
import { useMew } from '../store'

/* ── harness ──────────────────────────────────────────────────────────── */

const pristine = useMew.getState()
const TUE = (h: number, m = 0) => new Date(2026, 5, 9, h, m) // Tuesday, June 9
const TODAY = '2026-06-09'
const TOMORROW = addDaysKey(TODAY, 1)

/** completed events (one per day, offset −1…−days) whose DEEP work finishes 24
    min past its 2h plan → factor 1.2; a same-day admin item finishes ~on time →
    factor ~1.07 (below the pad floor). `days < 10` keeps the day-load meter's
    own floor unmet (its throughput needs ≥10 work outcomes), so these tests read
    the estimate offer alone. */
function estimateMem(days = 6): MemoryEvent[] {
  const out: MemoryEvent[] = []
  let n = 0
  for (let i = 1; i <= days; i++) {
    const k = addDaysKey(TODAY, -i)
    const midnight = new Date(k + 'T00:00:00').getTime()
    out.push({
      id: `deep${n++}`,
      ts: midnight + (11 * 60 + 24) * 60_000, // 24 min past the 11:00 planned end
      kind: 'completed',
      dayKey: k,
      tag: 'work',
      plannedMin: 120,
      deep: true,
      startMin: 9 * 60,
      endMin: 11 * 60,
    })
    out.push({
      id: `adm${n++}`,
      ts: midnight + (13 * 60 + 32) * 60_000, // 2 min past the 13:30 planned end
      kind: 'completed',
      dayKey: k,
      tag: 'private',
      plannedMin: 30,
      startMin: 13 * 60,
      endMin: 13 * 60 + 30,
    })
  }
  return out
}

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Held — deep work',
    tag: 'work',
    dayKey: TOMORROW,
    startMin: 9 * 60,
    endMin: 11 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

async function fresh(
  blocks: Block[],
  memory: MemoryEvent[],
  over: Partial<Settings> = {},
  start = TUE(8, 0)
) {
  fakeDb.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  memory.forEach((e) => fakeDb.memory.set(e.id, e))
  fakeDb.settings = { ...pristine.settings, ...over }
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

const chat = () => useMew.getState().chat
const blocks = () => useMew.getState().blocks
const chipMsgs = () => chat().filter((m) => (m.choices?.length ?? 0) > 0)

const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/* ── the two families ─────────────────────────────────────────────── */

const WED = '2026-06-10' // tomorrow, from the harness's Tuesday

const say = (t: string) => useMew.getState().speak(t)
const lastBody = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!.body
/** what MEW acted on: the chip's own reply, posted as the owner's turn */
const lastUser = () =>
  chat()
    .filter((m) => m.role === 'user')
    .at(-1)!.body
const rows = () =>
  blocks()
    .slice()
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.startMin - b.startMin)
    .map((b) => [b.title, b.dayKey, b.startMin, b.endMin])
const captures = () => useMew.getState().captures.map((c) => c.title)

/** a flexible Groceries with walls either side, so a 14:00 placement drifts onto
    it and MEW offers the #12 choices rather than moving anything itself */
const driftWeek = (): Block[] => [
  /* this harness's block() defaults to TOMORROW, so every day is named here */
  block({
    id: 'groceries',
    title: 'Groceries',
    tag: 'private',
    dayKey: TODAY,
    startMin: 14 * 60,
    endMin: 15.5 * 60,
    protected: false,
  }),
  block({ id: 'wall-am', title: 'Offsite', dayKey: TODAY, startMin: 8 * 60, endMin: 14 * 60 }),
  block({
    id: 'wall-pm',
    title: 'Offsite',
    dayKey: TODAY,
    startMin: 15.5 * 60,
    endMin: 22.5 * 60,
  }),
  /* tomorrow is full too, so the offer is the drift choices rather than "how
     about tomorrow?" — the ask under test only exists when nothing else fits */
  block({
    id: 'wed-wall',
    title: 'Workshop',
    dayKey: WED,
    startMin: 10 * 60,
    endMin: 22.5 * 60,
  }),
]

describe('#139 slice 2 — the drift choices answer to their own labels', () => {
  it('typed, "keep both" acknowledges and "drop Groceries" drops it — through the chip\'s own path', async () => {
    /* acknowledge: the week must not move a minute */
    await fresh(driftWeek(), [], { sustenance: 'off' })
    await say('block 1h for the release review today at 14')
    await settle()
    expect(
      chipMsgs()
        .at(-1)!
        .choices!.map((c) => c.label)
    ).toEqual(['move release review to tomorrow 9:00', 'drop Groceries', 'keep both'])
    const placed = rows()
    await say('keep both')
    await settle()
    expect(lastUser()).toBe('ok, keep both as they are') // the chip's reply, as a tap
    expect(lastBody()).toBe('Good. Mewing away.')
    expect(rows()).toEqual(placed)
    expect(captures()).toEqual([])

    /* act: the drop chip resolves through pickChoice, so #12's exactness guard
       runs at pick time for a typed answer exactly as it does for a tap */
    await fresh(driftWeek(), [], { sustenance: 'off' })
    await say('block 1h for the release review today at 14')
    await settle()
    await say('drop Groceries')
    await settle()
    expect(lastUser()).toBe('remove the Groceries today at 14:00')
    expect(lastBody()).toBe('Removed — Groceries (today 14:00).')
    expect(rows().some((r) => r[0] === 'Groceries')).toBe(false)
    expect(captures()).toEqual([])
  })
})

describe('#139 slice 2 — the room offer answers to its own labels', () => {
  it('typed, "leave as-is" leaves the week alone and "give them room" resizes exactly what the offer named', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'ask' })
    await say('block the quarterly report tomorrow')
    await settle()
    const offer = chipMsgs().at(-1)!
    expect(offer.choices!.map((c) => c.label)).toEqual(['give them room', 'leave as-is'])
    const before = rows()
    await say('leave as-is')
    await settle()
    expect(lastUser()).toBe('ok, leave them as they are')
    expect(lastBody()).toBe('Good. Mewing away.')
    expect(rows()).toEqual(before)
    expect(captures()).toEqual([])

    await fresh([], estimateMem(), { estimateAutosize: 'ask' })
    await say('block the quarterly report tomorrow')
    await settle()
    const sized = rows()
    await say('give them room')
    await settle()
    expect(lastUser()).toBe('give my hour-plus work blocks room')
    expect(lastBody()).toBe(
      'Gave quarterly report room — it now runs about 20% longer, sized to how it really goes.'
    )
    expect(rows()).not.toEqual(sized)
    expect(captures()).toEqual([])
  })
})

/* ── the pass boundary, from my #159 review ───────────────────────── */

describe('#139 — an ambiguous exact match refuses rather than falling through', () => {
  /* Found as a surviving mutant while reviewing #159 and carried here per the
     manager's ruling. The exact pass runs first; when it finds TWO chips reading
     the same way it must REFUSE, not hand the question to the looser pass —
     because a looser reading of a THIRD chip would then answer, and answering
     with a chip the owner did not name is worse than not answering at all.
     That is the one-match law applied to the pass BOUNDARY rather than inside a
     single pass, which is the thing nothing else pins.

     Pure, and written against a tree that HAS the loose pass: on a tree without
     it this same assertion passes for the wrong reason, since the exact pass
     refuses on its own and there is no second pass to fall through to. */
  const ask = (labels: string[]): ChatMessage => ({
    id: 'a',
    role: 'mew',
    body: 'which?',
    ts: 1,
    choices: labels.map((label, i) => ({ id: `c${i + 1}`, label, reply: `reply ${i + 1}` })),
  })
  const user = (): ChatMessage => ({ id: 'u', role: 'user', body: 'x', ts: 0 })

  it('two chips reading the same way refuse, even when a third would match loosely', () => {
    /* "8:30" is exactly two chips' label AND the loose reading of a third */
    const m = ask(['8:30', '8:30', 'the 8:30'])
    expect(typedChipLabel([user(), m], '8:30')).toBeNull()
    /* the loose pass still works where it is unambiguous: the third chip's own
       label, minus its article, is nobody else's exact label */
    const m2 = ask(['9:15', 'the 8:30'])
    expect(typedChipLabel([user(), m2], '8:30')).toEqual({ msgId: 'a', choiceId: 'c2' })
  })
})
