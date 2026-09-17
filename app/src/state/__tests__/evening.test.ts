/* #22 slice A — the evening exists, through the REAL store. The live transcript's
   evening (a fixed 23:15 home call, nothing else after 18:30, asked at 20:46) as
   executor pins: suggest_slots names a slot tonight, a time-less plan lands
   tonight in one sweep, find_slot/suggest_slots never call out-of-bounds air
   "held", the owner's plannable hours reach every executor, and they stay
   independent of quiet hours. Adapters faked at their seams (the granular-ops
   harness); a scripted local turn hands the test the executor. No jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, Settings } from '../../domain/types'
import { DEFAULT_PLANNABLE_HOURS } from '../../domain/types'
import { chatOrder } from '../../adapters/storage-port'
import { contextBlock, type ToolExecutor, type WeekContext } from '../../adapters/model/types'

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

/* a scripted local model: the turn hands midTurn the real executor and keeps
   the week context it was given. Provider 'ollama' only; nothing touches net. */
const scriptedModel = {
  midTurn: null as null | ((exec: ToolExecutor) => void),
  lastCtx: null as WeekContext | null,
  reset() {
    this.midTurn = null
    this.lastCtx = null
  },
}
vi.mock('../../adapters/model/aiAdapter', () => ({
  createAiAdapter: (spec: { provider: string }) => ({
    id: spec.provider,
    async *converse(_thread: unknown, ctx: unknown, exec: ToolExecutor) {
      if (spec.provider !== 'ollama') throw Object.assign(new Error('offline'), { statusCode: 503 })
      scriptedModel.lastCtx = ctx as WeekContext
      yield 'looking.'
      scriptedModel.midTurn?.(exec)
    },
  }),
}))

import { useMew } from '../store'

/* ── harness ──────────────────────────────────────────────────────── */

const pristine = useMew.getState()
const TUE = (h: number, m = 0) => new Date(2026, 5, 9, h, m) // Tuesday, June 9
const TODAY = '2026-06-09'

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Deck',
    tag: 'work',
    dayKey: TODAY,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

/** the live evening: a fixed home call at 23:15, nothing else after 18:30 */
const homeCall = () =>
  block({ id: 'call', title: 'Home call', tag: 'private', startMin: 23 * 60 + 15, endMin: 24 * 60 })

async function fresh(blocks: Block[], start: Date, settings: Partial<Settings> = {}) {
  fakeDb.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  /* the morning scaffold stays off: these pins read the week exactly as seeded */
  fakeDb.settings = { ...pristine.settings, modelLocation: 'local', sustenance: 'off', ...settings }
  vi.setSystemTime(start)
  useMew.setState(
    {
      ...pristine,
      lastTickDay: TODAY,
      nowMs: start.getTime(),
      lastActivityMs: start.getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
}

/** one scripted model turn; returns what the tool call handed back */
async function viaTool(call: (exec: ToolExecutor) => string): Promise<string> {
  let out = ''
  scriptedModel.midTurn = (exec) => {
    out = call(exec)
  }
  await useMew.getState().speak('find me time')
  return out
}

const blocks = () => useMew.getState().blocks

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  scriptedModel.reset()
})

/* ── AC1: the evening is placeable ────────────────────────────────── */

