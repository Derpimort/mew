/* The Dexie paging seam (#250 phase 2) — proven against a REAL IndexedDB
   implementation (fake-indexeddb), because the seam IS Dexie's index
   semantics: `orderBy('ts').reverse().limit(n)` for the boot window and a
   `belowOrEqual + filter` walk for the (ts, id) cursor. A pure re-statement
   of the queries would prove nothing; this suite proves the queries. */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { CHAT_BOOT_PAGE, createDexieStorage, type StoragePort } from '../storage'
import type { ChatMessage } from '../../domain/types'

const M = (id: string, ts: number): ChatMessage => ({ id, role: 'user', body: `body ${id}`, ts })

/** ids sort lexicographically — zero-pad so id order matches numeric order */
const mid = (i: number) => `m${String(i).padStart(4, '0')}`

let store: StoragePort

beforeEach(async () => {
  /* one shared fake registry per process — wipe the 'mew' database so every
     test starts from an empty table, exactly as wipe() promises */
  store = createDexieStorage()
  await store.wipe()
})

describe('boot window (#250 phase 2): load() hydrates the newest page only', () => {
  it('a big profile loads exactly CHAT_BOOT_PAGE messages — the newest, ascending', async () => {
    const total = CHAT_BOOT_PAGE + 60
    await store.putChat(Array.from({ length: total }, (_, i) => M(mid(i), 1_000 + i)))
    const { chat } = await store.load()
    expect(chat).toHaveLength(CHAT_BOOT_PAGE)
    expect(chat[0].id).toBe(mid(60)) // the oldest 60 wait in the table
    expect(chat[chat.length - 1].id).toBe(mid(total - 1))
    /* ascending (ts, id) — the exact order the log renders and pages by */
    for (let i = 1; i < chat.length; i++) expect(chat[i].ts).toBeGreaterThanOrEqual(chat[i - 1].ts)
    expect(await store.countChat()).toBe(total)
  })

  it('a small profile loads whole — the window is a ceiling, not a slicer', async () => {
    await store.putChat([M('a', 1), M('b', 2)])
    const { chat } = await store.load()
    expect(chat.map((m) => m.id)).toEqual(['a', 'b'])
    expect(await store.countChat()).toBe(2)
  })
})

describe('the (ts, id) cursor: loadChatBefore pages without a skip or a double', () => {
  it('pages strictly before the cursor, newest slice first, ascending inside the page', async () => {
    await store.putChat(Array.from({ length: 10 }, (_, i) => M(mid(i), 1_000 + i)))
    const page = await store.loadChatBefore(1_007, mid(7), 3)
    expect(page.map((m) => m.id)).toEqual([mid(4), mid(5), mid(6)])
    const next = await store.loadChatBefore(page[0].ts, page[0].id, 10)
    expect(next.map((m) => m.id)).toEqual([mid(0), mid(1), mid(2), mid(3)])
    expect(await store.loadChatBefore(1_000, mid(0), 10)).toEqual([])
  })

  it('a burst of same-millisecond messages splits exactly on the id tiebreak', async () => {
    await store.putChat([M('a', 1), M('b', 2), M('c', 2), M('d', 2), M('e', 3)])
    expect((await store.loadChatBefore(2, 'd', 2)).map((m) => m.id)).toEqual(['b', 'c'])
    expect((await store.loadChatBefore(2, 'b', 5)).map((m) => m.id)).toEqual(['a'])
  })

  it('window + repeated pages reconstruct the whole table exactly — even when EVERY row shares one ts', async () => {
    const total = CHAT_BOOT_PAGE + 37 // ties across the window boundary AND page boundaries
    await store.putChat(Array.from({ length: total }, (_, i) => M(mid(i), 5_000)))
    const { chat } = await store.load()
    expect(chat).toHaveLength(CHAT_BOOT_PAGE)
    const walked: ChatMessage[] = [...chat]
    for (;;) {
      const head = walked[0]
      const page = await store.loadChatBefore(head.ts, head.id, 50)
      if (!page.length) break
      walked.unshift(...page)
    }
    expect(walked.map((m) => m.id)).toEqual(Array.from({ length: total }, (_, i) => mid(i)))
  })
})

describe('condensation reads and prunes through the table, not the window', () => {
  it('loadChatOlderThan is strictly below the horizon', async () => {
    await store.putChat([M('old', 10), M('edge', 20), M('new', 30)])
    expect((await store.loadChatOlderThan(20)).map((m) => m.id)).toEqual(['old'])
    expect(await store.loadChatOlderThan(10)).toEqual([])
  })

  it('deleteChat prunes only the named ids', async () => {
    await store.putChat([M('a', 1), M('b', 2), M('c', 3)])
    await store.deleteChat(['a', 'c'])
    expect((await store.load()).chat.map((m) => m.id)).toEqual(['b'])
  })
})

describe('export completeness: a backup is never windowed', () => {
  it('exportJson carries every message the table holds, boot window notwithstanding', async () => {
    const total = CHAT_BOOT_PAGE + 25
    await store.putChat(Array.from({ length: total }, (_, i) => M(mid(i), 1_000 + i)))
    expect((await store.load()).chat).toHaveLength(CHAT_BOOT_PAGE) // the window…
    const backup = JSON.parse(await store.exportJson()) as { chat: ChatMessage[] }
    expect(backup.chat).toHaveLength(total) // …never leaks into the backup
    expect(backup.chat[0].id).toBe(mid(0)) // the very first message travels
  })

  it('export → import round-trips the full history; the next boot re-windows it', async () => {
    const total = CHAT_BOOT_PAGE + 10
    await store.putChat(Array.from({ length: total }, (_, i) => M(mid(i), 1_000 + i)))
    const backup = await store.exportJson()
    await store.wipe()
    await store.importJson(backup)
    expect(await store.countChat()).toBe(total) // everything came back…
    expect((await store.load()).chat).toHaveLength(CHAT_BOOT_PAGE) // …boot stays flat
  })
})
