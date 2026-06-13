/* Provider-neutral tool registry + dispatcher. Every conversational provider
   (Anthropic, OpenAI, …) advertises exactly these tools and routes calls
   through runTool — one schema, one executor path, identical behavior. */

import type { ToolExecutor } from './types'
import { clampInt, optInt } from './rules'

export interface NeutralTool {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema (object)
}

const TAG_SCHEMA = { type: 'string', enum: ['work', 'private', 'health', 'rest'] } as const

export const MEW_TOOLS: NeutralTool[] = [
  {
    name: 'plan_blocks',
    description:
      'Place new time blocks on the week and/or protect windows as free, when the user asks to schedule, block, hold, add, or keep time free. One call carries the whole ask: count the items they named and include every one. Distinct phrases are distinct blocks ("order lunch" is an errand, "lunch" is the meal). Reserve it for things the user wants scheduled; a passing mention stays conversation.',
    parameters: {
      type: 'object',
      properties: {
        places: {
          type: 'array',
          description: 'Blocks to place.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short block title — no dates or times inside' },
              tag: { ...TAG_SCHEMA, description: 'walks/meals/family → private; appointments → health; recovery → rest; else work' },
              dayOffset: { type: 'integer', description: 'Days from today (0 = today). Resolve weekday words against the context date.' },
              startMin: { type: 'integer', description: 'Start in minutes from midnight (9:00 = 540). Omit to auto-place in the first free slot.' },
              durationMin: { type: 'integer', description: 'Duration in minutes. Default 60; "morning" = startMin 540, durationMin 180 unless the user says otherwise; "afternoon" ≈ 240 from 780.' },
              protected: { type: 'boolean', description: 'Default true — except short rests (≤20 min), which default false so reshaping can absorb them.' },
              attention: { type: 'string', enum: ['focus', 'background'], description: 'background = holds the clock, not the user (a 3h restore): never the Focus center, transparent to slot search. Default focus.' },
              dueMin: { type: 'integer', description: 'Hard deadline in minutes from midnight, independent of the end time ("due by 1pm" = 780). MEW watches the latest start.' },
            },
            required: ['title', 'tag', 'dayOffset'],
            additionalProperties: false,
          },
        },
        frees: {
          type: 'array',
          description: 'Windows to keep free / protect from scheduling.',
          items: {
            type: 'object',
            properties: {
              dayOffset: { type: 'integer' },
              startMin: { type: 'integer', description: 'afternoon = 780' },
              endMin: { type: 'integer', description: 'afternoon ends 1020' },
            },
            required: ['dayOffset', 'startMin', 'endMin'],
            additionalProperties: false,
          },
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'complete_task',
    description:
      'Mark an existing block done (a mew) when the user says they finished, did, or completed something. The query is matched fuzzily against block titles.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A few words from the block title, e.g. "deck"' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'move_task',
    description:
      'Reschedule an existing block to another day and/or time when the user asks to move, push, or shift it. Omit the time to land in the first free slot.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A few words from the block title' },
        toDayOffset: { type: 'integer', description: 'Target day, days from today' },
        toStartMin: { type: 'integer', description: 'Target start in minutes from midnight' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'capture_intention',
    description:
      'Record a task the user mentioned with no time attached ("I should call the bank"). MEW follows up to ask when it should live, so end your reply there and let the user pick the moment.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: "The intention, in the user's words" },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit_block',
    description:
      "Change an existing block in place — its start/end time, duration, title, tag, attention, or due — when the user asks to resize, shorten, extend, retime ('wake should be 6:00–6:30', 'make the release 45 minutes'), rename, retag, demote to background ('let it run'), or set a deadline. Editing keeps the block's identity and history, so prefer it over re-creating. Events from connected calendars stay as they are; they belong to the calendar, so tell the user that instead.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A few words from the block title' },
        startMin: { type: 'integer', description: 'New start, minutes from midnight' },
        endMin: { type: 'integer', description: 'New end, minutes from midnight' },
        durationMin: { type: 'integer', description: 'New duration in minutes (keeps the start)' },
        title: { type: 'string', description: 'New title' },
        tag: { ...TAG_SCHEMA, description: 'New tag' },
        attention: { type: 'string', enum: ['focus', 'background'], description: 'background = holds the clock, not the user; focus = holds the user again' },
        dueMin: { type: 'integer', description: 'Hard deadline, minutes from midnight — independent of the end time' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_slot',
    description:
      "Find the first genuinely clear window for a task — checked against every time-holding block including tentative meetings. Call it whenever the user asks to 'find time' or gives a constraint ('before 5pm', 'in the morning'), then place exactly the window it returns. Read-only; it changes nothing.",
    parameters: {
      type: 'object',
      properties: {
        durationMin: { type: 'integer', description: 'Minutes needed' },
        dayOffset: { type: 'integer', description: 'Day to search, days from today (default 0)' },
        notBeforeMin: { type: 'integer', description: 'Earliest acceptable start, minutes from midnight' },
        notAfterMin: { type: 'integer', description: 'Latest acceptable END, minutes from midnight ("before 5pm" = 1020)' },
      },
      required: ['durationMin'],
      additionalProperties: false,
    },
  },
  {
    name: 'analyze_day',
    description:
      "X-ray one day's shape before optimizing it: dead gaps, unbroken stretches past the ~90-minute focus ceiling, big meetings missing a post-buffer, and load vs the user's realistic best. Read-only — it changes nothing. Call it when asked to optimize, tidy, or review a day, then fix the findings with the other tools.",
    parameters: {
      type: 'object',
      properties: {
        dayOffset: { type: 'integer', description: 'Day to analyze, days from today (default 0)' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_blocks',
    description:
      'Take specific blocks off the week — when the user asks to drop, remove, delete, or cancel a named block ("drop the prod release", "drop both prod release blocks"). Removes every open block matching the query and leaves everything else standing. For wiping a whole day or week, clear_blocks is the broom.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A few words from the block title; all open matches are removed' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'clear_blocks',
    description:
      "Sweep a whole scope clean when the user asks to clear, clean up, wipe, or reset their calendar/week, or to start over and re-plan. For one or a few named blocks, reach for remove_blocks instead — this broom takes the whole scope. Done blocks (their mews) and events from connected calendars always survive a clear; the tool result tells you what was kept. Call this before re-planning when they ask for a fresh start.",
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['today', 'tomorrow', 'week', 'upcoming'],
          description: '"week" = the rest of this week; "upcoming" = everything from today forward (default for "clean up my calendar")',
        },
      },
      required: ['scope'],
      additionalProperties: false,
    },
  },
  {
    name: 'remember',
    description:
      "Persist a standing rule or correction the user stated, structured so MEW can apply it later. Fire on corrections and standing rules — 'always', 'never', 'X means Y', 'from now on'. NOT for one-offs: 'move gym to 8 today' is a move, not a preference. Re-teaching is a failure; one-off noise in the rulebook is also a failure.",
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['time-default', 'duration-default', 'flexibility', 'ordering', 'fact'],
          description: 'time-default = when it usually starts · duration-default = how long it really takes · flexibility = can it move · ordering = what comes before/after what · fact = anything else durable',
        },
        match: { type: 'string', description: 'What the rule is about — "gym", "order lunch", "deep work"' },
        value: { type: 'string', description: 'The rule itself — "starts 07:00", "45m", "never moves", "before standup"' },
        stated: { type: 'string', description: "The user's own words, verbatim" },
      },
      required: ['kind', 'match', 'value', 'stated'],
      additionalProperties: false,
    },
  },
]