describe('#22 AC1 — asked at 20:46, tonight has room', () => {
  it('suggest_slots names a slot tonight, even when tomorrow morning ranks first', async () => {
    await fresh([homeCall()], TUE(20, 46))
    const out = await viaTool((exec) => exec.suggestSlots('prod release', 'work', 60))
    expect(out).toMatch(/^Best slots for "prod release", highest first: tomorrow 8:00–9:00/)
    expect(out).toContain('Tonight is open too: 20:46–21:46.')
    expect(out).not.toMatch(/held/)
  })

  it('"tonight" (window evening) ranks tonight first', async () => {
    await fresh([homeCall()], TUE(20, 46))
    const out = await viaTool((exec) =>
      exec.suggestSlots('prod release', 'work', 60, undefined, 'evening')
    )
    expect(out).toMatch(/^Best slots for "prod release", highest first: today 20:46–21:46/)
    expect(out).not.toContain('Tonight is open too') // already on the list
  })

  it('a time-less plan lands tonight in one sweep — no "the day is full"', async () => {
    await fresh([homeCall()], TUE(20, 46))
    const out = await viaTool((exec) =>
      exec.plan([{ title: 'prod release', tag: 'work', dayOffset: 0, durationMin: 60 }], [])
    )
    expect(out).not.toMatch(/couldn't hold|full/)
    const placed = blocks().find((b) => b.title === 'prod release')!
    expect(placed.dayKey).toBe(TODAY)
    expect(placed.startMin).toBeGreaterThanOrEqual(20 * 60 + 46)
    expect(placed.endMin).toBeLessThanOrEqual(22 * 60 + 30)
  })
})

/* ── AC3: never "held" when the air is merely out of bounds ───────── */

describe('#22 AC3 — the no-slot reason is true', () => {
  it('find_slot at 22:10 names the plannable hours and the real free air', async () => {
    await fresh([homeCall()], TUE(22, 10))
    const out = await viaTool((exec) => exec.findSlot(60, 0))
    expect(out).toBe(
      "No 60-min window today fits inside the hours I plan in (8:00–22:30). Open air today: 22:15–23:15, running past the hours I plan in (8:00–22:30) — name a time there and I'll hold it. Nearest clear options: tomorrow 9:00–10:00."
    )
  })

  it('suggest_slots with a deadline past the plannable end says so, and names the air', async () => {
    await fresh([homeCall()], TUE(22, 10))
    const out = await viaTool((exec) => exec.suggestSlots('prod release', 'work', 60, 23 * 60 + 15))
    expect(out).toBe(
      `No 60-min slot for "prod release" fits inside the hours I plan in (8:00–22:30) before its deadline today. Open air today: 22:10–23:15, running past the hours I plan in (8:00–22:30) — name a time there and I'll hold it.`
    )
  })

  it('a day that really is held keeps the held wording — it is true there', async () => {
    const wall = block({ id: 'wall', title: 'Offsite', startMin: 8 * 60, endMin: 24 * 60 })
    await fresh([wall], TUE(10, 0))
    const out = await viaTool((exec) => exec.findSlot(60, 0))
    expect(out).toMatch(/every gap is held by something fixed or committed/)
    expect(out).toContain('tomorrow 9:00–10:00')
  })

  it("a stated ceiling is the user's own limit and keeps its wording", async () => {
    const afternoon = block({ id: 'pm', startMin: 12 * 60, endMin: 17 * 60 })
    await fresh([afternoon], TUE(12, 0))
    const out = await viaTool((exec) => exec.findSlot(60, 0, undefined, 17 * 60))
    expect(out).toMatch(/^No clear 60-min window today before 17:00 — every gap is held/)
    expect(out).toContain('later today 17:00–18:00')
  })
})

/* ── AC6 (independence half) + the owner's hours reach every executor ── */

describe('#22 AC6 — plannable hours stand apart from quiet hours', () => {
  it('changing quiet hours never moves the plannable day, and vice versa', async () => {
    await fresh([], TUE(9, 0))
    useMew.getState().updateSettings({ quietHours: { startMin: 21 * 60, endMin: 7 * 60 } })
    expect(useMew.getState().settings.plannableHours).toEqual(DEFAULT_PLANNABLE_HOURS)

    useMew.getState().updateSettings({ plannableHours: { startMin: 7 * 60, endMin: 20 * 60 } })
    expect(useMew.getState().settings.quietHours).toEqual({ startMin: 21 * 60, endMin: 7 * 60 })
    expect(fakeDb.settings!.plannableHours).toEqual({ startMin: 7 * 60, endMin: 20 * 60 })
  })

  it('settings saved before #22 hydrate with the default plannable day', async () => {
    const { plannableHours: _gone, ...legacy } = pristine.settings
    await fresh([], TUE(9, 0))
    fakeDb.settings = legacy as Settings
    await useMew.getState().hydrate()
    expect(useMew.getState().settings.plannableHours).toEqual(DEFAULT_PLANNABLE_HOURS)
  })

  it("the owner's hours bound the tools: a 20:00 end keeps tonight out, a 7:00 start opens the morning", async () => {
    const hours = { startMin: 7 * 60, endMin: 20 * 60 }
    await fresh([homeCall()], TUE(19, 30), { plannableHours: hours })
    const tonight = await viaTool((exec) => exec.suggestSlots('walk', 'private', 60))
    expect(tonight).not.toMatch(/today \d/)
    expect(tonight).toContain(
      "Open air today: 19:30–23:15, running past the hours I plan in (7:00–20:00) — name a time there and I'll hold it."
    )
    const morning = await viaTool((exec) => exec.findSlot(60, 1))
    expect(morning).toBe(
      'Clear window Wednesday: 7:00–8:00 (checked against every time-holding block).'
    )
  })

  it('moveToNextFree reaches the evening instead of rolling to tomorrow', async () => {
    const reading = block({
      id: 'read',
      title: 'Reading',
      tag: 'private',
      startMin: 17 * 60,
      endMin: 18 * 60,
    })
    const wall = block({ id: 'wall', title: 'Workshop', startMin: 18 * 60, endMin: 20 * 60 })
    await fresh([reading, wall], TUE(18, 0))
    useMew.getState().moveToNextFree('read')
    const moved = blocks().find((b) => b.id === 'read')!
    expect(moved.dayKey).toBe(TODAY)
    expect(moved.startMin).toBe(20 * 60)
  })

  it('the model is told the bounds', async () => {
    await fresh([homeCall()], TUE(11, 0))
    const out = await viaTool((exec) => exec.listBlocks(0))
    expect(out).not.toBe('')
    expect(scriptedModel.lastCtx!.plannableHours).toBe('8:00–22:30')
    expect(contextBlock(scriptedModel.lastCtx!)).toContain('>8:00–22:30</plannable-hours>')
  })
})
