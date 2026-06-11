/* Core domain types. Product law is encoded here: a block can be open, done,
   or rolled — there is no failed/overdue/missed state anywhere in the system. */

export type Tag = 'work' | 'private' | 'health' | 'rest'
export type BlockStatus = 'open' | 'done' | 'rolled'
export type Visibility = 'details' | 'busy' | 'hidden'
export type VisibleTag = Exclude<Tag, 'rest'>

export interface Block {
  id: string
  title: string
  tag: Tag
  dayKey: string // YYYY-MM-DD (local)
  startMin: number // minutes from local midnight
  endMin: number
  protected: boolean
  status: BlockStatus
  calendarRefs: string[]
  estimateSource: 'user' | 'mew' | 'history'
  rolledToId?: string
  completedAt?: number
  /** Set when this block came IN from a connected calendar. External blocks are
      never pushed back out, and MEW never reschedules them (not ours to move). */
  external?: { calId: string; eventId: string }
  /** Optional events don't hard-block time: invisible to free-slot search,
      load math, the now-headline and close-the-loop; rendered as a thin tint. */
  optional?: boolean
}

export interface Capture {
  id: string
  title: string
  createdAt: number
  status: 'open' | 'placed' | 'done'
  placedBlockId?: string
}

export type NudgeId =
  | 'right-size'
  | 'drift'
  | 'guard'
  | 'celebrate'
  | 'close-loop'
  | 'when-where'
  | 'protect-rest'
  | 'kinder-plan'
  | 'fresh-start'
  | 'break-smaller'
  | 'post-buffer'
  | 'next-up'
  | 'micro-break'

export interface NudgeAction {
  id: string
  label: string
  kind: 'primary' | 'secondary'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'mew' | 'nudge'
  body: string
  ts: number
  /* mew messages: optional muted observation line */
  observation?: string
  /* nudge messages */
  nudgeType?: NudgeId
  nudgeLabel?: string
  footnote?: string
  actions?: NudgeAction[]
  resolved?: string // label of the action taken
  payload?: Record<string, string | number> // action context (blockId, dayKey, …)
}

export type MemoryKind =
  | 'completed'
  | 'rolled'
  | 'drift'
  | 'interruption'
  | 'nudge_outcome'
  | 'rest_kept'
  | 'rest_skipped'
  | 'weekly_summary' // consolidation artifact — old raw events compacted per ISO week

export interface MemoryEvent {
  id: string
  ts: number
  kind: MemoryKind
  dayKey: string
  tag?: Tag
  plannedMin?: number
  deep?: boolean
  /* pattern fuel (GBrain): which block, when it sat in the day */
  title?: string
  startMin?: number
  endMin?: number
  nudgeType?: NudgeId
  outcome?: 'accepted' | 'declined' | 'ignored'
  /* weekly_summary payload */
  summary?: {
    completed: number
    rolled: number
    deepMin: number
    restKept: number
    restSkipped: number
    drifts: number
  }
}

export interface ConnectedCalendar {
  id: string
  name: string
  who: string
  provider: 'google' | 'outlook' | 'caldav' | 'ics'
  /** 'live' syncs two-way; 'import' is an .ics snapshot; demo rows are 'simulated'. */
  kind?: 'live' | 'simulated' | 'import'
  /** Inbound events land in the week under this tag (PRD §4). */
  defaultTag?: VisibleTag
  /** We pull from read-only calendars but never push. */
  readOnly?: boolean
}

export type RoutingMatrix = Record<string, Record<VisibleTag, Visibility>>

export type PetId = 'cat' | 'dog' | 'fox' | 'bunny' | 'bird'

export interface Settings {
  calendars: ConnectedCalendar[]
  matrix: RoutingMatrix
  /** Theme follows pet (PRD §3b): the pet swaps only the accent pair. */
  pet: PetId
  themeMode: 'carbon' | 'white'
  browserMirror: boolean
  quietHours: { startMin: number; endMin: number } // 18:30–08:30 default, wraps midnight
  showScience: boolean
  modelLocation: 'remote' | 'local'
  /** Which remote brain answers (BYO key either way). */
  remoteProvider: 'anthropic' | 'openai'
  anthropicKey: string
  openaiKey: string
  openaiModel: string
  ollamaUrl: string
  ollamaModel: string
  /** Google OAuth client ID (Web) from the user's own Cloud project — BYO
      credentials, same ethos as BYO key; there is no MEW server to hold one. */
  googleClientId: string
  overnightConsolidation: boolean
  mewName: string
}

/* The Rive "PixieMachine" input contract — PRD §6. The placeholder SVG and the
   future pixie.riv are two renderers of exactly this. */
export interface PixieInputs {
  mood: 'healthy' | 'drowsy' | 'rundown'
  resting: boolean
  pace: number // 0–1 rolling sustainability score
  attention: boolean // a nudge is waiting in chat
}

export type ClearScope = 'today' | 'tomorrow' | 'week' | 'upcoming'

export interface ScheduleIntent {
  kind: 'plan' | 'complete' | 'move' | 'capture' | 'clear' | 'remove' | 'edit' | 'chat'
  /** clear: which open MEW-placed blocks to remove (mews + calendar events never) */
  scope?: ClearScope
  /** edit: changes to apply to the matched block */
  edit?: { startMin?: number; endMin?: number; durationMin?: number; title?: string; tag?: Tag }
  /* plan */
  places?: {
    title: string
    tag: Tag
    dayOffset?: number // relative to today; engine resolves weekday words
    dayKey?: string
    startMin?: number
    endMin?: number
    durationMin?: number
    protected?: boolean
  }[]
  frees?: { dayKey: string; startMin: number; endMin: number; label: string }[]
  /* complete / move */
  query?: string
  toDayKey?: string
  toStartMin?: number
  /* capture / chat */
  title?: string
  reply?: string
}

export const DEFAULT_SETTINGS: Settings = {
  calendars: [],
  matrix: {},
  pet: 'cat',
  themeMode: 'carbon',
  browserMirror: true,
  quietHours: { startMin: 18 * 60 + 30, endMin: 8 * 60 + 30 },
  showScience: true,
  modelLocation: 'remote',
  remoteProvider: 'anthropic',
  anthropicKey: '',
  openaiKey: '',
  openaiModel: 'gpt-4o-mini',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
  googleClientId: '',
  overnightConsolidation: true,
  mewName: 'Pixie',
}