export function runTool(name: string, input: unknown, exec: ToolExecutor): string {
  const o = (input ?? {}) as Record<string, unknown>
  switch (name) {
    case 'plan_blocks': {
      const places = (Array.isArray(o.places) ? o.places : [])
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .filter((p) => typeof p.title === 'string' && (p.title as string).trim())
        .map((p) => ({
          title: String(p.title).trim(),
          tag: (['work', 'private', 'health', 'rest'] as const).includes(p.tag as never)
            ? (p.tag as 'work')
            : ('work' as const),
          dayOffset: clampInt(p.dayOffset, 0, 13, 0),
          startMin: optInt(p.startMin, 0, 1439),
          durationMin: optInt(p.durationMin, 15, 600),
          protected: typeof p.protected === 'boolean' ? p.protected : undefined,
          attention: p.attention === 'background' ? ('background' as const) : undefined,
          due: optInt(p.dueMin, 0, 1439),
        }))
      const frees = (Array.isArray(o.frees) ? o.frees : [])
        .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
        .map((f) => ({
          dayOffset: clampInt(f.dayOffset, 0, 13, 0),
          startMin: clampInt(f.startMin, 0, 1439, 13 * 60),
          endMin: clampInt(f.endMin, 0, 1439, 17 * 60),
        }))
      if (!places.length && !frees.length) return 'nothing to place — the call was empty'
      return exec.plan(places, frees)
    }
    case 'complete_task':
      return exec.complete(String(o.query ?? ''))
    case 'move_task':
      return exec.move(String(o.query ?? ''), optInt(o.toDayOffset, 0, 13), optInt(o.toStartMin, 0, 1439))
    case 'capture_intention':
      return exec.capture(String(o.title ?? ''))
    case 'edit_block': {
      const patch: Parameters<ToolExecutor['edit']>[1] = {}
      const sm = optInt(o.startMin, 0, 1439)
      const em = optInt(o.endMin, 1, 1440)
      const dm = optInt(o.durationMin, 5, 720)
      if (sm != null) patch.startMin = sm
      if (em != null) patch.endMin = em
      if (dm != null) patch.durationMin = dm
      if (typeof o.title === 'string' && o.title.trim()) patch.title = o.title.trim()
      if ((['work', 'private', 'health', 'rest'] as const).includes(o.tag as never)) patch.tag = o.tag as 'work'
      if (o.attention === 'background' || o.attention === 'focus') patch.attention = o.attention
      const due = optInt(o.dueMin, 0, 1439)
      if (due != null) patch.due = due
      return exec.edit(String(o.query ?? ''), patch)
    }
    case 'find_slot':
      return exec.findSlot(
        clampInt(o.durationMin, 5, 600, 30),
        clampInt(o.dayOffset, 0, 13, 0),
        optInt(o.notBeforeMin, 0, 1439),
        optInt(o.notAfterMin, 1, 1440),
      )
    case 'analyze_day':
      return exec.analyze(clampInt(o.dayOffset, 0, 13, 0))
    case 'remove_blocks':
      return exec.remove(String(o.query ?? ''))
    case 'clear_blocks': {
      const scopes = ['today', 'tomorrow', 'week', 'upcoming'] as const
      const scope = scopes.includes(o.scope as never) ? (o.scope as 'upcoming') : 'upcoming'
      return exec.clear(scope)
    }
    case 'remember': {
      const kinds = ['time-default', 'duration-default', 'flexibility', 'ordering', 'fact'] as const
      const match = String(o.match ?? '').trim()
      const value = String(o.value ?? '').trim()
      if (!match || !value) return 'nothing to remember — the rule needs a subject and a value'
      return exec.remember({
        kind: kinds.includes(o.kind as never) ? (o.kind as (typeof kinds)[number]) : 'fact',
        match,
        value,
        stated: String(o.stated ?? '').trim() || `${match} ${value}`,
      })
    }
    default:
      return `unknown tool: ${name}`
  }
}
