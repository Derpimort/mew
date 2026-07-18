/* Recurring-edit scope (#343), through the REAL store. Every calendar app asks
   scope when you touch a repeating event — just this one / this & following /
   the whole series. MEW handled the ends (a single delete drops one occurrence;
   all:true clears the series); this pins the middle (split from a date forward)
   and the offer itself: an ambiguous edit/delete on a series block asks with the
   three chips ONCE, an explicit scope word skips the prompt, `this`/`following`/
   `series` each hit the right set, a DONE occurrence still routes through #334's
   propose→confirm, and the keyless floor honors scope words with the same chip
   offer when ambiguous. Adapters faked at their seams; keyless turns ride the
   503 fallback, keyed turns ride the scripted local model. No jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, MemoryEvent, Settings } from '../../domain/types'
import { CHOICES_POSTED } from '../../adapters/model/types'
import { chatOrder } from '../../adapters/storage-port'

/* ── fakes (the surgical-edits harness) ───────────────────────────────── */

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
  chunks: [] as string[],
  midTurn: null as null | ((exec: import('../../adapters/model').ToolExecutor) => void),
  reset() {
    this.chunks = []
    this.midTurn = null
  },
}
vi.mock('../../adapters/model/aiAdapter', () => ({
  createAiAdapter: (spec: { provider: string }) => ({
    id: spec.provider,
    async *converse(
      _thread: unknown,
      _ctx: unknown,
      exec: import('../../adapters/model').ToolExecutor
    ) {
      if (spec.provider !== 'ollama') throw Object.assign(new Error('offline'), { statusCode: 503 })
      const [first, ...rest] = scriptedModel.chunks
      if (first) yield first
      scriptedModel.midTurn?.(exec)
      for (const c of rest) yield c
    },
  }),
}))

import { useMew } from '../store'

/* ── harness ──────────────────────────────────────────────────────────── */

const pristine = useMew.getState()
const TUE = (h: number, m = 0) => new Date(2026, 5, 9, h, m) // Tuesday, June 9
const TODAY = '2026-06-09'
const WEEKLY_TU = { freq: 'WEEKLY' as const, interval: 1, byday: ['TU' as const] }

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Standup',
    tag: 'work',
    dayKey: TODAY,
    startMin: 9 * 60,
    endMin: 9 * 60 + 30,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

/** A four-Tuesday weekly Standup series, all open, all linked by 's1' — the
    shape a "gym every week" plan expands to. Anchored today so a bare name
    resolves to the first occurrence. */
function standupSeries(): Block[] {
  return ['2026-06-09', '2026-06-16', '2026-06-23', '2026-06-30'].map((dayKey, i) =>
    block({ id: `s${i}`, dayKey, recurringBlockId: 's1', rrule: WEEKLY_TU })
  )
}

