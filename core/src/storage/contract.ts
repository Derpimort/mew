/* The StoragePort contract — runner-agnostic so the SAME spec proves both
   the SQLite impl (bun:test, here) and, later, the Dexie impl (vitest): parity
   by one shared suite, not two drifting ones (coding_principles §15/§16/§19).
   Storage treats entities as opaque JSON, so fixtures are cast minimally. */
import { CHAT_BOOT_PAGE } from '../../../app/src/adapters/storage-port'
import type { StoragePort } from '../../../app/src/adapters/storage-port'
import type { Block, Settings } from '../../../app/src/domain/types'
import type { SyncEntry } from '../../../app/src/adapters/calendar/types'

export interface TestHarness {
  test: (name: string, fn: () => void | Promise<void>) => void
  expect: (actual: unknown) => { toEqual(e: unknown): void; toBe(e: unknown): void }
}

const block = (id: string): Block => ({ id, title: id.toUpperCase() }) as unknown as Block
const settings = (keys: Partial<Settings>): Settings => keys as unknown as Settings
const sync = (id: string, calId: string): SyncEntry => ({ id, calId, blockId: `b-${id}` }) as unknown as SyncEntry

export function storageContract(makeStore: () => StoragePort, h: TestHarness): void {
  const { test, expect } = h

  test('round-trips blocks through load', async () => {
    const s = makeStore()
    await s.putBlocks([block('a'), block('b')])
    const out = await s.load()
    expect(out.blocks.map((b) => b.id).sort()).toEqual(['a', 'b'])
  })

  test('deleteBlocks removes only the named ids', async () => {
    const s = makeStore()
    await s.putBlocks([block('a'), block('b')])
    await s.deleteBlocks(['a'])
    expect((await s.load()).blocks.map((b) => b.id)).toEqual(['b'])
  })

  test('putSettings persists and load returns it', async () => {
    const s = makeStore()
    await s.putSettings(settings({ anthropicKey: 'sk-test', openaiKey: '', brainToken: '' }))
    expect((await s.load()).settings?.anthropicKey).toBe('sk-test')
  })

  test('exportJson strips API keys — keys never leave the device', async () => {
    const s = makeStore()
    await s.putSettings(settings({ anthropicKey: 'sk-secret', openaiKey: 'oa-secret', brainToken: 'br-secret' }))
    const json = await s.exportJson()
    expect(json.includes('sk-secret')).toBe(false)
    expect(json.includes('oa-secret')).toBe(false)
    expect(json.includes('br-secret')).toBe(false)
  })

  test("importJson keeps this device's keys — backups carry none", async () => {
    const s = makeStore()
    await s.putSettings(settings({ anthropicKey: 'device-key', openaiKey: '', brainToken: '' }))
    const backup = JSON.stringify({
      blocks: [block('x')],
      captures: [],
      chat: [],
      memory: [],
      settings: { anthropicKey: '', openaiKey: '', brainToken: '' },
    })
    await s.importJson(backup)
    const out = await s.load()
    expect(out.blocks.map((b) => b.id)).toEqual(['x']) // imported data replaced
    expect(out.settings?.anthropicKey).toBe('device-key') // device key survived
  })

  test('sync ledger: save, load, then delete by calendar', async () => {
    const s = makeStore()
    await s.saveSyncMap([sync('s1', 'cal-1'), sync('s2', 'cal-2')], [])
    expect((await s.loadSyncMap()).length).toBe(2)
    await s.deleteSyncForCalendar('cal-1')
    expect((await s.loadSyncMap()).map((e) => e.id)).toEqual(['s2'])
  })

  test('wipe clears everything', async () => {
    const s = makeStore()
    await s.putBlocks([block('a')])
    await s.wipe()
    expect((await s.load()).blocks).toEqual([])
  })

  test('getAuditLog returns an array (empty on a fresh store)', async () => {
    const s = makeStore()
    expect(await s.getAuditLog()).toEqual([])
  })

  /* ── chat paging (#250 phase 2): the boot window + the cursor seam ── */

  const chatMsg = (id: string, ts: number) =>
    ({ id, role: 'user', body: id, ts }) as unknown as import('../../../app/src/domain/types').ChatMessage

  test('load() hydrates only the newest CHAT_BOOT_PAGE chat messages, ascending; count sees the whole table', async () => {
    const s = makeStore()
    const total = CHAT_BOOT_PAGE + 25
    await s.putChat(Array.from({ length: total }, (_, i) => chatMsg(`m${String(i).padStart(4, '0')}`, 1000 + i)))
    const out = await s.load()
    expect(out.chat.length).toBe(CHAT_BOOT_PAGE)
    expect(out.chat[0].id).toBe('m0025') // the oldest 25 sit outside the window
    expect(out.chat[CHAT_BOOT_PAGE - 1].id).toBe(`m${String(total - 1).padStart(4, '0')}`)
    expect(await s.countChat()).toBe(total)
  })

  test('loadChatBefore pages strictly before the (ts, id) cursor — tied timestamps neither skip nor double', async () => {
    const s = makeStore()
    /* five rows share one millisecond: the cursor must split the tie by id */
    await s.putChat([chatMsg('a', 1), chatMsg('b', 2), chatMsg('c', 2), chatMsg('d', 2), chatMsg('e', 3)])
    const page = await s.loadChatBefore(2, 'd', 2)
    expect(page.map((m) => m.id)).toEqual(['b', 'c'])
    const rest = await s.loadChatBefore(page[0].ts, page[0].id, 10)
    expect(rest.map((m) => m.id)).toEqual(['a'])
    expect(await s.loadChatBefore(1, 'a', 10)).toEqual([])
  })

  test('loadChatOlderThan is strictly below the horizon; deleteChat prunes only the named ids', async () => {
    const s = makeStore()
    await s.putChat([chatMsg('old', 10), chatMsg('edge', 20), chatMsg('new', 30)])
    expect((await s.loadChatOlderThan(20)).map((m) => m.id)).toEqual(['old'])
    await s.deleteChat(['old'])
    expect(await s.countChat()).toBe(2)
  })

  test('exportJson carries the WHOLE chat table — the boot window never leaks into a backup', async () => {
    const s = makeStore()
    await s.putChat(
      Array.from({ length: CHAT_BOOT_PAGE + 10 }, (_, i) => chatMsg(`m${String(i).padStart(4, '0')}`, 1000 + i)),
    )
    const backup = JSON.parse(await s.exportJson()) as { chat: { id: string }[] }
    expect(backup.chat.length).toBe(CHAT_BOOT_PAGE + 10)
    expect(backup.chat.some((m) => m.id === 'm0000')).toBe(true) // the very first message travels
  })
}
