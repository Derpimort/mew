/* Recall over any stretch of time (#8), through the REAL store: a history
   question's range becomes real sums from kept blocks — brain OFF, so the
   on-device floor answers ranges too, and the brain is never asked for what
   the blocks already know. Since-a-date, the last N weeks, month and year
   edges, the one-year cap and a date still ahead; the pre-#8 phrasing answers
   exactly as before; and with the brain on, recall rides under the range sums
   having heard the phrase verbatim. Adapters are faked at their seams
   (in-memory storage, a scriptable brain); no network, no keys, no jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, Settings } from '../../domain/types'
import { dayKey } from '../../domain/time'
import { chatOrder } from '../../adapters/storage-port'

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

/* the brain: off unless a test turns it on; every recall it hears is kept */
const brainFake = vi.hoisted(() => ({
  recalls: [] as string[],
  recallLines: [] as string[],
  reset() {
    this.recalls = []
    this.recallLines = []
  },
}))
vi.mock('../../adapters/brain/gbrainHttp', () => ({
  createGbrainHttp: (cfg: { enabled(): boolean }) => ({
    ingest: async () => {},
    recall: async (q: string) => {
      if (!cfg.enabled()) return []
      brainFake.recalls.push(q)
      return brainFake.recallLines
    },
    health: async () => false,
    listPrefs: async () => [],
    links: async () => [],
  }),
}))

import { useMew } from '../store'

/* ── harness: Thursday, September 17 2026 ────────────────────────── */

const pristine = useMew.getState()
const THU = (h = 10, m = 0) => new Date(2026, 8, 17, h, m)

