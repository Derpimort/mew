/* #49 — a user-granted overlap. When the owner says in this turn that sharing
   time is fine ("it's fine to overlap gaming"), a placement or move carries
   allowOverlap: their FLEXIBLE block stays put and the receipt names the shared
   time (no drift, no offer). The grant never covers a fixed-time or [calendar]
   block — those still refuse, with the reason named — and with no grant every
   path is exactly as before. Through the REAL store with the granular-ops
   harness (a scripted local model firing the executor), plus the tool dispatch. */

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

/* a scripted local model — the recurrence-on-duplicate pin needs a keyed turn
   that fires exec.duplicate() with an rrule (keyless carries no recurrence).
   Provider 'ollama' (modelLocation:'local') runs midTurn; nothing touches net. */
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

async function fresh(
  blocks: Block[],
  memory: MemoryEvent[] = [],
  location: 'remote' | 'local' = 'remote'
) {
  fakeDb.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  memory.forEach((e) => fakeDb.memory.set(e.id, e))
  /* a connected calendar (id 'c') so external blocks survive hydrate's
     adopt-orphaned-externals sweep; 'import' kind ⇒ no background live sync. */
  fakeDb.settings = {
    ...pristine.settings,
    modelLocation: location,
    calendars: [
      { id: 'c', name: 'Work', who: 'me', provider: 'google', kind: 'import', readOnly: true },
    ],
  }
  vi.setSystemTime(TUE(8, 30))
  useMew.setState(
    {
      ...pristine,
      lastTickDay: TODAY,
      nowMs: TUE(8, 30).getTime(),
      lastActivityMs: TUE(8, 30).getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
}

const chat = () => useMew.getState().chat
const blocks = () => useMew.getState().blocks
const byId = (id: string) => blocks().find((b) => b.id === id)
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

import { runTool } from '../../adapters/model/tools'

const chipMsgs = () => chat().filter((m) => (m.choices?.length ?? 0) > 0)

const flexible = (id: string, title: string, startMin: number, endMin: number) =>
  block({ id, title, tag: 'private', startMin, endMin, protected: false })
const GAMING = () => flexible('gaming', 'Gaming', 14 * 60, 16 * 60)
const EMAIL_AT_2 = {
  title: 'email sweep',
  tag: 'work' as const,
  dayOffset: 0,
  startMin: 14 * 60,
  durationMin: 60,
}

async function planKeyed(blocksIn: Block[], place: Record<string, unknown>) {
  await fresh(blocksIn, [], 'local')
  let result = ''
  scriptedModel.midTurn = (exec) => {
    result = exec.plan([place as never], [])
  }
  await say('put the email sweep at 2')
  await settle()
  return result
}
const email = () => blocks().find((b) => b.title.startsWith('email sweep'))

describe('#49 — a granted overlap onto a flexible block', () => {
  it('lands exactly as asked, the flexible block stays put, and the receipt names the shared time', async () => {
    const result = await planKeyed([GAMING()], { ...EMAIL_AT_2, allowOverlap: true })
    expect(email()).toMatchObject({ startMin: 14 * 60, endMin: 15 * 60 })
    expect(byId('gaming')).toMatchObject({ startMin: 14 * 60, endMin: 16 * 60 }) // never drifted
    expect(result).toContain('it shares time with Gaming 14:00–16:00, as you said')
    expect(result).not.toMatch(/offer to drift|moved Gaming|on screen/)
    expect(chipMsgs()).toHaveLength(0) // no drift choices either
  })

  it('without the grant, the same placement is exactly today: the flexible block drifts clear', async () => {
    const result = await planKeyed([GAMING()], EMAIL_AT_2)
    expect(result).not.toContain('as you said')
    expect(byId('gaming')!.startMin).not.toBe(14 * 60) // #324: work drifts its own flexible block
  })

  it('a non-work placement with the grant names the shared time instead of offering to drift', async () => {
    const result = await planKeyed([GAMING()], {
      ...EMAIL_AT_2,
      title: 'call mum',
      tag: 'private',
      allowOverlap: true,
    })
    expect(result).toContain('it shares time with Gaming 14:00–16:00, as you said')
    expect(result).not.toContain('offer to drift')
  })
})

describe('#49 — the grant never covers a fixed or calendar block', () => {
  it('a fixed block (a call) refuses: nothing placed, the reason named', async () => {
    const result = await planKeyed(
      [block({ id: 'call', title: 'Client call', startMin: 14 * 60, endMin: 15 * 60 })],
      { ...EMAIL_AT_2, allowOverlap: true }
    )
    expect(email()).toBeUndefined()
    expect(result).toContain(
      '"email sweep" stays unplaced at 14:00: it would sit over Client call 14:00–15:00 (fixed)'
    )
    expect(result).toContain('never over')
  })

  it('a calendar event refuses the same way, named as from your calendar', async () => {
    const result = await planKeyed(
      [
        block({
          id: 'mtg',
          title: 'Quarterly planning',
          startMin: 14 * 60,
          endMin: 15 * 60,
          external: { calId: 'c', eventId: 'e' },
        }),
      ],
      { ...EMAIL_AT_2, allowOverlap: true }
    )
    expect(email()).toBeUndefined()
    expect(result).toContain('Quarterly planning 14:00–15:00 (from your calendar)')
    expect(byId('mtg')).toMatchObject({ startMin: 14 * 60 }) // the event is untouched
  })

  it('flexible AND fixed under the same span: refused — the grant is all or nothing for a landing', async () => {
    const result = await planKeyed(
      [
        GAMING(),
        block({ id: 'call', title: 'Client call', startMin: 14 * 60 + 30, endMin: 15 * 60 }),
      ],
      { ...EMAIL_AT_2, allowOverlap: true }
    )
    expect(email()).toBeUndefined()
    expect(result).toContain('Client call 14:30–15:00 (fixed)')
    expect(byId('gaming')).toMatchObject({ startMin: 14 * 60 })
  })
})

describe('#49 — plan_blocks re-placing an EXISTING block carries the grant', () => {
  const EMAIL_AT_10 = () =>
    block({
      id: 'email',
      title: 'email sweep',
      startMin: 10 * 60,
      endMin: 11 * 60,
      protected: false,
    })

  it('onto a flexible block: re-placed as asked, the flexible block stays, the time is named', async () => {
    const result = await planKeyed([GAMING(), EMAIL_AT_10()], { ...EMAIL_AT_2, allowOverlap: true })
    expect(byId('email')).toMatchObject({ startMin: 14 * 60 })
    expect(byId('gaming')).toMatchObject({ startMin: 14 * 60, endMin: 16 * 60 })
    expect(result).toContain('it shares time with Gaming 14:00–16:00, as you said')
  })

  it('onto a fixed block: refused, and the existing block stays where it was', async () => {
    const result = await planKeyed(
      [
        EMAIL_AT_10(),
        block({ id: 'call', title: 'Client call', startMin: 14 * 60, endMin: 15 * 60 }),
      ],
      { ...EMAIL_AT_2, allowOverlap: true }
    )
    expect(byId('email')).toMatchObject({ startMin: 10 * 60 })
    expect(result).toContain('stays unplaced at 14:00')
  })
})

describe('#49 — move_task carries the grant too', () => {
  const EMAIL_AT_10 = () =>
    block({
      id: 'email',
      title: 'email sweep',
      startMin: 10 * 60,
      endMin: 11 * 60,
      protected: false,
    })

  it('a granted move onto a flexible block keeps it put and names the shared time', async () => {
    await fresh([GAMING(), EMAIL_AT_10()], [], 'local')
    let result = ''
    scriptedModel.midTurn = (exec) => {
      result = exec.move({
        query: 'email sweep',
        toDayOffset: 0,
        toStartMin: 14 * 60,
        allowOverlap: true,
      })
    }
    await say('move the email sweep to 2, fine to overlap gaming')
    await settle()
    expect(byId('email')).toMatchObject({ startMin: 14 * 60 })
    expect(byId('gaming')).toMatchObject({ startMin: 14 * 60, endMin: 16 * 60 })
    expect(result).toContain('it shares time with Gaming 14:00–16:00, as you said')
  })

  it('a granted move onto a fixed block refuses and changes nothing', async () => {
    await fresh(
      [
        EMAIL_AT_10(),
        block({ id: 'call', title: 'Client call', startMin: 14 * 60, endMin: 15 * 60 }),
      ],
      [],
      'local'
    )
    let result = ''
    scriptedModel.midTurn = (exec) => {
      result = exec.move({
        query: 'email sweep',
        toDayOffset: 0,
        toStartMin: 14 * 60,
        allowOverlap: true,
      })
    }
    await say('move the email sweep to 2')
    await settle()
    expect(byId('email')).toMatchObject({ startMin: 10 * 60 }) // never moved
    expect(result).toContain('stays unplaced at 14:00')
  })
})

describe('#49 — the tools grant only on an explicit true', () => {
  it('plan_blocks and move_task pass allowOverlap:true through, and nothing else counts', async () => {
    const calls: unknown[][] = []
    const exec = {
      plan: (places: unknown[]) => {
        calls.push(['plan', places])
        return 'ok'
      },
      move: (...args: unknown[]) => {
        calls.push(['move', args])
        return 'ok'
      },
    } as unknown as import('../../adapters/model').ToolExecutor
    await runTool('plan_blocks', { places: [{ ...EMAIL_AT_2, allowOverlap: true }] }, exec)
    await runTool('plan_blocks', { places: [{ ...EMAIL_AT_2, allowOverlap: 'true' }] }, exec)
    await runTool('move_task', { query: 'email', toStartMin: 840, allowOverlap: true }, exec)
    await runTool('move_task', { query: 'email', toStartMin: 840, allowOverlap: 1 }, exec)
    const places = calls
      .filter((c) => c[0] === 'plan')
      .map((c) => (c[1] as { allowOverlap?: boolean }[])[0])
    expect(places.map((p) => p.allowOverlap)).toEqual([true, undefined])
    /* reads the field off move's single named object (#165) where it used to read
       the sixth positional argument. The VALUES asserted are unchanged — granted
       on an explicit true, absent otherwise — only the way this spy reaches them
       moved, because the shape it was reading is what that refactor replaced. */
    const moves = calls
      .filter((c) => c[0] === 'move')
      .map((c) => (c[1] as [{ allowOverlap?: boolean }])[0].allowOverlap)
    expect(moves).toEqual([true, undefined]) // no grant → no allowOverlap field at all
  })
})
