/* Provider-neutral tool registry + dispatcher. Every conversational provider
   (Anthropic, OpenAI, …) advertises exactly these tools and routes calls
   through runTool — one schema, one executor path, identical behavior. */

import type { ToolExecutor } from './types'
import { normalizeRrule, type Rrule } from '../../domain/recurrence'
import type { PlanMode } from '../../domain/types'
import { clampInt, optInt, parseListDay } from './rules'

/** A model's loose `recurrence` arg → a clean Rrule, or undefined. The byday
    arrives as a CSV ("MO,WE") here; normalizeRrule wants an array, so split
    first, then let it validate freq/interval/byday/until/count (#159). */
function parseRecurrence(raw: unknown): Rrule | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const byday =
    typeof o.byday === 'string' ? o.byday.split(',') : Array.isArray(o.byday) ? o.byday : []
  return normalizeRrule({ ...o, byday }) ?? undefined
}

/** A model's `at` arg (a target block's start time) → a trimmed string or
    undefined. The executor's own clock parser (prefs.parseTimeValue) is the
    single authority on the value; here we only reject empties (#334). */
function atArg(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

/** A model's recurring-edit `scope` arg (#343) → one of the three scope words,
    or undefined (the executor then asks with chips on a series block). */
function recurScope(raw: unknown): 'this' | 'following' | 'series' | undefined {
  return raw === 'this' || raw === 'following' || raw === 'series' ? raw : undefined
}

export interface NeutralTool {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema (object)
}

const TAG_SCHEMA = { type: 'string', enum: ['work', 'private', 'health', 'rest'] } as const

/** #343: the recurring-edit scope for edit_block/remove_blocks. Pass it only
    when the user's ask makes the scope explicit ("just this one", "from now on",
    "all of them"); omit it on a repeating block and the executor asks with
    this/following/series chips rather than guessing. */
const SCOPE_SCHEMA = {
  type: 'string',
  enum: ['this', 'following', 'series'],
  description:
    "For a recurring block only — how far the change reaches: 'this' = the one occurrence, 'following' = this and every later one (splits the series), 'series' = all of them. Omit unless the user made the scope explicit; the executor asks with chips otherwise.",
} as const

/** The plan-mode tool (#293), parameterized on the auto-offer floor: 'auto'
    offers the picker at three or more items, 'always' already at two (the
    Settings gear — mewTools() below swaps the wording; 'off' drops the tool).
    One builder so the two modes can never drift in anything but the floor. */
function proposeScenariosTool(threshold: 'three' | 'two'): NeutralTool {
  return {
    name: 'propose_scenarios',
    description:
      `Lay a multi-task ask out as named week-scenarios the user picks from — call it INSTEAD of plan_blocks when one message carries ${threshold} or more separate plannable items with no pinned days or clock times ("deck, budget review, gym, inbox sweep this week"). Classify the batch into tasks and call ONCE with all of them: MEW renders 2–3 named placements as mini-week cards and the human picks; the pick places exactly the previewed blocks. Items the user pinned to an explicit day or time stay plan_blocks (their stated time is their judgment), and so does a one- or two-item ask. ` +
      `Chat-only — it changes nothing until the user picks. After calling it, END your turn: the pick (or their typed answer) arrives as the next user message.`,
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'One short line to sit above the cards, in your own voice ("three ways this week could hold it — pick the one that feels right"). Omit to let MEW phrase it.',
        },
        tasks: {
          type: 'array',
          description: 'The classified braindump — one entry per plannable item.',
          items: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Short task title — no dates or times inside',
              },
              tag: {
                ...TAG_SCHEMA,
                description:
                  'walks/meals/family → private; appointments → health; recovery → rest; else work',
              },
              durationMin: {
                type: 'integer',
                description:
                  'Minutes needed, when the user said so. Omit otherwise — MEW sizes the task from their own history.',
              },
              dueMin: {
                type: 'integer',
                description:
                  'Hard same-day deadline in minutes from midnight ("due by 1pm" = 780) — the task must END by then, today.',
              },
              window: {
                type: 'string',
                enum: ['morning', 'afternoon', 'evening'],
                description: "The user's stated time of day, if any — every scenario honors it.",
              },
            },
            required: ['title', 'tag'],
            additionalProperties: false,
          },
        },
      },
      required: ['tasks'],
      additionalProperties: false,
    },
  }
}

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
              title: {
                type: 'string',
                description: 'Short block title — no dates or times inside',
              },
              tag: {
                ...TAG_SCHEMA,
                description:
                  'walks/meals/family → private; appointments → health; recovery → rest; else work',
              },
              dayOffset: {
                type: 'integer',
                description:
                  'Days from today (0 = today). Resolve weekday words against the context date.',
              },
              startMin: {
                type: 'integer',
                description:
                  'Start in minutes from midnight (9:00 = 540). Omit to auto-place in the first free slot.',
              },
              startStated: {
                type: 'boolean',
                description:
                  'True ONLY when startMin is a clock time the USER stated in their own words this turn ("dinner at 6"). Omit for a time YOU derived while packing or reshaping — MEW keeps derived meal times inside their healthy window and gap.',
              },
              durationMin: {
                type: 'integer',
                description:
                  'Duration in minutes. Default 60; "morning" = startMin 540, durationMin 180 unless the user says otherwise; "afternoon" ≈ 240 from 780.',
              },
              durationStated: {
                type: 'boolean',
                description:
                  'True ONLY when durationMin is a length the USER stated in their own words this turn ("30 min, exactly", "a two-hour block"). Omit for a length YOU chose or a default — MEW may then offer to size it to how the kind really runs, and a stated length is never touched.',
              },
              protected: {
                type: 'boolean',
                description:
                  'Default true — except short rests (≤20 min), which default false so reshaping can absorb them.',
              },
              attention: {
                type: 'string',
                enum: ['focus', 'background'],
                description:
                  'background = holds the clock, not the user (a 3h restore): never the Focus center, transparent to slot search. Default focus.',
              },
              dueMin: {
                type: 'integer',
                description:
                  'Hard deadline in minutes from midnight, independent of the end time ("due by 1pm" = 780). MEW watches the latest start.',
              },
              recurrence: {
                type: 'object',
                description:
                  'Make this a repeating block ("gym every Monday and Wednesday until end of August", "standup every weekday for 6 weeks"). dayOffset/startMin set the FIRST occurrence; MEW expands the rest itself — do NOT add one place per day. Daily and weekly only.',
                properties: {
                  freq: {
                    type: 'string',
                    enum: ['DAILY', 'WEEKLY'],
                    description:
                      'DAILY repeats every day (or every N with interval); WEEKLY repeats on the byday weekdays.',
                  },
                  interval: {
                    type: 'integer',
                    description: 'Repeat every N days/weeks (default 1; "every other week" = 2).',
                  },
                  until: {
                    type: 'string',
                    description:
                      'Inclusive last date YYYY-MM-DD ("until end of August" = that year\'s 08-31). Omit for open-ended.',
                  },
                  count: {
                    type: 'integer',
                    description:
                      'Stop after this many occurrences ("for 12 weeks" with two weekdays = count 24, or use until). Omit for open-ended.',
                  },
                  byday: {
                    type: 'string',
                    description:
                      'WEEKLY only: comma-separated weekdays MO,TU,WE,TH,FR,SA,SU ("Monday and Wednesday" = "MO,WE"). Omit ⇒ repeats on the first occurrence\'s own weekday.',
                  },
                },
                required: ['freq'],
                additionalProperties: false,
              },
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
  proposeScenariosTool('three'), // the 'auto' default; mewTools() below regears it
  {
    name: 'complete_task',
    description:
      'Mark an existing block done (a mew) when the user says they finished, did, or completed something. The query is matched against block titles; when several share a title, pass `at` (its start time) to mark the right one.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A few words from the block title, e.g. "deck"' },
        at: {
          type: 'string',
          description:
            'Start time of the intended block ("9:00", "9am") — pins which when several share the title',
        },
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
        at: {
          type: 'string',
          description:
            "The block's CURRENT start time ('19:45', '7am') — pins which of several same-named blocks to move. Distinct from toStartMin (its new start).",
        },
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
      "Change an existing block in place — its start/end time, duration, title, tag, attention, or due — when the user asks to resize, shorten, extend, retime ('wake should be 6:00–6:30', 'make the release 45 minutes'), rename, retag, demote to background ('let it run'), or set a deadline. It changes ONLY the field(s) you pass on the ONE target and never disturbs neighbors (a rename touches just the title). Editing keeps the block's identity and history, so prefer it over re-creating; a rename or retime of a done block is fine and keeps its ✓. Events from connected calendars are taken over when edited (they detach from the calendar). For a REPEATING block, pass `scope` only if the user made the reach explicit ('just this one', 'from now on', 'all of them'); otherwise omit it and the executor asks just this one / this & following / the whole series.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A few words from the block title' },
        at: {
          type: 'string',
          description:
            "The TARGET block's CURRENT start time ('19:45', '7am') — pins which of several same-named blocks to change. Distinct from startMin (its new start).",
        },
        startMin: { type: 'integer', description: 'New start, minutes from midnight' },
        endMin: { type: 'integer', description: 'New end, minutes from midnight' },
        durationMin: { type: 'integer', description: 'New duration in minutes (keeps the start)' },
        title: { type: 'string', description: 'New title' },
        tag: { ...TAG_SCHEMA, description: 'New tag' },
        attention: {
          type: 'string',
          enum: ['focus', 'background'],
          description: 'background = holds the clock, not the user; focus = holds the user again',
        },
        dueMin: {
          type: 'integer',
          description: 'Hard deadline, minutes from midnight — independent of the end time',
        },
        scope: SCOPE_SCHEMA,
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
        notBeforeMin: {
          type: 'integer',
          description: 'Earliest acceptable start, minutes from midnight',
        },
        notAfterMin: {
          type: 'integer',
          description: 'Latest acceptable END, minutes from midnight ("before 5pm" = 1020)',
        },
      },
      required: ['durationMin'],
      additionalProperties: false,
    },
  },
  {
    name: 'suggest_slots',
    description:
      "Rank the best places to put a flexible task BEFORE scheduling or moving it: returns conflict-free candidate slots scored for time-of-day fit, breathing room around other work, and the user's standing rules. Read-only — changes nothing. Call it for any 'when should X go', 'fit X in', or reschedule decision, then plan_blocks (or move_task) the slot it ranks first. A same-day deadline (dueMin) confines the search to today.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title — what you intend to place' },
        tag: {
          ...TAG_SCHEMA,
          description:
            'walks/meals/family → private; appointments → health; recovery → rest; else work',
        },
        durationMin: { type: 'integer', description: 'Minutes needed (default 60)' },
        dueMin: {
          type: 'integer',
          description:
            'Optional same-day deadline, minutes from midnight — confines candidates to today',
        },
        window: {
          type: 'string',
          enum: ['morning', 'afternoon', 'evening'],
          description: 'Optional preferred time of day',
        },
      },
      required: ['title', 'durationMin'],
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
      'Take a specific block off the week — when the user asks to drop, remove, delete, or cancel a named one ("drop the prod release"). By default this removes the single intended block. When several blocks share that title, pass `at` (its start time) to identify which one — resolve "the larger/earlier/morning one" to a clock time from the week context you already see. Set `all:true` ONLY when the user explicitly says "both/all/every" ("drop both prod release blocks"); for a recurring block, `all:true` also clears the whole repeating series ("cancel all my gym sessions"), while a single delete leaves the rest of the series in place. For a REPEATING block where the user did NOT say how far the delete reaches, omit `scope` — the executor asks just this one / this & following / the whole series; pass `scope` ("this"/"following"/"series") only when they made it explicit. For wiping a whole day or week, clear_blocks is the broom.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A few words from the block title' },
        at: {
          type: 'string',
          description:
            'Start time of the one to remove ("22:30", "10am") — pins which when several share the title',
        },
        all: {
          type: 'boolean',
          description:
            'Remove every match, not just one. Default false; set true only on an explicit "both/all".',
        },
        scope: SCOPE_SCHEMA,
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'clear_blocks',
    description:
      'Sweep a whole scope clean when the user asks to clear, clean up, wipe, or reset their calendar/week, or to start over and re-plan. For one or a few named blocks, reach for remove_blocks instead — this broom takes the whole scope. Done blocks (their mews) and events from connected calendars always survive a clear; the tool result tells you what was kept. Call this before re-planning when they ask for a fresh start.',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['today', 'tomorrow', 'week', 'upcoming'],
          description:
            '"week" = the rest of this week; "upcoming" = everything from today forward (default for "clean up my calendar")',
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
          description:
            'time-default = when it usually starts · duration-default = how long it really takes · flexibility = can it move · ordering = what comes before/after what · fact = anything else durable',
        },
        match: {
          type: 'string',
          description: 'What the rule is about — "gym", "order lunch", "deep work"',
        },
        value: {
          type: 'string',
          description: 'The rule itself — "starts 07:00", "45m", "never moves", "before standup"',
        },
        stated: { type: 'string', description: "The user's own words, verbatim" },
      },
      required: ['kind', 'match', 'value', 'stated'],
      additionalProperties: false,
    },
  },
  {
    name: 'query_brain',
    description:
      "Answer a HISTORY or entity question from what MEW has seen: 'how much time has X taken this week', 'how were my gym sessions last week', 'when did I last meet Y', 'what happened with Z'. Time sums come from real blocks of the week the question names — 'last week' / 'N weeks ago' reach back through kept history, no time phrase means the current week; recall comes from the brain. NOT for the live moment — the week context already says what's now and next.",
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description:
            "The question, naming the project/person/task it's about — keep the user's own time phrase ('last week', 'two weeks ago') in it",
        },
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'offer_choices',
    description:
      'Ask an enumerable question as clickable chips in the chat — one tool for both your questions ("which gym block?") and your offers ("15:00, 16:30, or pick for me?"). Use it whenever the user must choose among a few known answers, instead of asking in prose; chips are a shortcut, never a gate — typing still works. 2–5 short options; give each a reply that is a complete ask you could act on next turn ("remove the 7:00 gym", never a bare "yes"). Chat-only — it changes nothing on the week. After calling it, END your turn: the pick arrives as the next user message.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'The question the chips answer — it renders as the chat line right above them, in your own voice',
        },
        options: {
          type: 'array',
          description: 'The tappable options, in display order (2–5).',
          items: {
            type: 'object',
            properties: {
              label: {
                type: 'string',
                description: 'Chip text — a few words ("the 7:00", "both", "pick for me")',
              },
              reply: {
                type: 'string',
                description:
                  'What a pick says as the user\'s next message — a complete, actionable ask ("remove the 7:00 gym"). Defaults to the label.',
              },
            },
            required: ['label'],
            additionalProperties: false,
          },
        },
      },
      required: ['prompt', 'options'],
      additionalProperties: false,
    },
  },
  {
    name: 'undo_last_action',
    description:
      'Reverse YOUR most recent change this exchange — the graceful "undo that" when the user catches a misclick or a wrong placement ("no, put it back", "that was wrong"). It rolls the blocks just placed/moved/removed back to how they were before that one call and drops any note logged with it; the tool result names what it took back ("removed the 3 blocks you just placed"). It reaches only the last action, not the whole history, and changes nothing if you have not acted yet. Chat stays — your reply about the undone action remains as context.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'list_blocks',
    description:
      'See a day\'s (or the whole week\'s) blocks as an itemized list — each block\'s exact title, start–end, tag, and status, with a ✓ on the ones already done (a done block is still there, just finished — never gone). Read-only: it changes nothing. Call it whenever the user asks what\'s on ("show me today", "what\'s on this week", "what do I have at 3?"), and BEFORE editing, moving, or removing a block whose target is at all ambiguous: the exact title and start time it returns are what edit_block, move_task, and remove_blocks target by, so listing first is how you act on the right block instead of guessing by name.',
    parameters: {
      type: 'object',
      properties: {
        day: {
          type: 'string',
          description:
            "Which day to list: 'today' (default), 'tomorrow', 'week' for the seven days ahead, or a day offset as a string ('2' = two days out). Omit for today.",
        },
        tag: {
          ...TAG_SCHEMA,
          description: 'Optional filter — list only blocks of this tag.',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'resize_block',
    description:
      "Change an existing block's LENGTH while keeping its start time fixed — the dedicated resize. Reach for it when the user wants a block longer or shorter without retiming it ('make the deck 30 min longer', 'give the review another 15', 'resize standup to 45'). Pass durationMin for an absolute length, or deltaMin for a relative change (+30 = longer, −15 = shorter). The start never moves; only the end shifts, so this is cleaner than edit_block when only the duration changes. For a REPEATING block, pass scope only when the user made the reach explicit ('just this one', 'from now on', 'all of them'); otherwise omit it and the executor asks this one / this & following / the whole series. Target by a few words of the title, plus `at` (its current start) when several share the title.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A few words from the block title' },
        at: {
          type: 'string',
          description:
            "The TARGET block's CURRENT start time ('19:45', '7am') — pins which of several same-named blocks to resize",
        },
        durationMin: {
          type: 'integer',
          description: 'New absolute length in minutes (keeps the start)',
        },
        deltaMin: {
          type: 'integer',
          description:
            'Relative change in minutes, signed: +30 makes it 30 min longer, −15 makes it 15 min shorter',
        },
        scope: SCOPE_SCHEMA,
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'duplicate_block',
    description:
      "Copy an existing block to another day and/or time — the original stays exactly where it is; the copy is a NEW, independent block with the same title, tag, length, and attention. Use it for 'duplicate the deck to friday', 'same as monday but on wednesday', 'put another standup at 4pm'. Give toDayOffset and/or toStartMin for where the copy lands; omit the time to keep the source's clock on the new day (or the next free slot when copying within the same day). Pass recurrence to make the copy a repeating series ('every weekday'), expanded and linked like a planned recurrence. Events from a connected calendar can be duplicated — the copy is yours to shape; the original calendar event is untouched. To RESCHEDULE something that already exists, use move_task or move_relative — this leaves a second block on purpose.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A few words from the SOURCE block title' },
        at: {
          type: 'string',
          description:
            "The SOURCE block's CURRENT start time ('19:45', '7am') — pins which of several same-named blocks to copy",
        },
        toDayOffset: {
          type: 'integer',
          description:
            'Target day for the copy, days from today (0 = today). Omit to keep the source day.',
        },
        toStartMin: {
          type: 'integer',
          description:
            'Target start for the copy, minutes from midnight. Omit to keep the source clock time (or auto-place within the same day).',
        },
        recurrence: {
          type: 'object',
          description:
            "Make the copy a repeating block ('duplicate it every weekday', 'copy to mondays until August'). DAILY/WEEKLY only; MEW expands and links the occurrences itself — do NOT add one call per day.",
          properties: {
            freq: { type: 'string', enum: ['DAILY', 'WEEKLY'] },
            interval: { type: 'integer', description: 'Every N days/weeks (default 1)' },
            until: { type: 'string', description: 'Inclusive last date YYYY-MM-DD' },
            count: { type: 'integer', description: 'Stop after this many occurrences' },
            byday: {
              type: 'string',
              description: 'WEEKLY only: comma-separated weekdays MO,TU,WE,TH,FR,SA,SU',
            },
          },
          required: ['freq'],
          additionalProperties: false,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'move_relative',
    description:
      "Nudge an existing block without naming an absolute time — 'a bit earlier', 'push it later', 'move it to the next day', 'find it the next free slot'. Set direction: 'earlier'/'later' shift the start on the SAME day by amountMin (default 30); 'next_day' moves it one day later at the same clock time; 'next_free' relocates it to the soonest genuinely clear slot from now. When the user DOES give an absolute target ('move it to 3pm', 'to friday'), use move_task instead. Fixed and calendar events are never moved, and the next free slot always lands clear of them. Target by a few words of the title, plus `at` (its current start) when several share the title.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A few words from the block title' },
        direction: {
          type: 'string',
          enum: ['earlier', 'later', 'next_day', 'next_free'],
          description:
            'earlier/later = shift the start on the same day; next_day = one day later, same time; next_free = the soonest clear slot from now',
        },
        amountMin: {
          type: 'integer',
          description: 'For earlier/later only: how many minutes to shift (default 30)',
        },
        at: {
          type: 'string',
          description:
            "The TARGET block's CURRENT start time ('19:45', '7am') — pins which of several same-named blocks to nudge",
        },
      },
      required: ['query', 'direction'],
      additionalProperties: false,
    },
  },
  {
    name: 'give_room',
    description:
      "Give the just-placed blocks of one kind ROOM — resize them longer, in place, by the factor the user's OWN completion history shows for that kind (deep work runs over; batched admin usually doesn't). Call this ONLY to answer MEW's own 'your deep-work blocks tend to run long — give them room?' offer (the user tapped 'give them room' or typed 'give my deep-work blocks room'), or when the user explicitly asks to size a kind to how it really runs. Do NOT volunteer it. Blocks whose length the user stated are never touched.",
    parameters: {
      type: 'object',
      properties: {
        focusClass: {
          type: 'string',
          enum: ['deep', 'admin', 'health'],
          description:
            "Which kind to give room: 'deep' (deep work), 'admin' (low-focus/errand/quick), or 'health'. Match the kind named in the offer.",
        },
      },
      required: ['focusClass'],
      additionalProperties: false,
    },
  },
]

/** The advertised registry under a planMode gear (#293): 'auto' is MEW_TOOLS
    itself, 'always' lowers propose_scenarios' floor to two items, 'off' drops
    the tool entirely — a model that can't see it can't call it, so 'off' IS
    the pre-picker behavior with no executor-side refusal choreography. */
export function mewTools(planMode: PlanMode = 'auto'): NeutralTool[] {
  if (planMode === 'off') return MEW_TOOLS.filter((t) => t.name !== 'propose_scenarios')
  if (planMode === 'always')
    return MEW_TOOLS.map((t) => (t.name === 'propose_scenarios' ? proposeScenariosTool('two') : t))
  return MEW_TOOLS
}

export async function runTool(name: string, input: unknown, exec: ToolExecutor): Promise<string> {
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
          startStated: p.startStated === true ? true : undefined,
          durationMin: optInt(p.durationMin, 15, 600),
          durationStated: p.durationStated === true ? true : undefined,
          protected: typeof p.protected === 'boolean' ? p.protected : undefined,
          attention: p.attention === 'background' ? ('background' as const) : undefined,
          due: optInt(p.dueMin, 0, 1439),
          rrule: parseRecurrence(p.recurrence),
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
      return exec.complete(String(o.query ?? ''), atArg(o.at))
    case 'move_task':
      return exec.move(
        String(o.query ?? ''),
        optInt(o.toDayOffset, 0, 13),
        optInt(o.toStartMin, 0, 1439),
        undefined, // relStartMin: a keyed tool call always sends an absolute target
        atArg(o.at)
      )
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
      if ((['work', 'private', 'health', 'rest'] as const).includes(o.tag as never))
        patch.tag = o.tag as 'work'
      if (o.attention === 'background' || o.attention === 'focus') patch.attention = o.attention
      const due = optInt(o.dueMin, 0, 1439)
      if (due != null) patch.due = due
      return exec.edit(String(o.query ?? ''), patch, atArg(o.at), recurScope(o.scope))
    }
    case 'find_slot':
      return exec.findSlot(
        clampInt(o.durationMin, 5, 600, 30),
        clampInt(o.dayOffset, 0, 13, 0),
        optInt(o.notBeforeMin, 0, 1439),
        optInt(o.notAfterMin, 1, 1440)
      )
    case 'suggest_slots': {
      const win = (['morning', 'afternoon', 'evening'] as const).includes(o.window as never)
        ? (o.window as 'morning')
        : undefined
      const tag = (['work', 'private', 'health', 'rest'] as const).includes(o.tag as never)
        ? (o.tag as 'work')
        : 'work'
      return exec.suggestSlots(
        String(o.title ?? '').trim(),
        tag,
        clampInt(o.durationMin, 5, 600, 60),
        optInt(o.dueMin, 0, 1439),
        win
      )
    }
    case 'analyze_day':
      return exec.analyze(clampInt(o.dayOffset, 0, 13, 0))
    case 'remove_blocks': {
      const at = atArg(o.at)
      const all = o.all === true
      const scope = recurScope(o.scope)
      return exec.remove(String(o.query ?? ''), { at, all, ...(scope ? { scope } : {}) })
    }
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
    case 'query_brain': {
      const question = String(o.question ?? '').trim()
      if (!question) return 'nothing to look up — the call was empty'
      return exec.queryBrain(question)
    }
    case 'propose_scenarios': {
      const prompt = String(o.prompt ?? '').trim()
      const tasks = (Array.isArray(o.tasks) ? o.tasks : [])
        .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
        .filter((t) => typeof t.title === 'string' && (t.title as string).trim())
        .map((t) => ({
          title: String(t.title).trim(),
          tag: (['work', 'private', 'health', 'rest'] as const).includes(t.tag as never)
            ? (t.tag as 'work')
            : ('work' as const),
          durationMin: optInt(t.durationMin, 15, 600),
          due: optInt(t.dueMin ?? t.due, 0, 1439),
          window: (['morning', 'afternoon', 'evening'] as const).includes(t.window as never)
            ? (t.window as 'morning')
            : undefined,
        }))
      if (!tasks.length) return 'nothing to propose — the call needs at least one task'
      return exec.proposeScenarios(prompt, tasks)
    }
    case 'offer_choices': {
      const prompt = String(o.prompt ?? '').trim()
      const options = (Array.isArray(o.options) ? o.options : [])
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .filter((c) => typeof c.label === 'string' && (c.label as string).trim())
        .slice(0, 5) // a hand of chips, not a menu — five is the law (#254)
        .map((c) => {
          const label = String(c.label).trim()
          const reply =
            typeof c.reply === 'string' && (c.reply as string).trim()
              ? String(c.reply).trim()
              : label
          return { label, reply }
        })
      if (!prompt || !options.length)
        return 'nothing to offer — the call needs a prompt and at least one option'
      return exec.offerChoices(prompt, options)
    }
    case 'undo_last_action':
      return exec.undoLast()
    case 'list_blocks': {
      const tag = (['work', 'private', 'health', 'rest'] as const).includes(o.tag as never)
        ? (o.tag as 'work')
        : undefined
      return exec.listBlocks(parseListDay(o.day), tag)
    }
    case 'resize_block': {
      const durationMin = optInt(o.durationMin, 5, 720)
      const relDurationMin = optInt(o.deltaMin, -600, 600)
      if (durationMin == null && relDurationMin == null)
        return 'nothing to resize — pass a durationMin or a deltaMin'
      return exec.resize(
        String(o.query ?? ''),
        { durationMin, relDurationMin },
        atArg(o.at),
        recurScope(o.scope)
      )
    }
    case 'duplicate_block':
      return exec.duplicate(
        String(o.query ?? ''),
        {
          toDayOffset: optInt(o.toDayOffset, 0, 13),
          toStartMin: optInt(o.toStartMin, 0, 1439),
          rrule: parseRecurrence(o.recurrence),
        },
        atArg(o.at)
      )
    case 'move_relative': {
      const dirs = ['earlier', 'later', 'next_day', 'next_free'] as const
      const direction = dirs.includes(o.direction as never)
        ? (o.direction as (typeof dirs)[number])
        : null
      if (!direction)
        return 'nothing to move — pass a direction (earlier, later, next_day, next_free)'
      return exec.relativeMove(
        String(o.query ?? ''),
        direction,
        optInt(o.amountMin, 5, 600),
        atArg(o.at)
      )
    }
    case 'give_room': {
      const classes = ['deep', 'admin', 'health'] as const
      const focusClass = classes.includes(o.focusClass as never)
        ? (o.focusClass as (typeof classes)[number])
        : null
      if (!focusClass) return 'nothing to size — name the kind (deep, admin, or health)'
      return exec.giveRoom(focusClass)
    }
    default:
      return `unknown tool: ${name}`
  }
}