/** one hour of gym at 7:00 — done unless it's still ahead */
function gym(day: string, over: Partial<Block> = {}): Block {
  return {
    id: `gym-${day}`,
    title: 'Gym',
    tag: 'health',
    dayKey: day,
    startMin: 7 * 60,
    endMin: 8 * 60,
    protected: false,
    status: 'done',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

async function fresh(blocks: Block[], start = THU()) {
  fakeDb.reset()
  brainFake.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
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

const ask = (q: string) => useMew.getState().queryBrain(q)

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/* ── scenarios ────────────────────────────────────────────────────── */

describe('brain off: the on-device floor answers any stretch', () => {
  it('"the last 3 weeks" sums 21 days of real blocks — the edges exact — and never asks the brain', async () => {
    await fresh([
      gym('2026-08-27'), // 22 days back — outside
      gym('2026-08-28'), // the first day in
      gym('2026-09-03'),
      gym('2026-09-10'),
      gym('2026-09-17', { startMin: 18 * 60, endMin: 19 * 60, status: 'open' }), // today, still ahead
      gym('2026-09-18', { status: 'open' }), // tomorrow — outside
    ])
    const reply = await ask('how were my gym sessions over the last 3 weeks?')
    expect(reply).toBe('gym the last three weeks: 4h across 4 blocks · 3h done, 1h still open.')
    expect(brainFake.recalls).toHaveLength(0) // the sums are local; nothing was asked
  })

  it('"since August 1" runs from the 1st through today; July 31 stays out', async () => {
    await fresh([gym('2026-07-31'), gym('2026-08-01'), gym('2026-09-16')])
    expect(await ask('how much time did gym take since August 1')).toBe(
      'gym since Aug 1: 2h across 2 blocks · 2h done.'
    )
  })

  it('"between Aug 3 and Aug 17" counts both ends and not the day after', async () => {
    await fresh([gym('2026-08-02'), gym('2026-08-03'), gym('2026-08-17'), gym('2026-08-18')])
    expect(await ask('how much time did gym take between Aug 17 and Aug 3?')).toBe(
      'gym from Aug 3 to Aug 17: 2h across 2 blocks · 2h done.'
    )
  })

  it('"this month" and "last month" split exactly at the month edge', async () => {
    await fresh([gym('2026-08-31'), gym('2026-09-01', { endMin: 9 * 60 })])
    expect(await ask('how much time did gym take this month')).toBe(
      'gym this month: 2h across 1 block · 2h done.'
    )
    expect(await ask('how much time did gym take last month')).toBe(
      'gym last month: 1h across 1 block · 1h done.'
    )
  })

  it('across New Year (asked Jan 5, 2027): "since December 28" and "last month" land in 2026', async () => {
    await fresh(
      [gym('2026-12-27'), gym('2026-12-28'), gym('2027-01-04')],
      new Date(2027, 0, 5, 10, 0)
    )
    expect(await ask('how much time did gym take since December 28')).toBe(
      'gym since Dec 28, 2026: 2h across 2 blocks · 2h done.'
    )
    expect(await ask('how much time did gym take last month')).toBe(
      'gym last month: 2h across 2 blocks · 2h done.'
    )
  })

  it('a very long stretch keeps its most recent year — and says so', async () => {
    await fresh([gym('2024-09-01'), gym('2026-03-01')])
    expect(await ask('how much time did gym take since 2019-01-01')).toBe(
      'gym since Jan 1, 2019 (the most recent year): 1h across 1 block · 1h done.'
    )
  })

  it('a date still ahead: nothing to look back on yet, said kindly, no numbers', async () => {
    await fresh([gym('2026-09-16')])
    const reply = await ask('how much time did gym take since October 5, 2027')
    expect(reply).toBe("Oct 5, 2027 is still ahead, so there's nothing to look back on yet.")
    expect(reply).not.toMatch(/\dh|missed|failed|can't/)
  })

  it('an empty stretch is honest about the days it looked at — and claims no brain', async () => {
    await fresh([gym('2026-09-16')])
    expect(await ask('how much time did pottery take since August 1')).toBe(
      "I can't see pottery since Aug 1 — nothing in those days' blocks mentions it."
    )
    expect(await ask('how much time did pottery take yesterday')).toBe(
      "I can't see pottery yesterday — nothing in that day's blocks mentions it."
    )
  })

  it('unreadable dates never guess: the question answers for this week, and says so', async () => {
    await fresh([gym('2026-08-10'), gym('2026-09-15')])
    expect(await ask('how much time did gym take since blorp')).toBe(
      'gym this week: 1h across 1 block · 1h done, 0h still open.'
    )
  })

  it('a block named with time words stays the subject; the stretch comes from the rest', async () => {
    const review = (day: string): Block => ({
      ...gym(day),
      id: `lwr-${day}`,
      title: 'Last week review',
    })
    await fresh([review('2026-07-20'), review('2026-08-10'), review('2026-09-15')])
    expect(await ask('how much time did last week review take since August 1?')).toBe(
      'Last week review since Aug 1: 2h across 2 blocks · 2h done.'
    )
  })
})

describe('peer review #69 — spans that must read right', () => {
  it('"from monday to friday" asked Thursday sums this Mon–Fri — never a swapped stretch', async () => {
    await fresh([
      gym('2026-09-11'), // last Friday: outside
      gym('2026-09-13'), // Sunday: outside
      gym('2026-09-14'),
      gym('2026-09-15'),
      gym('2026-09-16'),
      gym('2026-09-17'),
    ])
    expect(await ask('how much time did gym take from monday to friday')).toBe(
      'gym from Sep 14 to Sep 18: 4h across 4 blocks · 4h done.'
    )
  })

  it('a year still ahead answers "still ahead" even with its first week already planned', async () => {
    await fresh(
      [gym('2026-12-21'), gym('2027-01-02', { status: 'open' })],
      new Date(2026, 11, 28, 10, 0)
    )
    const reply = await ask('how much time did gym take in 2027')
    expect(reply).toBe("Jan 1, 2027 is still ahead, so there's nothing to look back on yet.")
    expect(reply).not.toMatch(/\dh/)
  })
})

describe('the pre-#8 phrasings answer exactly as before', () => {
  it('"last week" and no phrase keep their words, tails and all', async () => {
    await fresh([gym('2026-09-08'), gym('2026-09-11'), gym('2026-09-16')])
    expect(await ask('how much time did gym take last week')).toBe(
      'gym last week: 2h across 2 blocks · 2h done.'
    )
    expect(await ask('how much time did gym take')).toBe(
      'gym this week: 1h across 1 block · 1h done, 0h still open.'
    )
    expect(await ask('how much time did gym take two weeks ago')).toBe(
      "I can't see gym two weeks ago — nothing in that week's blocks mentions it."
    )
  })
})

describe('brain on', () => {
  it('recall rides under the range sums, having heard the phrase verbatim', async () => {
    await fresh([gym('2026-08-01'), gym('2026-09-16')])
    useMew.getState().updateSettings({ brainEnabled: true })
    brainFake.recallLines = ['task/gym — mornings stick']
    const reply = await ask('how much time did gym take since August 1')
    expect(reply).toBe('gym since Aug 1: 2h across 2 blocks · 2h done.\ntask/gym — mornings stick')
    expect(brainFake.recalls).toEqual(['how much time did gym take since August 1'])
    await vi.advanceTimersByTimeAsync(60_000) // drain the chat batcher
  })

  it('an empty stretch names the brain only because it really answered', async () => {
    await fresh([gym('2026-09-16')])
    useMew.getState().updateSettings({ brainEnabled: true })
    expect(await ask('how much time did pottery take over the last 2 weeks')).toBe(
      "I can't see pottery the last two weeks — nothing in those days' blocks or the brain mentions it."
    )
    await vi.advanceTimersByTimeAsync(60_000)
  })
})
