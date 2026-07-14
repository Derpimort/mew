/* Desktop (Tauri) adapter — the ONLY file in app/ that knows the shell
   exists. The shell exposes its API on `window.__TAURI__` (withGlobalTauri),
   so the web bundle carries zero @tauri-apps packages in its module graph:
   in a plain browser every call here is a cheap no-op. Backup writes are
   silent-but-logged — the backup must never block the week. */

import { logger } from './logger'

const log = logger.withContext('desktop')

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
  opener: { openPath(path: string): Promise<void>; openUrl(url: string): Promise<void> }
  window: {
    getCurrentWindow(): {
      onCloseRequested(
        cb: (e: { preventDefault(): void }) => void | Promise<void>
      ): Promise<unknown>
      destroy(): Promise<void>
    }
  }
  core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> }
  event: { listen<T>(name: string, cb: (e: { payload: T }) => void): Promise<() => void> }
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
    log.warn('backup/write', { note: 'will retry on the next change' }, err)
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
    log.warn('backup/open-folder', {}, err)
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
        log.warn('backup/close-time', {}, err)
      }
      void w.destroy()
    })
  } catch (err) {
    log.warn('close-hook/unavailable', {}, err)
  }
}

/** Raise the MEW window — show if hidden, unminimize, focus — for a
    notification click that must land back on the week. The window ops live
    behind one shell command (`focus_main_window`), so the webview needs no
    core:window capability grants. Outside the shell, or if the shell
    refuses, this quietly does nothing: the nudge still lives in chat. */
export async function focusMainWindow(): Promise<void> {
  const t = api()
  if (!t) return
  try {
    await t.core.invoke('focus_main_window')
  } catch (err) {
    log.warn('focus/unavailable', {}, err)
  }
}

/* ── OAuth loopback (Google blocks sign-in inside embedded webviews) ──── */

/* Fixed candidate ports, not random: Google Web clients demand an EXACT
   redirect-URI match (and Desktop clients reject the implicit grant the
   adapter depends on), so the ports must be knowable in advance — the
   matching http://localhost:<port> URIs are documented in desktop/README.md. */
export const OAUTH_PORTS = [17893, 17894, 17895]

/* Served by the loopback for every hit. The token arrives in the URL
   FRAGMENT (implicit grant), which never reaches a server — this page
   forwards it as a query string so the listener can see it, then tells
   the human the tab is done. */
const OAUTH_RESPONSE_HTML = [
  '<!doctype html><html><head><meta charset="utf-8"><title>MEW</title></head>',
  '<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#060708;color:#ecedef">',
  '<p id="m">finishing sign-in…</p>',
  '<script>',
  'if (location.hash.length > 1) {',
  "  fetch('/?' + location.hash.slice(1)).finally(function () {",
  "    document.getElementById('m').textContent = 'you can close this tab — MEW has it'",
  '  })',
  '} else {',
  "  document.getElementById('m').textContent = 'you can close this tab — MEW has it'",
  '}',
  '</scr' + 'ipt></body></html>',
].join('\n')

/** Run an OAuth round-trip through the system browser: start the loopback,
    open the auth URL built for the bound port, resolve with the redirect URL
    that carries the response. Times out rather than hang the Settings flow. */
export async function oauthLoopback(
  buildAuthUrl: (port: number) => string,
  timeoutMs = 120_000
): Promise<string> {
  const t = api()
  if (!t) throw new Error('sign-in via the system browser needs the desktop shell')
  const port = await t.core.invoke<number>('plugin:oauth|start', {
    config: { ports: OAUTH_PORTS, response: OAUTH_RESPONSE_HTML },
  })
  const cleanups: Array<() => void> = []
  try {
    const redirect = new Promise<string>((resolve, reject) => {
      void t.event
        .listen<string>('oauth://url', (e) => {
          const url = String(e.payload)
          /* first hit is the bare redirect (fragment stayed in the browser);
             only the re-posted, response-bearing URL settles the flow */
          if (/[?&#](access_token|code|error)=/.test(url)) resolve(url)
        })
        .then((un) => cleanups.push(un))
      void t.event
        .listen('oauth://invalid-url', () =>
          reject(new Error('the sign-in redirect was not understood'))
        )
        .then((un) => cleanups.push(un))
    })
    const timeout = new Promise<never>((_, reject) => {
      const id = setTimeout(
        () =>
          reject(new Error('sign-in timed out after 120s — the browser tab may have been closed')),
        timeoutMs
      )
      cleanups.push(() => clearTimeout(id))
    })
    void t.opener.openUrl(buildAuthUrl(port))
    return await Promise.race([redirect, timeout])
  } finally {
    for (const c of cleanups) c()
    void t.core.invoke('plugin:oauth|cancel', { port }).catch(() => {})
  }
}

/* ── managed brain sidecar (the shell spawns gbrain; MEW just listens) ── */

export interface BrainEndpoint {
  url: string
  token: string
}

/** The sidecar's current endpoint — null in a browser, before the first
    handshake completes, or after the shell gave up on restarts. */
export async function brainEndpoint(): Promise<BrainEndpoint | null> {
  const t = api()
  if (!t) return null
  try {
    return (await t.core.invoke<BrainEndpoint | null>('brain_endpoint')) ?? null
  } catch {
    return null
  }
}

/** Fires on every (re)spawn handshake — a restart means a new port+token. */
export function onBrainEndpoint(cb: (e: BrainEndpoint) => void): void {
  const t = api()
  if (!t) return
  void t.event.listen<BrainEndpoint>('mew://brain-endpoint', (e) => cb(e.payload))
}

/** Fires on the sidecar's lifecycle beats — "starting" on each spawn,
    "retrying" after a death, "unavailable" once the shell gives up (#249).
    Connected is not a beat: it arrives as the onBrainEndpoint handshake,
    which alone carries credentials. Payload stays a plain string so the
    webview needs no shared type with the shell. */
export function onBrainStatus(cb: (status: string) => void): void {
  const t = api()
  if (!t) return
  void t.event.listen<string>('mew://brain-status', (e) => cb(String(e.payload)))
}

/** The last beat the shell kept — pull side of onBrainStatus, for a webview
    that mounted after "starting" fired (React boots slower than the manager
    thread) or reloaded after the give-up, when no beat will ever re-fire.
    Null in a browser or before the shell's first beat. */
export async function brainStatus(): Promise<string | null> {
  const t = api()
  if (!t) return null
  try {
    return (await t.core.invoke<string>('brain_status')) || null
  } catch {
    return null
  }
}

/* ── self-update (the shell stages, the human decides) ────────────────── */

/** Fires when the shell has an update downloaded and parked, with its version. */
export function onUpdateReady(cb: (version: string) => void): void {
  const t = api()
  if (!t) return
  void t.event.listen<string>('mew://update-ready', (e) => cb(String(e.payload)))
}

/** Hand the staged update to the installer — exits the app by design. */
export async function applyUpdate(): Promise<void> {
  const t = api()
  if (!t) throw new Error('updates need the desktop shell')
  await t.core.invoke('apply_update')
}
