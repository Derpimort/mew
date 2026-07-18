/* Surgical single-block edits + propose-delete-done (#334), through the REAL
   store. Replays the live transcript's failures as pins: a rename lands on the
   EXACT name+time block (not a fuzzy-guessed neighbor), an ambiguous bare name
   asks with chips instead of guessing, a retime that would overlap offers to
   drift the flexible neighbor rather than silently overlapping, and a DONE block
   is no longer walled off — an explicit delete proposes a one-tap confirm that
   removes the block AND its completion (undoable), while clear_blocks still
   skips mews. Adapters faked at their seams (the dayload/rescue harness); the
   undo pin rides a scripted local turn (the scenarios harness). No jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, MemoryEvent, Settings } from '../../domain/types'
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

vi.mock('../../adapters/brain/gbrainHttp', () => ({
  createGbrainHttp: () => ({
    ingest: async () => {},
    recall: async () => [],
    health: async () => false,
    listPrefs: async () => [],
    links: async () => [],
  }),
}))

/* a scripted local model (scenarios harness) — the undo pin needs a keyed turn
   that fires exec.undoLast(); keyless say() has no undo. Provider 'ollama'
   (modelLocation:'local') runs midTurn; nothing else touches the network. */
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

/* ── harness ──────────────────────────────────────────────────────── */

const pristine = useMew.getState()
const TUE = (h: number, m = 0) => new Date(2026, 5, 9, h, m) // Tuesday, June 9
const TODAY = '2026-06-09'

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Release',
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
const byId = (id: string) => blocks().find((b) => b.id === id)
const nudge = (type: string) => chat().find((m) => m.role === 'nudge' && m.nudgeType === type)
const say = (text: string) => useMew.getState().speak(text)
/* flush both the microtask chain (chips post in speak's finally) and the
   setTimeout(0) side-offers (clear surfaces its kept mews out-of-turn) */
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

/* ── the transcript, replayed ─────────────────────────────────────── */

describe('surgical rename by name + time (#334, AC1)', () => {
  it('renames the EXACT (name+time) block, leaving its same-named neighbor alone', async () => {
    const early = block({
      id: 'early',
      title: 'Release',
      startMin: 19 * 60 + 45,
      endMin: 20 * 60 + 45,
    })
    const late = block({
      id: 'late',
      title: 'Release',
      startMin: 21 * 60 + 30,
      endMin: 22 * 60 + 30,
    })
    await fresh([early, late])

    await say('rename release at 19:45 to v1.2-rc')

    expect(byId('early')!.title).toBe('v1.2-rc') // the 19:45 one, exactly
    expect(byId('late')!.title).toBe('Release') // the 21:30 neighbor untouched
    // a pure rename keeps the span and never invents an overlap warning
    expect(byId('early')!.startMin).toBe(19 * 60 + 45)
    expect(byId('early')!.endMin).toBe(20 * 60 + 45)
    const reply = chat().findLast((m) => m.role === 'mew')!
    expect(reply.body).not.toMatch(/overlaps/i)
  })
})

describe('ambiguous bare name asks, never guesses (#334, AC2)', () => {
  it('a rename with no time posts name+time chips and changes nothing', async () => {
    const early = block({
      id: 'early',
      title: 'Release',
      startMin: 19 * 60 + 45,
      endMin: 20 * 60 + 45,
    })
    const late = block({
      id: 'late',
      title: 'Release',
      startMin: 21 * 60 + 30,
      endMin: 22 * 60 + 30,
    })
    await fresh([early, late])

    await say('rename release to v1.2-rc')
    await settle()

    const asked = chat().findLast((m) => (m.choices?.length ?? 0) > 0)!
    expect(asked).toBeDefined()
    // the chips name both by their times — the "check name AND timestamp" handle
    expect(asked.choices!.map((c) => c.label).join(' ')).toMatch(/19:45.*21:30|21:30.*19:45/)
    // nothing was renamed — no silent wrong pick
    expect(byId('early')!.title).toBe('Release')
    expect(byId('late')!.title).toBe('Release')
  })
})

describe('a retime that would overlap offers to drift the neighbor (#334, AC4)', () => {
  it('places the retime and names the flexible clash, without moving the neighbor', async () => {
    const a = block({ id: 'plan', title: 'Planning', startMin: 14 * 60, endMin: 15 * 60 })
    const b = block({ id: 'write', title: 'Writing', startMin: 15 * 60, endMin: 16 * 60 })
    await fresh([a, b])

    await say('planning should be 14:30-15:30')

    expect(byId('plan')!.startMin).toBe(14 * 60 + 30) // the ask is honored exactly
    expect(byId('write')!.startMin).toBe(15 * 60) // the neighbor did NOT move
    const reply = chat().findLast((m) => m.role === 'mew')!
    expect(reply.body).toMatch(/overlaps Writing/i)
    expect(reply.body).toMatch(/flexible/i) // it OFFERS to drift, doesn't do it unasked
  })
})

