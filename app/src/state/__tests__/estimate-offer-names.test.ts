/* #90 — the estimate offer names the blocks it would pad. #322's offer read
   "your deep-work blocks tend to run ~20% long" while padding a default-length
   inbox sweep and errands: a 60-min work block IS the deep class, so the class
   word stood in for blocks that aren't deep work. The classes stay as they are;
   the offer and its confirmation now say what they touch, and the class reads as
   what it is (hour-plus work). Through the REAL store, keyless; the #322 harness. */

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

describe('#90 — the estimate offer names the blocks it pads', () => {
  it('the #90 repro through the plan-mode picker: the offer names inbox sweep and errands, never "deep-work"', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'ask', planMode: 'always' })
    await useMew
      .getState()
      .speak(
        'block 90 min for the quarterly report, block 90 min for the board deck, block 90 min for the roadmap review, block inbox sweep, block errands'
      )
    await settle()
    const picker = chat().find((m) => (m.scenarios?.length ?? 0) > 0)!
    useMew.getState().pickScenario(picker.id, picker.scenarios![0].id)
    await settle()

    expect(offers()).toHaveLength(1)
    const body = offers()[0].body
    expect(body).toBe(
      'your hour-plus work blocks tend to run ~20% long — want me to give them room? (inbox sweep, errands)'
    )
    expect(body).not.toMatch(/deep-work|deep work/)

    await useMew.getState().pickChoice(offers()[0].id, 'pad')
    await settle()
    const len = (t: string) => found(t)!.endMin - found(t)!.startMin
    expect([len('inbox sweep'), len('errands')]).toEqual([70, 70])
    expect([len('quarterly report'), len('board deck'), len('roadmap review')]).toEqual([
      90, 90, 90,
    ])
    expect(
      chat().some(
        (m) =>
          m.role === 'mew' &&
          m.body ===
            'Gave inbox sweep and errands room — 2 now run about 20% longer, sized to how they really go.'
      )
    ).toBe(true)
  })

  it('more than three blocks read "a, b and N more"; the confirmation names them the same way', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'ask' })
    await useMew
      .getState()
      .speak(
        'block the quarterly report tomorrow, block the board deck tomorrow, block the roadmap review tomorrow, block the budget model tomorrow'
      )
    await settle()

    expect(offers()).toHaveLength(1)
    expect(offers()[0].body).toMatch(/\(quarterly report, board deck and 2 more\)$/)
    await useMew.getState().pickChoice(offers()[0].id, 'pad')
    await settle()
    expect(
      chat().some(
        (m) =>
          m.role === 'mew' &&
          /^Gave quarterly report, board deck and 2 more room — 4 now run/.test(m.body)
      )
    ).toBe(true)
  })

  it('a chip already in the chat keeps working: the pre-#90 "give my deep-work blocks room" still pads', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'ask' })
    await useMew.getState().speak('block the quarterly report tomorrow')
    await settle()
    expect(offers()).toHaveLength(1)

    await useMew.getState().speak('give my deep-work blocks room')
    await settle()

    expect(found('quarterly report')!.endMin - found('quarterly report')!.startMin).toBe(70)
  })
})
