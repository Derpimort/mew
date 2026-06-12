/* Desktop (Tauri) adapter — the ONLY file in app/ that knows the shell
   exists. The shell exposes its API on `window.__TAURI__` (withGlobalTauri),
   so the web bundle carries zero @tauri-apps packages in its module graph:
   in a plain browser every call here is a cheap no-op. Backup writes are
   silent-but-logged — the backup must never block the week. */

interface TauriFs {
  mkdir(path: string, opts: { baseDir: number; recursive?: boolean }): Promise<void>
  writeTextFile(path: string, contents: string, opts: { baseDir: number }): Promise<void>
  readTextFile(path: string, opts: { baseDir: number }): Promise<string>
  readDir(path: string, opts: { baseDir: number }): Promise<{ name: string }[]>
  remove(path: string, opts: { baseDir: number }): Promise<void>
}

interface TauriApi {
  fs: TauriFs
  path: {
    BaseDirectory: { Document: number }
    documentDir(): Promise<string>
    join(...parts: string[]): Promise<string>
  }
  opener: { openPath(path: string): Promise<void> }
  window: {
    getCurrentWindow(): {
      onCloseRequested(cb: (e: { preventDefault(): void }) => void | Promise<void>): Promise<unknown>
      destroy(): Promise<void>
    }
  }
}

type ShellWindow = { __TAURI_INTERNALS__?: unknown; __TAURI__?: TauriApi }

const shell = (): ShellWindow | null =>
  typeof window === 'undefined' ? null : (window as unknown as ShellWindow)

export function isTauri(): boolean {
  const w = shell()
  return !!w && '__TAURI_INTERNALS__' in w
}

const api = (): TauriApi | null => shell()?.__TAURI__ ?? null

const DIR = 'MEW'
const LATEST = `${DIR}/mew-backup.json`
const KEEP = 14
const DATED = /^mew-backup-(\d{4}-\d{2}-\d{2})\.json$/

/* local calendar date — backups rotate on the user's day, not UTC's */
const localDay = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Where backups live, for display — real writes resolve via the shell. */
export function backupPath(): string {
  return 'Documents/MEW/mew-backup.json'
}

/** Latest snapshot + a dated rotation, pruned to the newest KEEP days. */
export async function writeBackup(json: string): Promise<void> {
  const t = api()
  if (!t) return
  try {
    const baseDir = t.path.BaseDirectory.Document
    await t.fs.mkdir(DIR, { baseDir, recursive: true })
    await t.fs.writeTextFile(LATEST, json, { baseDir })
    await t.fs.writeTextFile(`${DIR}/mew-backup-${localDay()}.json`, json, { baseDir })
    const entries = await t.fs.readDir(DIR, { baseDir })
    const dated = entries
      .map((e) => e.name)
      .filter((n) => DATED.test(n))
      .sort() // ISO dates sort chronologically
    for (const stale of dated.slice(0, Math.max(0, dated.length - KEEP))) {
      await t.fs.remove(`${DIR}/${stale}`, { baseDir })
    }
  } catch (err) {
    console.warn('mew: auto-backup failed (will retry on the next change)', err)
  }
}

export async function readBackup(): Promise<string | null> {
  const t = api()
  if (!t) return null
  try {
    return await t.fs.readTextFile(LATEST, { baseDir: t.path.BaseDirectory.Document })
  } catch {
    return null
  }
}

/** Date of the newest rotation — what "found a backup from <date>" says. */
export async function latestBackupDate(): Promise<string | null> {
  const t = api()
  if (!t) return null
  try {
    const entries = await t.fs.readDir(DIR, { baseDir: t.path.BaseDirectory.Document })
    const dates = entries
      .map((e) => DATED.exec(e.name)?.[1])
      .filter((d): d is string => !!d)
      .sort()
    return dates[dates.length - 1] ?? null
  } catch {
    return null
  }
}

export async function openBackupFolder(): Promise<void> {
  const t = api()
  if (!t) return
  try {
    await t.opener.openPath(await t.path.join(await t.path.documentDir(), DIR))
  } catch (err) {
    console.warn('mew: could not open the backup folder', err)
  }
}

/** One last write on the way out: intercept close once, flush, then leave. */
export function registerCloseFlush(isDirty: () => boolean, flush: () => Promise<void>): void {
  const t = api()
  if (!t) return
  try {
    const w = t.window.getCurrentWindow()
    void w.onCloseRequested(async (e) => {
      if (!isDirty()) return
      e.preventDefault()
      try {
        await flush()
      } catch (err) {
        console.warn('mew: close-time backup failed', err)
      }
      void w.destroy()
    })
  } catch (err) {
    console.warn('mew: close hook unavailable', err)
  }
}