describe('done-block deletion = propose → confirm (#334 refinement, AC3)', () => {
  const doneBlock = () =>
    block({
      id: 'done1',
      title: 'Prod release',
      startMin: 18 * 60 + 15,
      endMin: 20 * 60,
      status: 'done',
      completedAt: TUE(20, 0).getTime(),
    })
  const doneEvent = (): MemoryEvent => ({
    id: 'ev1',
    ts: TUE(20, 0).getTime(),
    kind: 'completed',
    dayKey: TODAY,
    tag: 'work',
    plannedMin: 105, // 20:00 − 18:15
    title: 'Prod release',
    startMin: 18 * 60 + 15,
    endMin: 20 * 60,
  })

  it('an explicit delete of a done block PROPOSES a one-tap confirm — never refuses', async () => {
    await fresh([doneBlock()], [doneEvent()])
    await say('remove the prod release')
    await settle()

    const offer = nudge('remove-done')
    expect(offer).toBeDefined()
    expect(offer!.body).toMatch(/mew|done/i)
    expect(offer!.actions!.some((a) => a.id === 'rm-done:done1')).toBe(true)
    // the guard held the delete until the confirm — the block is still there
    expect(byId('done1')).toBeDefined()
    // and nothing said "protected" / "can't" — the cage is gone
    expect(offer!.body).not.toMatch(/protected|can't|cannot/i)
  })

  it('the confirm deletes the block AND its completion — never resurrects it open', async () => {
    await fresh([doneBlock()], [doneEvent()])
    await say('remove the prod release')
    await settle()

    const offer = nudge('remove-done')!
    useMew.getState().nudgeAction(offer.id, 'rm-done:done1')
    await settle()

    expect(byId('done1')).toBeUndefined() // gone — not lingering, not re-opened
    expect(blocks().some((b) => b.title === 'Prod release' && b.status === 'open')).toBe(false)
    expect(memory().some((e) => e.kind === 'completed' && e.title === 'Prod release')).toBe(false)
  })

  it('the block-card remove affordance shares the same confirm path', async () => {
    await fresh([doneBlock()], [doneEvent()])
    // the card confirmed already; removeBlock is the shared door
    useMew.getState().removeBlock('done1')
    await settle()

    expect(byId('done1')).toBeUndefined()
    expect(memory().some((e) => e.kind === 'completed' && e.title === 'Prod release')).toBe(false)
  })

  it('a confirmed done-block removal is undoable — block and mew come back', async () => {
    await fresh([doneBlock()], [doneEvent()], 'local')

    // propose via a keyed turn, then tap the confirm
    scriptedModel.midTurn = (exec) => exec.remove('prod release', {})
    await say('drop the prod release')
    await settle()
    const offer = nudge('remove-done')!
    useMew.getState().nudgeAction(offer.id, 'rm-done:done1')
    await settle()
    expect(byId('done1')).toBeUndefined()

    // "undo that" — a keyed turn that fires undo_last_action
    scriptedModel.midTurn = (exec) => exec.undoLast()
    await say('undo that')
    await settle()

    expect(byId('done1')).toBeDefined() // the block is back…
    expect(byId('done1')!.status).toBe('done') // …still a mew, not re-opened
    expect(memory().some((e) => e.kind === 'completed' && e.title === 'Prod release')).toBe(true)
    // and re-persisted, so the mew survives a reload (not just restored in state)
    expect(
      [...fakeDb.memory.values()].some(
        (e) =>
          (e as MemoryEvent).kind === 'completed' && (e as MemoryEvent).title === 'Prod release'
      )
    ).toBe(true)
  })
})

describe('clear_blocks still skips mews (#334, AC3 both ways)', () => {
  it('a scope clear removes open blocks, keeps the mew, and surfaces it as selectable', async () => {
    const open = block({ id: 'open1', title: 'Standup', startMin: 9 * 60, endMin: 9 * 60 + 30 })
    const done = block({
      id: 'done1',
      title: 'Deep work',
      startMin: 10 * 60,
      endMin: 12 * 60,
      status: 'done',
      completedAt: TUE(12, 0).getTime(),
    })
    await fresh([open, done])

    await say('clear today')
    await settle()

    expect(byId('open1')).toBeUndefined() // the broom swept the open block
    expect(byId('done1')).toBeDefined() // the mew stayed (silent-collateral guard)
    expect(byId('done1')!.status).toBe('done') // not re-opened
    // …but it's no longer walled off — surfaced as a selectable removal
    expect(nudge('remove-done')).toBeDefined()
  })
})
