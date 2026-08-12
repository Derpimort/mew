/* CalendarPort — the seam real providers implement (ARCHITECTURE §2.3).
   Google is the first live adapter; Outlook/CalDAV are future files here. */

export interface RemoteCalendar {
  id: string
  summary: string
  primary?: boolean
  readOnly: boolean
}

/** A timed event as seen on the remote calendar (all-day events are skipped). */
export interface RemoteEvent {
  eventId: string
  calId: string
  title: string
  dayKey: string
  startMin: number
  endMin: number
  /** Present when MEW pushed this event — never pull our own events back in. */
  mewBlockId?: string
  /** Tentative / shows-as-free: lands as a non-blocking tint, not a hard block. */
  optional?: boolean
}

export interface PushEventBody {
  title: string
  dayKey: string
  startMin: number
  endMin: number
  mewBlockId: string
}

/** Desktop-only pause signal (#25): silent re-auth would need the system
    browser, and the app must never open one without a same-turn user click —
    the caller pauses sync and the owner reconnects deliberately in Settings. */
export class ReauthRequiredError extends Error {
  constructor() {
    super('google sign-in expired — sync is paused until you reconnect')
    this.name = 'ReauthRequiredError'
  }
}

export interface CalendarAccount {
  /** Interactive=true may open a consent popup; false attempts silent reuse.
      On the desktop shell, false never opens a browser — it throws
      ReauthRequiredError instead when no valid token is in memory. */
  authorize(interactive: boolean): Promise<void>
  listCalendars(): Promise<RemoteCalendar[]>
  listEvents(calId: string, timeMinISO: string, timeMaxISO: string): Promise<RemoteEvent[]>
  createEvent(calId: string, body: PushEventBody): Promise<string>
  updateEvent(calId: string, eventId: string, body: PushEventBody): Promise<void>
  deleteEvent(calId: string, eventId: string): Promise<void>
}

/** One row per (block × calendar) that MEW has pushed — the outbound ledger. */
export interface SyncEntry {
  id: string // `${blockId}:${calId}`
  blockId: string
  calId: string
  eventId: string
  hash: string // projected title|day|start|end — change detection
}
