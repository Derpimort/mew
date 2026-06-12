/* Desktop adapter — the rotation/prune/offer logic is ours, so it gets the
   tests; the Tauri runtime is faked at the window.__TAURI__ seam exactly as
   the shell (withGlobalTauri) provides it. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { backupPath, isTauri, latestBackupDate, readBackup, registerCloseFlush, writeBackup } from '../desktop'

/* in-memory $DOCUMENT: path → contents */
function fakeShell() {
  const files = new Map<string, string>()
  const removed: string[] = []
  const closeHandlers: Array<(e: { preventDefault(): void }) => void | Promise<void>> = []
  let destroyed = false
  const t = {
    fs: {
      mkdir: async () => {},
      writeTextFile: async (path: string, contents: string) => {
        files.set(path, contents)
      },
      readTextFile: async (path: string) => {
        const c = files.get(path)
        if (c == null) throw new Error(`ENOENT: ${path}`)
        return c
      },
      readDir: async (dir: string) =>
        [...files.keys()]
          .filter((p) => p.startsWith(`${dir}/`))
          .map((p) => ({ name: p.slice(dir.length + 1) })),
      remove: async (path: string) => {
        files.delete(path)
        removed.push(path)
      },
    },
    path: {
      BaseDirectory: { Document: 6 },
      documentDir: async () => '/home/user/Documents',
      join: async (...parts: string[]) => parts.join('/'),
    },
    opener: { openPath: async () => {} },
    window: {
      getCurrentWindow: () => ({
        onCloseRequested: async (cb: (typeof closeHandlers)[number]) => {
          closeHandlers.push(cb)
        },
        destroy: async () => {
          destroyed = true
        },
      }),
    },
  }
  return {
    files,
    removed,
    closeHandlers,
    isDestroyed: () => destroyed,
    win: { __TAURI_INTERNALS__: {}, __TAURI__: t },
  }
}

const day = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

afterEach(() => vi.unstubAllGlobals())

describe('desktop adapter', () => {
  it('is inert outside the shell: detection false, io resolves to nothing', async () => {
    vi.stubGlobal('window', {})
    expect(isTauri()).toBe(false)
    await expect(writeBackup('{}')).resolves.toBeUndefined()
    expect(await readBackup()).toBeNull()
    expect(await latestBackupDate()).toBeNull()
    expect(backupPath()).toContain('Documents/MEW')
  })

  it('detects the shell via __TAURI_INTERNALS__', () => {
    vi.stubGlobal('window', fakeShell().win)
    expect(isTauri()).toBe(true)
  })

  it('writes the latest snapshot plus a dated rotation', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    await writeBackup('{"week":1}')
    expect(shell.files.get('MEW/mew-backup.json')).toBe('{"week":1}')
    expect(shell.files.get(`MEW/mew-backup-${day()}.json`)).toBe('{"week":1}')
  })

  it('prunes dated rotations to the newest 14, never the latest snapshot', async () => {
    const shell = fakeShell()
    for (let i = 1; i <= 16; i++) {
      shell.files.set(`MEW/mew-backup-2026-01-${String(i).padStart(2, '0')}.json`, 'old')
    }
    vi.stubGlobal('window', shell.win)
    await writeBackup('{}')
    const dated = [...shell.files.keys()].filter((p) => /mew-backup-\d{4}/.test(p))
    expect(dated).toHaveLength(14)
    expect(shell.removed).toEqual([
      'MEW/mew-backup-2026-01-01.json',
      'MEW/mew-backup-2026-01-02.json',
      'MEW/mew-backup-2026-01-03.json',
    ])
    expect(shell.files.has('MEW/mew-backup.json')).toBe(true)
  })

  it('readBackup returns the snapshot, or null when the file is gone', async () => {
    const shell = fakeShell()
    shell.files.set('MEW/mew-backup.json', '{"x":1}')
    vi.stubGlobal('window', shell.win)
    expect(await readBackup()).toBe('{"x":1}')
    shell.files.delete('MEW/mew-backup.json')
    expect(await readBackup()).toBeNull()
  })

  it('latestBackupDate reads the newest rotation name', async () => {
    const shell = fakeShell()
    shell.files.set('MEW/mew-backup-2026-05-30.json', '{}')
    shell.files.set('MEW/mew-backup-2026-06-02.json', '{}')
    shell.files.set('MEW/mew-backup.json', '{}')
    vi.stubGlobal('window', shell.win)
    expect(await latestBackupDate()).toBe('2026-06-02')
  })

  it('close flush: dirty close is intercepted, flushed once, then released', async () => {
    const shell = fakeShell()
    vi.stubGlobal('window', shell.win)
    let dirty = true
    const flush = vi.fn(async () => {
      dirty = false
    })
    registerCloseFlush(() => dirty, flush)
    await Promise.resolve() // onCloseRequested registration is async
    expect(shell.closeHandlers).toHaveLength(1)
    let prevented = false
    await shell.closeHandlers[0]({ preventDefault: () => (prevented = true) })
    expect(prevented).toBe(true)
    expect(flush).toHaveBeenCalledOnce()
    expect(shell.isDestroyed()).toBe(true)
    /* clean close sails through */
    prevented = false
    await shell.closeHandlers[0]({ preventDefault: () => (prevented = true) })
    expect(prevented).toBe(false)
    expect(flush).toHaveBeenCalledOnce()
  })
})
