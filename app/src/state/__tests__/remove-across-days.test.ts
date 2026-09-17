/* #62 — a time-pinned remove never deletes across days, through the REAL store.
   "remove the lunch at 12:00" with a 12:00 Lunch on several days asks which one,
   with chips that name each block's day, and removes nothing until a pick. A pick
   removes exactly that day's Lunch. A single match is still removed directly, an
   explicit all still sweeps, a recurring series keeps its this/following/series
   ask, and a keyed remove_blocks behaves the same (dayOffset pins the day).
   Adapters faked at their seams (the granular-ops harness). No jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, Settings } from '../../domain/types'
import { chatOrder } from '../../adapters/storage-port'
import { CHOICES_POSTED, type ToolExecutor } from '../../adapters/model/types'

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

const scriptedModel = {
  midTurn: null as null | ((exec: ToolExecutor) => void),
  reset() {
    this.midTurn = null
  },
}
vi.mock('../../adapters/model/aiAdapter', () => ({
  createAiAdapter: (spec: { provider: string }) => ({
    id: spec.provider,
    async *converse(_thread: unknown, _ctx: unknown, exec: ToolExecutor) {
      if (spec.provider !== 'ollama') throw Object.assign(new Error('offline'), { statusCode: 503 })
      yield 'on it.'
      scriptedModel.midTurn?.(exec)
    },
  }),
}))

import { runTool } from '../../adapters/model/tools'
import { useMew } from '../store'

const pristine = useMew.getState()
const TUE = (h: number, m = 0) => new Date(2026, 5, 9, h, m) // Tuesday, June 9
const TODAY = '2026-06-09'
const WED = '2026-06-10'
const THU = '2026-06-11'

function lunch(id: string, dayKey: string, over: Partial<Block> = {}): Block {
  return {
    id,
    title: 'Lunch',
    tag: 'private',
    dayKey,
    startMin: 12 * 60,
    endMin: 12 * 60 + 45,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}
const threeLunches = () => [lunch('tue', TODAY), lunch('wed', WED), lunch('thu', THU)]
/** a block whose TITLE carries a weekday word, at 15:00 on `dayKey` */
const named = (id: string, title: string, dayKey: string) =>
  lunch(id, dayKey, { title, startMin: 15 * 60, endMin: 16 * 60 })
const idsOf = (title: string) =>
  useMew
    .getState()
    .blocks.filter((b) => b.title === title)
    .map((b) => b.id)
    .sort()

