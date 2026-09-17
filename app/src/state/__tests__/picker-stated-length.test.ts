/* #81 — a length the owner stated survives the plan-mode picker. #322 made the
   stated word law ("an explicit duration is never padded") and pinned it on the
   direct plan path. On the picker path the flag was dropped between the scenario
   and its apply (ScenarioPlace carried no durationStated), so after a pick the
   estimate guard offered to pad, and padded, lengths the owner had sized in their
   own words (probe: 90 → 110). These pins run through the REAL store, keyless,
   with the #322 harness: deep work that demonstrably runs ~20% long. A stale plan's
   re-offer is a re-quote of the stored lengths: the true stated flag rides through,
   and "always" never pre-sizes the same block twice. */

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
const offers = () => chat().filter((m) => /give them room/.test(m.body))
const found = (title: string) => blocks().find((b) => b.title.split('—')[0].trim() === title)

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

const pickerMsg = () =>
  chat()
    .filter((m) => (m.scenarios?.length ?? 0) > 0)
    .pop()!
const lengthOf = (title: string) => {
  const b = found(title)!
  return b.endMin - b.startMin
}
/* three deep blocks + two admin ones — enough distinct shapes for the picker */
const STATED_ALL =
  'block 90 min for the quarterly report, block 90 min for the board deck, block 90 min for the roadmap review, block 45 min for inbox sweep, block 45 min for errands'
const STATED_ONE =
  'block 90 min for the quarterly report, block the board deck, block the roadmap review, block inbox sweep, block errands'

async function pickFirst() {
  const picker = pickerMsg()
  expect(picker).toBeTruthy()
  const sc = picker.scenarios![0]
  useMew.getState().pickScenario(picker.id, sc.id)
  await settle()
  return sc
}

describe('ask — a stated length picked through the plan-mode picker is never offered on or padded (#81)', () => {
  it('every deep length stated: the picked plan draws no offer, and every block keeps its 90', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'ask', planMode: 'always' })
    await useMew.getState().speak(STATED_ALL)
    await settle()
    const sc = pickerMsg().scenarios![0]
    /* the quote carries the owner's word with each stated place */
    const DEEP = ['quarterly report', 'board deck', 'roadmap review']
    for (const p of sc.places.filter((x) => DEEP.includes(x.title))) {
      expect(p.durationMin).toBe(90)
      expect(p.durationStated).toBe(true)
    }
    // every length in this ask was stated, so every place says so
    for (const p of sc.places) expect(p.durationStated).toBe(true)
    await pickFirst()
    expect(offers()).toHaveLength(0)
    for (const t of ['quarterly report', 'board deck', 'roadmap review'])
      expect(lengthOf(t)).toBe(90)
  })

  it('one stated, two not: the offer still comes for the unstated, and pad resizes only those', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'ask', planMode: 'always' })
    await useMew.getState().speak(STATED_ONE)
    await settle()
    await pickFirst()
    expect(offers()).toHaveLength(1)
    await useMew.getState().pickChoice(offers()[0].id, 'pad')
    await settle()
    expect(lengthOf('quarterly report')).toBe(90) // the owner's word
    expect(lengthOf('board deck')).toBe(70) // padDuration(60, 1.2)
    expect(lengthOf('roadmap review')).toBe(70)
  })
})

describe('always — the stated word holds in the preview and the apply (#81 with #322)', () => {
  it('the stated deep block keeps 90, the unstated pre-size to 70, and nothing asks', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'always', planMode: 'always' })
    await useMew.getState().speak(STATED_ONE)
    await settle()
    const sc = await pickFirst()
    const byTitle = new Map(sc.places.map((p) => [p.title, p]))
    expect(byTitle.get('quarterly report')!.durationMin).toBe(90)
    expect(byTitle.get('board deck')!.durationMin).toBe(70)
    expect(offers()).toHaveLength(0)
    expect(lengthOf('quarterly report')).toBe(90)
    expect(lengthOf('board deck')).toBe(70)
  })
})

describe('a plan with no stated lengths is byte-identical (#81)', () => {
  it('no place carries a durationStated key at all', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'ask', planMode: 'always' })
    await useMew
      .getState()
      .speak(
        'block the quarterly report, block the board deck, block the roadmap review, block inbox sweep, block errands'
      )
    await settle()
    for (const sc of pickerMsg().scenarios!)
      for (const p of sc.places) expect(Object.keys(p)).not.toContain('durationStated')
  })
})

/* a stale plan's re-offer: the week moved under the quote, so MEW re-quotes the
   stored places. It must carry the true stated flag (so ask still offers only
   for the unstated) and must never pre-size an "always" length a second time. */
async function goStale() {
  const picker = pickerMsg()
  const sc = picker.scenarios![0]
  const first = sc.places[0]
  // a held block drops onto the first place's slot: the quote no longer applies
  useMew.setState({
    blocks: [
      ...blocks(),
      block({
        id: 'moved-in',
        title: 'Held — surprise',
        dayKey: addDaysKey(sc.todayKey, first.dayOffset),
        startMin: first.startMin,
        endMin: first.startMin + first.durationMin,
      }),
    ],
  })
  useMew.getState().pickScenario(picker.id, sc.id)
  await settle()
  const requote = pickerMsg()
  expect(requote.id).not.toBe(picker.id) // a fresh picker, nothing applied
  expect(found('board deck')).toBeUndefined()
  return requote
}

describe('a stale plan re-quotes the stored lengths honestly (#81)', () => {
  it('ask: the re-quote keeps the stated flag on the stated place only, and the offer follows the unstated', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'ask', planMode: 'always' })
    await useMew.getState().speak(STATED_ONE)
    await settle()
    const requote = await goStale()
    const places = requote.scenarios![0].places
    expect(places.find((p) => p.title === 'quarterly report')!.durationStated).toBe(true)
    expect(places.find((p) => p.title === 'board deck')!.durationStated).toBeUndefined()
    await pickFirst()
    expect(offers()).toHaveLength(1)
    await useMew.getState().pickChoice(offers()[0].id, 'pad')
    await settle()
    expect(lengthOf('quarterly report')).toBe(90)
    expect(lengthOf('board deck')).toBe(70)
  })

  it('always: a pre-sized length is re-quoted as-is — 70 stays 70, never padded again to 85', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'always', planMode: 'always' })
    await useMew.getState().speak(STATED_ONE)
    await settle()
    const requote = await goStale()
    const places = requote.scenarios![0].places
    expect(places.find((p) => p.title === 'board deck')!.durationMin).toBe(70)
    expect(places.find((p) => p.title === 'quarterly report')!.durationMin).toBe(90)
    await pickFirst()
    expect(lengthOf('board deck')).toBe(70)
    expect(offers()).toHaveLength(0)
  })
})