async function fresh(
  blocks: Block[],
  memory: MemoryEvent[] = [],
  location: 'remote' | 'local' = 'remote'
) {
  fakeDb.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  memory.forEach((e) => fakeDb.memory.set(e.id, e))
  fakeDb.settings = { ...pristine.settings, modelLocation: location }
  vi.setSystemTime(TUE(16, 0))
  useMew.setState(
    {
      ...pristine,
      lastTickDay: TODAY,
      nowMs: TUE(16, 0).getTime(),
      lastActivityMs: TUE(16, 0).getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
}

const chat = () => useMew.getState().chat
const blocks = () => useMew.getState().blocks
const memory = () => useMew.getState().memory
const standups = () => blocks().filter((b) => b.title === 'Standup')
const byId = (id: string) => blocks().find((b) => b.id === id)
const nudge = (type: string) => chat().find((m) => m.role === 'nudge' && m.nudgeType === type)
const choicesMsg = () => chat().findLast((m) => (m.choices?.length ?? 0) > 0)
const say = (text: string) => useMew.getState().speak(text)
const settle = async () => {
  await Promise.resolve()
  vi.advanceTimersByTime(1)
  await Promise.resolve()
}
/** Post the scope offer, then click one of its chips (the pick rides an ordinary
    user turn — tools stay the only mutation path). */
async function pick(label: RegExp) {
  const msg = choicesMsg()!
  const choice = msg.choices!.find((c) => label.test(c.label))!
  await useMew.getState().pickChoice(msg.id, choice.id)
  await settle()
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  scriptedModel.reset()
})

/* ── the offer: ambiguous edit/delete asks once ───────────────────────── */

describe('an ambiguous edit/delete on a series block offers three chips once (AC2)', () => {
  it('a bare delete of a repeating block posts this / following / series chips and drops nothing', async () => {
    await fresh(standupSeries())
    await say('remove the standup')
    await settle()

    const msg = choicesMsg()!
    expect(msg).toBeDefined()
    const labels = msg.choices!.map((c) => c.label.toLowerCase()).join(' | ')
    expect(labels).toMatch(/just this one/)
    expect(labels).toMatch(/after|following/)
    expect(labels).toMatch(/whole series/)
    // exactly one offer, and nothing removed yet — the chips ARE the reply
    expect(chat().filter((m) => (m.choices?.length ?? 0) > 0)).toHaveLength(1)
    expect(standups()).toHaveLength(4)
  })

  it('a bare edit of a repeating block posts the same three chips and changes nothing', async () => {
    await fresh(standupSeries())
    await say('standup should be 10:00-10:30')
    await settle()

    const msg = choicesMsg()!
    expect(msg.choices).toHaveLength(3)
    expect(standups().every((b) => b.startMin === 9 * 60)).toBe(true) // untouched
  })

  it('a keyed model that omits scope on a series edit gets CHOICES_POSTED back', async () => {
    await fresh(standupSeries(), [], 'local')
    let toolResult = ''
    scriptedModel.chunks = ['One sec…']
    scriptedModel.midTurn = (exec) => {
      toolResult = exec.edit('standup', { startMin: 10 * 60, endMin: 10 * 60 + 30 }, undefined)
    }
    await say('shift my standup to 10')
    await settle()

    expect(toolResult.startsWith(CHOICES_POSTED)).toBe(true)
    expect(choicesMsg()!.choices).toHaveLength(3)
    expect(standups().every((b) => b.startMin === 9 * 60)).toBe(true)
  })

  it('a one-off block never triggers the scope prompt — it edits/deletes as today', async () => {
    await fresh([block({ id: 'solo', title: 'Dentist', recurringBlockId: undefined })])
    await say('remove the dentist')
    await settle()

    expect(choicesMsg()).toBeUndefined() // no series, no scope question
    expect(byId('solo')).toBeUndefined() // dropped straight away
  })
})

/* ── this / following / series each hit the right set (AC3) ────────────── */

describe('the three scopes reach exactly the right occurrences (AC3)', () => {
  it("'just this one' delete drops only the next occurrence; the series lives on", async () => {
    await fresh(standupSeries())
    await say('remove the standup')
    await settle()
    await pick(/just this one/)

    const left = standups()
    expect(left).toHaveLength(3)
    expect(left.some((b) => b.dayKey === '2026-06-09')).toBe(false) // the next one is gone
    expect(left.every((b) => b.recurringBlockId === 's1')).toBe(true) // the rest keep the link
  })

  it("'the whole series' delete clears every linked occurrence", async () => {
    await fresh(standupSeries())
    await say('remove the standup')
    await settle()
    await pick(/whole series/)

    expect(standups()).toHaveLength(0)
    expect(blocks().some((b) => b.recurringBlockId === 's1')).toBe(false)
  })

  it("'this & the ones after' delete splits: the tail comes off, earlier ones stay", async () => {
    // the first session is already done (a real head), so the split leaves it be
    const done = block({
      id: 'done0',
      dayKey: '2026-06-02',
      status: 'done',
      completedAt: new Date(2026, 5, 2, 9, 30).getTime(),
      recurringBlockId: 's1',
      rrule: WEEKLY_TU,
    })
    await fresh([done, ...standupSeries()])
    await say('remove the standup')
    await settle()
    await pick(/after/)

    expect(byId('done0')).toBeDefined() // the earlier (done) one stays
    expect(byId('done0')!.status).toBe('done')
    // every open occurrence from today forward is gone
    expect(standups().filter((b) => b.status === 'open')).toHaveLength(0)
  })

  it("'just this one' edit retimes only the next occurrence", async () => {
    await fresh(standupSeries())
    await say('standup should be 10:00-10:30')
    await settle()
    await pick(/just this one/)

    expect(byId('s0')!.startMin).toBe(10 * 60) // the next one moved
    expect(byId('s0')!.endMin).toBe(10 * 60 + 30)
    expect(byId('s1')!.startMin).toBe(9 * 60) // its siblings did NOT
    expect(standups().every((b) => b.recurringBlockId === 's1')).toBe(true) // no split
  })

  it("'the whole series' edit retimes every occurrence in place (same series id)", async () => {
    await fresh(standupSeries())
    await say('standup should be 10:00-10:30')
    await settle()
    await pick(/whole series/)

    expect(standups().every((b) => b.startMin === 10 * 60 && b.endMin === 10 * 60 + 30)).toBe(true)
    expect(standups().every((b) => b.recurringBlockId === 's1')).toBe(true) // edited in place
  })

  it("'this & the ones after' edit splits the series and retimes only the tail", async () => {
    const done = block({
      id: 'done0',
      dayKey: '2026-06-02',
      status: 'done',
      completedAt: new Date(2026, 5, 2, 9, 30).getTime(),
      recurringBlockId: 's1',
      rrule: WEEKLY_TU,
    })
    await fresh([done, ...standupSeries()])
    await say('standup should be 10:00-10:30')
    await settle()
    await pick(/after/)

    // the earlier (done) occurrence keeps its old shape AND its original series id
    expect(byId('done0')!.startMin).toBe(9 * 60)
    expect(byId('done0')!.recurringBlockId).toBe('s1')
    // the tail retimed and re-linked under a NEW series id (a real split)
    const tail = standups().filter((b) => b.status === 'open')
    expect(tail.every((b) => b.startMin === 10 * 60)).toBe(true)
    const tailIds = new Set(tail.map((b) => b.recurringBlockId))
    expect(tailIds.size).toBe(1)
    expect([...tailIds][0]).not.toBe('s1') // split off the old series
    // the old rule is bounded the day before the split
    expect(byId('done0')!.rrule?.until).toBe('2026-06-08')
  })
})

/* ── explicit scope skips the prompt (AC2), keyless + keyed ────────────── */

describe('an explicit scope in the ask applies directly — no chip prompt (AC2, AC5)', () => {
  it('keyless "remove all standup" clears the series with no question', async () => {
    await fresh(standupSeries())
    await say('remove all standup')
    await settle()

    expect(choicesMsg()).toBeUndefined()
    expect(standups()).toHaveLength(0)
  })

  it('keyless "just this one" honors the scope word and drops a single occurrence', async () => {
    await fresh(standupSeries())
    await say('remove the standup just this one')
    await settle()

    expect(choicesMsg()).toBeUndefined() // scope stated → no prompt
    expect(standups()).toHaveLength(3)
    expect(standups().some((b) => b.dayKey === '2026-06-09')).toBe(false)
  })

  it('keyless "across the whole series" retimes every occurrence with no question', async () => {
    await fresh(standupSeries())
    await say('standup should be 10:00-10:30 across the whole series')
    await settle()

    expect(choicesMsg()).toBeUndefined()
    expect(standups().every((b) => b.startMin === 10 * 60)).toBe(true)
  })

  it('a keyed model that passes scope:series deletes the whole set directly', async () => {
    await fresh(standupSeries(), [], 'local')
    scriptedModel.chunks = ['Cleared.']
    scriptedModel.midTurn = (exec) => exec.remove('standup', { scope: 'series' })
    await say('scrap every standup')
    await settle()

    expect(choicesMsg()).toBeUndefined()
    expect(standups()).toHaveLength(0)
  })
})

/* ── a DONE occurrence keeps the consent gate (AC4) ────────────────────── */

describe('removing a done occurrence still routes through propose → confirm (AC4)', () => {
  const doneOnly = () => [
    block({
      id: 'd0',
      dayKey: TODAY,
      status: 'done',
      completedAt: TUE(9, 30).getTime(),
      recurringBlockId: 's1',
      rrule: WEEKLY_TU,
    }),
    block({
      id: 'd1',
      dayKey: '2026-06-16',
      status: 'done',
      recurringBlockId: 's1',
      rrule: WEEKLY_TU,
    }),
  ]
  const doneEvent = (): MemoryEvent => ({
    id: 'ev0',
    ts: TUE(9, 30).getTime(),
    kind: 'completed',
    dayKey: TODAY,
    tag: 'work',
    plannedMin: 30,
    title: 'Standup',
    startMin: 9 * 60,
    endMin: 9 * 60 + 30,
  })

  it('proposes a one-tap confirm (not scope chips), and the block waits for the tap', async () => {
    await fresh(doneOnly(), [doneEvent()])
    await say('remove the standup')
    await settle()

    // the mew-consent gate, not the scope offer
    expect(nudge('remove-done')).toBeDefined()
    expect(choicesMsg()).toBeUndefined()
    expect(byId('d0')).toBeDefined() // held until the confirm — never silently deleted
  })

  it('the confirm removes the done block and its completion cleanly', async () => {
    await fresh(doneOnly(), [doneEvent()])
    await say('remove the standup')
    await settle()
    const offer = nudge('remove-done')!
    useMew.getState().nudgeAction(offer.id, 'rm-done:d0')
    await settle()

    expect(byId('d0')).toBeUndefined()
    expect(memory().some((e) => e.kind === 'completed' && e.title === 'Standup')).toBe(false)
  })
})