async function fresh(blocks: Block[], location: 'remote' | 'local' = 'remote') {
  fakeDb.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  fakeDb.settings = { ...pristine.settings, modelLocation: location, sustenance: 'off' }
  vi.setSystemTime(TUE(9, 0))
  useMew.setState(
    {
      ...pristine,
      lastTickDay: TODAY,
      nowMs: TUE(9, 0).getTime(),
      lastActivityMs: TUE(9, 0).getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
}

const chat = () => useMew.getState().chat
const lunchIds = () =>
  useMew
    .getState()
    .blocks.filter((b) => b.title === 'Lunch')
    .map((b) => b.id)
    .sort()
const chipMsgs = () => chat().filter((m: ChatMessage) => (m.choices?.length ?? 0) > 0)
const say = (text: string) => useMew.getState().speak(text)
const settle = async () => {
  await Promise.resolve()
  vi.advanceTimersByTime(1)
  await Promise.resolve()
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  scriptedModel.reset()
})

describe('#62 — keyless: a time alone never reaches across days', () => {
  it('"remove the lunch at 12:00" with three 12:00 Lunches asks which, and removes nothing', async () => {
    await fresh(threeLunches())
    await say('remove the lunch at 12:00')
    await settle()
    expect(lunchIds()).toEqual(['thu', 'tue', 'wed'])
    const ask = chipMsgs()
    expect(ask).toHaveLength(1)
    expect(ask[0].body).toMatch(/^3 "lunch" blocks ahead/)
    expect(ask[0].choices!.map((c) => ({ label: c.label, reply: c.reply }))).toEqual([
      { label: 'today 12:00', reply: 'remove lunch today at 12:00' },
      { label: 'tomorrow 12:00', reply: 'remove lunch tomorrow at 12:00' },
      { label: 'thursday 12:00', reply: 'remove lunch on thursday at 12:00' },
      { label: 'all of them', reply: 'remove all lunch' },
    ])
  })

  it("a day chip removes exactly that day's Lunch", async () => {
    await fresh(threeLunches())
    await say('remove the lunch at 12:00')
    await settle()
    const ask = chipMsgs()[0]
    await useMew
      .getState()
      .pickChoice(ask.id, ask.choices!.find((c) => c.label === 'thursday 12:00')!.id)
    await settle()
    expect(lunchIds()).toEqual(['tue', 'wed'])
    expect(chat()[chat().length - 1].body).toMatch(/^Removed — /)
  })

  it('typing the day works the same way', async () => {
    await fresh(threeLunches())
    await say('remove the lunch tomorrow at 12:00')
    await settle()
    expect(lunchIds()).toEqual(['thu', 'tue'])
    expect(chipMsgs()).toHaveLength(0)
  })

  it('a single 12:00 Lunch from today on is still removed directly', async () => {
    await fresh([
      lunch('tue', TODAY),
      lunch('wed-late', WED, { startMin: 13 * 60, endMin: 13 * 60 + 45 }),
    ])
    await say('remove the lunch at 12:00')
    await settle()
    expect(lunchIds()).toEqual(['wed-late'])
    expect(chipMsgs()).toHaveLength(0)
  })

  it('an explicit all still removes every 12:00 Lunch', async () => {
    await fresh([
      ...threeLunches(),
      lunch('wed-late', WED, { startMin: 13 * 60, endMin: 13 * 60 + 45 }),
    ])
    await say('remove all lunch at 12:00')
    await settle()
    expect(lunchIds()).toEqual(['wed-late'])
  })

  it('a recurring series keeps its this / following / series ask', async () => {
    const series = threeLunches().map((b) => ({ ...b, recurringBlockId: 'lunch-series' }))
    await fresh(series)
    await say('remove the lunch at 12:00')
    await settle()
    expect(lunchIds()).toEqual(['thu', 'tue', 'wed'])
    const labels = chipMsgs()[0].choices!.map((c) => c.label.toLowerCase())
    expect(labels.some((l) => l.includes('series'))).toBe(true)
  })
})

describe('#62 — keyed remove_blocks behaves the same', () => {
  it('at alone asks (chips on screen) and removes nothing; dayOffset removes exactly one', async () => {
    await fresh(threeLunches(), 'local')
    let asked = ''
    scriptedModel.midTurn = (exec) => {
      asked = exec.remove('lunch', { at: '12:00' })
    }
    await say('drop the 12 o clock lunch')
    await settle()
    expect(asked.startsWith(CHOICES_POSTED)).toBe(true)
    expect(lunchIds()).toEqual(['thu', 'tue', 'wed'])

    let removed = ''
    scriptedModel.midTurn = (exec) => {
      removed = exec.remove('lunch', { at: '12:00', dayOffset: 1 })
    }
    await say('the one tomorrow')
    await settle()
    expect(removed).toMatch(/^Removed — /)
    expect(lunchIds()).toEqual(['thu', 'tue'])
  })
})

/* peer review of #66 (coderpa): a weekday word inside a TITLE is not a day pin —
   the RC removed these, and the pin must not turn them into "couldn't find" */
describe('#62 review — a weekday-named title is still the title', () => {
  it.each([
    ['remove the friday demo', 'Friday demo', THU],
    ['remove sun salutation', 'Sun salutation', WED],
    ['remove the monday planning', 'Monday planning', WED],
  ])('"%s" removes the %s on another day', async (said, title, dayKey) => {
    await fresh([named('only', title, dayKey)])
    await say(said)
    await settle()
    expect(idsOf(title)).toEqual([])
    expect(chat()[chat().length - 1].body).toMatch(/^Removed — /)
  })

  it('the #62 ask works for it: day chips, nothing removed, and each chip does what it says', async () => {
    await fresh([named('wed', 'Friday demo', WED), named('thu', 'Friday demo', THU)])
    await say('remove the friday demo at 15:00')
    await settle()
    expect(idsOf('Friday demo')).toEqual(['thu', 'wed'])
    const ask = chipMsgs()
    expect(ask).toHaveLength(1)
    expect(ask[0].choices!.map((c) => c.label)).toEqual([
      'tomorrow 15:00',
      'thursday 15:00',
      'both',
    ])

    await useMew
      .getState()
      .pickChoice(ask[0].id, ask[0].choices!.find((c) => c.label === 'thursday 15:00')!.id)
    await settle()
    expect(idsOf('Friday demo')).toEqual(['wed']) // Thursday's went — not a Friday nobody has
  })

  it('keyed: the "both" chip sweeps every match — the title never pins it to Friday', async () => {
    await fresh([named('wed', 'Friday demo', WED), named('thu', 'Friday demo', THU)], 'local')
    scriptedModel.midTurn = (exec) => {
      exec.remove('Friday demo', { at: '15:00' })
    }
    await say('drop the 3pm friday demo')
    await settle()
    const ask = chipMsgs()[chipMsgs().length - 1]
    expect(ask.choices!.map((c) => c.reply)).toEqual([
      'remove Friday demo tomorrow at 15:00',
      'remove Friday demo on thursday at 15:00',
      'remove all Friday demo',
    ])
    /* a chip reply is a complete remove the parser acts on — pick it on the
       keyless floor so the PARSE of "remove all Friday demo" is what's proven */
    scriptedModel.reset()
    useMew.getState().updateSettings({ modelLocation: 'remote' })
    await useMew.getState().pickChoice(ask.id, ask.choices!.find((c) => c.label === 'both')!.id)
    await settle()
    expect(idsOf('Friday demo')).toEqual([])
  })
})

describe('#62 review — a model dayOffset out of range is ignored, never clamped', () => {
  it.each([14, -1, 1.5, '1'])('dayOffset %s pins nothing: the repeated time asks', async (bad) => {
    const daily = [...threeLunches(), lunch('day13', '2026-06-22')]
    await fresh(daily, 'local')
    let pending: Promise<string> | null = null
    scriptedModel.midTurn = (exec) => {
      pending = runTool('remove_blocks', { query: 'lunch', at: '12:00', dayOffset: bad }, exec)
    }
    await say('drop the lunch two weeks out')
    await settle()
    expect((await pending!).startsWith(CHOICES_POSTED)).toBe(true)
    expect(lunchIds()).toEqual(['day13', 'thu', 'tue', 'wed']) // day 13's Lunch is still there
  })

  it('an in-range dayOffset still removes exactly that day', async () => {
    await fresh(threeLunches(), 'local')
    let pending: Promise<string> | null = null
    scriptedModel.midTurn = (exec) => {
      pending = runTool('remove_blocks', { query: 'lunch', at: '12:00', dayOffset: 2 }, exec)
    }
    await say('drop thursday lunch')
    await settle()
    expect(await pending!).toMatch(/^Removed — /)
    expect(lunchIds()).toEqual(['tue', 'wed'])
  })
})

/* #72 — a day phrase is the day, not the title: "this thursday", "thursday's" and
   "next thursday" used to leave "lunch this" / "'s lunch" / "lunch next" as the
   query, so nothing was found and nothing removed. Through the real store,
   keyless, asked on Tuesday. */
describe('#72 — remove by a day phrase finds the block', () => {
  it('"remove the lunch this thursday at 12:00" removes exactly Thursday\'s Lunch', async () => {
    await fresh(threeLunches())
    await say('remove the lunch this thursday at 12:00')
    await settle()
    expect(lunchIds()).toEqual(['tue', 'wed'])
    expect(chat()[chat().length - 1].body).toMatch(/^Removed — /)
    expect(chipMsgs()).toHaveLength(0)
  })

  it('"remove thursday\'s lunch" removes the one Thursday Lunch', async () => {
    await fresh(threeLunches())
    await say("remove thursday's lunch")
    await settle()
    expect(lunchIds()).toEqual(['tue', 'wed'])
    expect(chat()[chat().length - 1].body).toMatch(/^Removed — /)
  })

  it('"remove thursday\'s lunch" with two Lunches that Thursday asks which, and removes nothing', async () => {
    await fresh([
      ...threeLunches(),
      lunch('thu-late', THU, { startMin: 19 * 60, endMin: 19 * 60 + 45 }),
    ])
    await say("remove thursday's lunch")
    await settle()
    expect(lunchIds()).toEqual(['thu', 'thu-late', 'tue', 'wed'])
    const ask = chipMsgs()
    expect(ask).toHaveLength(1)
    // only Thursday's two are offered — the other days' Lunches never appear
    expect(ask[0].body).toMatch(/^2 "lunch" blocks ahead/)
  })

  it('"remove the lunch next thursday at 12:00" finds the title and asks with day chips', async () => {
    await fresh(threeLunches())
    await say('remove the lunch next thursday at 12:00')
    await settle()
    expect(lunchIds()).toEqual(['thu', 'tue', 'wed']) // unpinned: nothing goes before a pick
    const ask = chipMsgs()
    expect(ask).toHaveLength(1)
    expect(ask[0].choices!.map((c) => c.label)).toEqual([
      'today 12:00',
      'tomorrow 12:00',
      'thursday 12:00',
      'all of them',
    ])
  })
})
