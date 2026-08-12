/* Google Calendar adapter — browser-direct, BYO OAuth client ID.
   Auth: Google Identity Services token model (the SPA flow — no client secret,
   no MEW server; the token lives in memory and goes only to googleapis.com).
   Loop prevention: every event MEW pushes carries extendedProperties.private
   .mewBlockId, and pull skips anything carrying it. */

import { dayKey, fromDayKey, minOfDay } from '../../domain/time'
import { isTauri, oauthLoopback } from '../desktop'
import type { CalendarAccount, PushEventBody, RemoteCalendar, RemoteEvent } from './types'
import { ReauthRequiredError } from './types'

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const SCOPES =
  'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events'
const API = 'https://www.googleapis.com/calendar/v3'

/* ── minimal GIS typings (the script attaches window.google) ─────────── */
interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
}
interface TokenClientConfig {
  client_id: string
  scope: string
  callback: (resp: TokenResponse) => void
  error_callback?: (err: { type?: string; message?: string }) => void
}
interface GisOauth2 {
  initTokenClient(cfg: TokenClientConfig): {
    requestAccessToken(opts?: { prompt?: '' | 'consent' }): void
  }
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOauth2 } }
  }
}

let gisLoading: Promise<GisOauth2> | null = null
function loadGis(): Promise<GisOauth2> {
  gisLoading ??= new Promise((resolve, reject) => {
    const ready = () => window.google?.accounts?.oauth2
    const existing = ready()
    if (existing) return resolve(existing)
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.onload = () => {
      const g = ready()
      if (g) resolve(g)
      else reject(new Error('Google Identity Services failed to initialize'))
    }
    s.onerror = () => reject(new Error('could not load Google Identity Services'))
    document.head.appendChild(s)
  })
  return gisLoading
}

/* ── time mapping (local wall-clock ↔ RFC3339) ───────────────────────── */
function toISO(day: string, min: number): string {
  const d = fromDayKey(day)
  d.setMinutes(min)
  return d.toISOString()
}
function fromISO(iso: string): { dayKey: string; min: number } {
  const d = new Date(iso)
  return { dayKey: dayKey(d), min: minOfDay(d) }
}

interface GEvent {
  id: string
  status?: string
  summary?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  extendedProperties?: { private?: Record<string, string> }
}

export class GoogleAccount implements CalendarAccount {
  private token: { value: string; expiresAt: number } | null = null
  private clientId: string

  constructor(clientId: string) {
    this.clientId = clientId
  }

