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
      'Place new time blocks on the week and/or protect windows as free. Call this when the user asks to schedule, block, hold, add, or keep time free — including multiple asks in one message (one call, several entries). Count the items the user named and place EVERY one — silently dropping any is an error. Distinct phrases are distinct blocks ("order lunch" is an errand, "lunch" is the meal — never merge them). Do NOT call it for things the user merely mentions without wanting them scheduled.',
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
              protected: { type: 'boolean', description: 'Default true.' },
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
      'Record a task the user mentioned WITHOUT a time ("I should call the bank"). MEW will then ask when it should live — do not propose a slot yourself after calling this.',
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
      "Change an EXISTING block in place — its start/end time, duration, title, or tag — when the user asks to resize, shorten, extend, retime ('wake should be 6:00–6:30', 'make the release 45 minutes'), rename, or retag it. Never re-create a block to change it. Calendar events from connected calendars cannot be edited.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A few words from the block title' },
        startMin: { type: 'integer', description: 'New start, minutes from midnight' },
        endMin: { type: 'integer', description: 'New end, minutes from midnight' },
        durationMin: { type: 'integer', description: 'New duration in minutes (keeps the start)' },
        title: { type: 'string', description: 'New title' },
        tag: { ...TAG_SCHEMA, description: 'New tag' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'clear_blocks',
    description:
      "Remove the user's open MEW-placed blocks when they ask to clear, clean up, wipe, or reset their calendar/week, or to start over and re-plan. Done blocks (their mews) and events from connected calendars are NEVER removed — the tool result tells you what was kept. Call this before re-planning if they asked for a fresh start.",
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
          protected: p.protected !== false,
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
      return exec.edit(String(o.query ?? ''), patch)
    }
    case 'clear_blocks': {
      const scopes = ['today', 'tomorrow', 'week', 'upcoming'] as const
      const scope = scopes.includes(o.scope as never) ? (o.scope as 'upcoming') : 'upcoming'
      return exec.clear(scope)
    }
    default:
      return `unknown tool: ${name}`
  }
}
