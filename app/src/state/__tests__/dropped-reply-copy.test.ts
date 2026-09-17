/* A dropped model reply, as the owner reads it — through the REAL store and the
   REAL AI SDK, with only fetch stubbed. The server answers 200 and the
   connection breaks while the body streams; the SDK's wrap of that (a 2xx
   APICallError with the network error as its cause) must reach the rules floor
   as a named, kind line — never "couldn't reach the model" (it did reach it),
   and never "I retried" (nothing retries a started stream: see retry.ts). When
   text already streamed, the turn keeps it and says so instead. Adapters other
   than the model are faked at their seams like granular-ops.test.ts; no keys
   leave the box, no jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, Settings } from '../../domain/types'
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

import { useMew } from '../store'

/* ── the wire: a 200 that streams `chunks`, then loses its connection ── */

const modelCalls: string[] = []

function oaChunk(text: string) {
  return JSON.stringify({
    id: '1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'm',
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  })
}

/** every request answers 200 and drops mid-body — the browser's shape of a
    socket closing under a streaming read */
function dropEveryReply(chunks: string[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      modelCalls.push(String(url))
      const enc = new TextEncoder()
      let i = 0
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(c) {
            if (i < chunks.length) return c.enqueue(enc.encode(`data: ${oaChunk(chunks[i++])}\n\n`))
            if (chunks.length) await new Promise((r) => setTimeout(r, 50)) // let the text paint
            c.error(new TypeError('network error'))
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    })
  )
}

/* ── harness ──────────────────────────────────────────────────────── */

const pristine = useMew.getState()
const TUE = (h: number, m = 0) => new Date(2026, 5, 9, h, m) // Tuesday, June 9

async function fresh(over: Partial<Settings>) {
  fakeDb.reset()
  modelCalls.length = 0
  vi.setSystemTime(TUE(9, 40))
  useMew.setState(
    {
      ...pristine,
      lastTickDay: '2026-06-09',
      nowMs: TUE(9, 40).getTime(),
      lastActivityMs: TUE(9, 40).getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
  useMew.getState().updateSettings(over)
}

/** speak, riding out any SDK timers (smoothing, and a backoff if one ever ran) */
async function say(text: string) {
  const turn = useMew.getState().speak(text)
  await vi.advanceTimersByTimeAsync(30_000)
  await turn
}

const mewLines = () =>
  useMew
    .getState()
    .chat.filter((m) => m.role === 'mew')
    .map((m) => m.body)
const notes = () => mewLines().filter((b) => b.startsWith('('))

const DROPPED = '(the connection to the model hiccuped — I handled this one myself.)'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('a dropped reply reads as a hiccup, handled — never "unreachable", never a retry claim', () => {
  it('local (Ollama): the floor answers and the note names the dropped connection', async () => {
    await fresh({ modelLocation: 'local' })
    dropEveryReply()
    await say('hello pixie')
    expect(modelCalls.filter((u) => u.includes('11434'))).toHaveLength(1) // one request, no retry
    expect(notes()).toEqual([DROPPED])
    expect(notes().join()).not.toMatch(/I retried|couldn't reach|busy/)
    // graceful degradation: the rules floor still answered the turn
    expect(mewLines().some((b) => !b.startsWith('('))).toBe(true)
  })

  it('remote (Anthropic): the same line — a started stream is never retried on either side', async () => {
    await fresh({ modelLocation: 'remote', anthropicKey: 'sk-ant-test' })
    dropEveryReply()
    await say('hello pixie')

    expect(modelCalls.filter((u) => u.includes('api.anthropic.com'))).toHaveLength(1)
    expect(notes()).toEqual([DROPPED])
  })

  it('text that streamed before the drop stays, and the turn says everything above went through', async () => {
    await fresh({ modelLocation: 'local' })
    dropEveryReply(['all ', 'set. '])
    await say('hello pixie')

    expect(mewLines()).toContain('all set. ') // what streamed is kept, as it arrived
    expect(notes()).toEqual([
      '(The connection hiccuped mid-thought — everything above did go through.)',
    ])
  })
})
