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

export interface CalendarAccount {
  /** Interactive=true may open a consent popup; false attempts silent reuse. */
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