  async authorize(interactive: boolean): Promise<void> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return
    /* the desktop shell can't run the GIS popup (Google rejects embedded
       webviews with disallowed_useragent) — same implicit grant, but through
       the system browser and a localhost loopback. The loopback is reachable
       ONLY interactively (#25): a silent path must never yank focus by
       opening the browser, so with no valid token it pauses instead — the
       store surfaces `reconnect` and the click re-enters here with
       interactive=true. Token handling below is byte-identical either way. */
    if (isTauri()) {
      if (!interactive) throw new ReauthRequiredError()
      this.token = await this.authorizeViaLoopback()
      return
    }
    const oauth2 = await loadGis()
    this.token = await new Promise((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPES,
        callback: (resp) => {
          if (resp.error || !resp.access_token) {
            reject(new Error(resp.error ?? 'no access token granted'))
          } else {
            resolve({
              value: resp.access_token,
              expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000,
            })
          }
        },
        error_callback: (err) => reject(new Error(err.message ?? err.type ?? 'sign-in cancelled')),
      })
      client.requestAccessToken({ prompt: interactive ? 'consent' : '' })
    })
  }

  /** System-browser sign-in: auth URL → loopback redirect → token from the
      forwarded fragment. No client secret exists anywhere in this flow.
      Interactive-only by construction (#25) — every caller arrived from a
      deliberate click, so consent is always prompted. */
  private async authorizeViaLoopback(): Promise<{ value: string; expiresAt: number }> {
    const redirect = await oauthLoopback((port) => {
      const q = new URLSearchParams({
        client_id: this.clientId,
        redirect_uri: `http://localhost:${port}`,
        response_type: 'token',
        scope: SCOPES,
        include_granted_scopes: 'true',
        prompt: 'consent',
      })
      return `${AUTH_ENDPOINT}?${q.toString()}`
    })
    const u = new URL(redirect)
    const fields = new URLSearchParams(u.search ? u.search.slice(1) : u.hash.slice(1))
    const err = fields.get('error')
    if (err)
      throw new Error(err === 'access_denied' ? 'sign-in cancelled' : `google sign-in: ${err}`)
    const value = fields.get('access_token')
    if (!value) throw new Error('no access token granted')
    return { value, expiresAt: Date.now() + Number(fields.get('expires_in') ?? 3600) * 1000 }
  }

  private async call<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
    if (!this.token) throw new Error('not signed in')
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token.value}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
    if (res.status === 401 && !retried) {
      this.token = null
      await this.authorize(false) // one silent refresh attempt
      return this.call(path, init, true)
    }
    if (res.status === 410 || res.status === 404) {
      // deleting something already gone is success, not failure
      if (init?.method === 'DELETE') return undefined as T
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`google ${res.status}${body ? `: ${body.slice(0, 140)}` : ''}`)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  async listCalendars(): Promise<RemoteCalendar[]> {
    const data = await this.call<{
      items?: { id: string; summary: string; primary?: boolean; accessRole?: string }[]
    }>(`/users/me/calendarList?maxResults=100`)
    return (data.items ?? []).map((c) => ({
      id: c.id,
      summary: c.summary,
      primary: c.primary,
      readOnly: c.accessRole !== 'owner' && c.accessRole !== 'writer',
    }))
  }

  async listEvents(calId: string, timeMinISO: string, timeMaxISO: string): Promise<RemoteEvent[]> {
    const out: RemoteEvent[] = []
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        timeMin: timeMinISO,
        timeMax: timeMaxISO,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
        ...(pageToken ? { pageToken } : {}),
      })
      const data = await this.call<{ items?: GEvent[]; nextPageToken?: string }>(
        `/calendars/${encodeURIComponent(calId)}/events?${params}`
      )
      for (const e of data.items ?? []) {
        if (e.status === 'cancelled') continue
        if (!e.start?.dateTime || !e.end?.dateTime) continue // all-day events stay out of the week model
        const start = fromISO(e.start.dateTime)
        const end = fromISO(e.end.dateTime)
        out.push({
          eventId: e.id,
          calId,
          title: e.summary ?? '(untitled)',
          dayKey: start.dayKey,
          startMin: start.min,
          // multi-day spans clamp to their first day
          endMin: end.dayKey === start.dayKey ? end.min : 23 * 60 + 59,
          mewBlockId: e.extendedProperties?.private?.mewBlockId,
        })
      }
      pageToken = data.nextPageToken
    } while (pageToken)
    return out
  }

  private body(b: PushEventBody) {
    return JSON.stringify({
      summary: b.title,
      start: { dateTime: toISO(b.dayKey, b.startMin) },
      end: { dateTime: toISO(b.dayKey, b.endMin) },
      extendedProperties: { private: { mewBlockId: b.mewBlockId } },
      // MEW is the notifier — pushed events must not double-ping the user
      reminders: { useDefault: false, overrides: [] },
    })
  }

  async createEvent(calId: string, body: PushEventBody): Promise<string> {
    const data = await this.call<{ id: string }>(`/calendars/${encodeURIComponent(calId)}/events`, {
      method: 'POST',
      body: this.body(body),
    })
    return data.id
  }

  async updateEvent(calId: string, eventId: string, body: PushEventBody): Promise<void> {
    await this.call(
      `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'PATCH', body: this.body(body) }
    )
  }

  async deleteEvent(calId: string, eventId: string): Promise<void> {
    await this.call(
      `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' }
    )
  }
}

/* one account per client ID per session */
let account: { clientId: string; acct: GoogleAccount } | null = null
export function googleAccount(clientId: string): GoogleAccount {
  if (!account || account.clientId !== clientId) {
    account = { clientId, acct: new GoogleAccount(clientId) }
  }
  return account.acct
}
