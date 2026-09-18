/* The store-test harness, in one place. Fifty-five test files carry a copy of
   this, each spending 170–275 lines before its first `describe`, and pruning
   those copies down to what a new file actually uses has cost this crew four
   cycles: unused imports and helpers failing tsc seven minutes into a chain
   (twice), a regex prune that swallowed a neighbouring `beforeEach`, and a
   leftover bare `JSON.stringify(...)` at module scope that RAN AT IMPORT and
   passed tsc, eslint and prettier because a bare call is not an "unused
   expression". The cause is copying; this removes the cause.

   WHY THE `vi.mock` CALLS STAY IN THE TEST FILE. Vitest hoists `vi.mock` above
   the imports of the file that CALLS it, so a mock registered inside a shared
   module would race the test file's own `import { useMew } from '../store'`.
   Keeping the five calls in each file is five lines that are always identical
   and always correct; their FACTORIES come from here, so the ~150 lines of fake
   surface behind them do not. Each call wraps its factory in an arrow, for the
   reason spelled out below — that arrow is not style.

   Usage, the whole preamble a new store test needs:

     import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
     import { fakeDb, storageMock, desktopMock, notifyMock, brainMock,
              aiAdapterMock, scriptedModel, freshStore, settle } from './storeHarness'

     vi.mock('../../adapters/storage', () => storageMock())
     vi.mock('../../adapters/desktop', () => desktopMock())
     vi.mock('../../adapters/notify', () => notifyMock())
     vi.mock('../../adapters/brain/gbrainHttp', () => brainMock())
     vi.mock('../../adapters/model/aiAdapter', () => aiAdapterMock())

     import { useMew } from '../store'

   THE ARROW IS LOAD-BEARING. `vi.mock('…', storageMock)` — passing the imported
   binding directly — throws `Cannot access '__vi_import_0__' before
   initialization`, because hoisting evaluates the ARGUMENT above the import that
   defines it. Wrapping it in `() => storageMock()` defers the read to when the
   mocked module is first imported, which is after every import has run. I wrote
   the wrong form first and the suite told me immediately, which is the good
   version of this mistake.

   Nothing here is vitest-global-dependent, so a file can still keep its own
   fixtures, its own clock and its own `beforeEach` — this replaces the copied
   plumbing, not the test's own setup. */

import { chatOrder } from '../../adapters/storage-port'
import { dayKey } from '../../domain/time'
import type { Block, ChatMessage, Settings } from '../../domain/types'
import type { ToolExecutor } from '../../adapters/model/types'

/* ── the in-memory database every store test writes through ────────── */

export const fakeDb = {
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

/* ── the five adapter factories, byte-for-byte what the copies carry ── */

export const storageMock = () => ({
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
})

export const desktopMock = () => ({
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
})

export const notifyMock = () => {
  const stub = () => ({ mirror: () => {} })
  return { createNotifier: stub, createBrowserNotifier: stub }
}

export const brainMock = () => ({
  createGbrainHttp: () => ({
    ingest: async () => {},
    recall: async () => [],
    health: async () => false,
    listPrefs: async () => [],
    links: async () => [],
  }),
})

/* A scripted local model. Provider 'ollama' (modelLocation:'local') runs the
   keyed path and hands the turn the REAL executor; any other provider throws
   offline so the keyless floor answers. Nothing touches the network. */
export const scriptedModel = {
  chunks: [] as string[],
  midTurn: null as null | ((exec: ToolExecutor) => void),
  ctxToday: null as string | null,
  reset() {
    this.chunks = []
    this.midTurn = null
    this.ctxToday = null
  },
}

export const aiAdapterMock = () => ({
  createAiAdapter: (spec: { provider: string }) => ({
    id: spec.provider,
    async *converse(_thread: unknown, ctx: { todayKey: string }, exec: ToolExecutor) {
      if (spec.provider !== 'ollama') throw Object.assign(new Error('offline'), { statusCode: 503 })
      scriptedModel.ctxToday = ctx.todayKey
      const [first, ...rest] = scriptedModel.chunks
      if (first) yield first
      scriptedModel.midTurn?.(exec)
      for (const c of rest) yield c
    },
  }),
})

/* ── what a test does with the store, rather than to the adapters ──── */

/** One store, hydrated from exactly `blocks` at exactly `at`. `settings` patches
    the pristine defaults (e.g. `{ modelLocation: 'local' }` for the keyed path,
    `{ sustenance: 'off' }` when seeded meals would clutter the fixture). The
    store module is passed in because the test file owns the import order that
    makes its own `vi.mock` calls land first. */
export async function freshStore(
  useMew: {
    getState: () => {
      hydrate: () => Promise<void>
      settings: Settings
    }
    setState: (s: unknown, replace: true) => void
  },
  opts: {
    at: Date
    blocks?: Block[]
    memory?: { id: string }[]
    settings?: Partial<Settings>
    pristine: { settings: Settings }
  }
): Promise<void> {
  const { at, blocks = [], memory = [], settings = {}, pristine } = opts
  fakeDb.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  memory.forEach((e) => fakeDb.memory.set(e.id, e))
  fakeDb.settings = { ...pristine.settings, ...settings }
  /* the PRODUCT's dayKey, not a copy of it (#169 review). The first draft
     inlined the same template string — agreeing today and bound to nothing, so a
     timezone fix in domain/time would leave this harness minting the old string
     and 55 migrated tests would set lastTickDay to a value the product never
     produces: green tests describing a world that no longer exists. A module
     written to remove a copy shipping a copy is the same argument turned on
     itself, and the copies it replaces all import this function. */
  useMew.setState(
    { ...pristine, lastTickDay: dayKey(at), nowMs: at.getTime(), lastActivityMs: at.getTime() },
    true
  )
  await useMew.getState().hydrate()
}

/** Let the store's queued work land: a microtask, the 1ms timer the turn uses,
    then another microtask. Every copy of this in the tree is identical. */
export async function settle(advance: (ms: number) => void): Promise<void> {
  await Promise.resolve()
  advance(1)
  await Promise.resolve()
}
