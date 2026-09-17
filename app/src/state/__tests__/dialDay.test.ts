/* The Focus dial's shown day (#23) is the store's focusedDayKey, shared with
   Week. Pinned here through the real store actions: a picked day survives a
   trip Focus → Week → Focus, the header's "back to today" is focusDay(null),
   and paging Week to another week deliberately returns Focus to today (the
   pre-existing setWeekOffset rule, kept). Storage and the desktop shell are
   faked at their seams — no hydrate needed for pure selection state. */

import { describe, expect, it, vi } from 'vitest'

vi.mock('../../adapters/storage', () => ({
  createDexieStorage: () => ({
    load: async () => ({ blocks: [], captures: [], chat: [], memory: [], settings: null }),
    putBlocks: async () => {},
    deleteBlocks: async () => {},
    putCaptures: async () => {},
    deleteCaptures: async () => {},
    putChat: async () => {},
    countChat: async () => 0,
    loadChatBefore: async () => [],
    loadChatOlderThan: async () => [],
    deleteChat: async () => {},
    putMemory: async () => {},
    deleteMemory: async () => {},
    putSettings: async () => {},
    loadSyncMap: async () => [],
    saveSyncMap: async () => {},
    deleteSyncForCalendar: async () => {},
    exportJson: async () => '{}',
    importJson: async () => {},
    getAuditLog: async () => [],
    wipe: async () => {},
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

import { useMew } from '../store'

describe('the shown day lives in focusedDayKey', () => {
  it('a picked day survives Focus → Week → Focus', () => {
    const s = useMew.getState()
    s.setView('focus')
    s.focusDay('2026-09-15')
    useMew.getState().setView('week')
    expect(useMew.getState().focusedDayKey).toBe('2026-09-15')
    useMew.getState().setView('focus')
    expect(useMew.getState().focusedDayKey).toBe('2026-09-15')
  })

  it('"back to today" is the canonical null', () => {
    useMew.getState().focusDay('2026-09-17')
    useMew.getState().focusDay(null)
    expect(useMew.getState().focusedDayKey).toBeNull()
  })

  it('paging Week to another week returns Focus to today (kept, deliberately)', () => {
    useMew.getState().focusDay('2026-09-15')
    useMew.getState().setWeekOffset(1)
    expect(useMew.getState().focusedDayKey).toBeNull()
    useMew.getState().setWeekOffset(0)
  })
})
