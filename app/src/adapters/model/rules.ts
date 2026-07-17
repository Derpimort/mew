/* The deterministic floor — no key, no network, no model. Talk-to-schedule
   still works through the grammar in domain/parse.ts; replies are templated.
   Ollama shares runIntent() so a weak local model gets the same composer. */

import { insightsCard } from '../../domain/insights'
import { ritualTasks } from '../../domain/nudges/weekly'
import { inferTag, parseCommand as ruleParse } from '../../domain/parse'
import { normalizeRrule } from '../../domain/recurrence'
import { parseSplitAsk, type SplitAsk } from '../../domain/rescue'
import { weekdayOffset } from '../../domain/time'
import type { PlanMode, ScheduleIntent } from '../../domain/types'
import {
  CHOICES_POSTED,
  type ChatTurn,
  type ModelPort,
  type ToolExecutor,
  type WeekContext,
} from './types'

const CHAT_REPLIES: [RegExp, (ctx: WeekContext) => string][] = [
  [
    /how('s| is| does| did| was) (my |the )?(week|day|today)|what (do you|does mew) know|insights?|patterns?/i,
    (ctx) =>
      ctx.insightLines.length
        ? `Here's what your history says: ${ctx.insightLines.join('; ')}.`
        : `Flip to Week for the honest picture. Give me a few days of history and I'll start right-sizing with your own numbers.`,
  ],
  [/thank/i, () => `Anytime. Mewing away.`],
  [
    /^(hi|hey|hello|yo|good (morning|afternoon|evening))\b/i,
    (ctx) =>
      `Hey. ${ctx.mewsToday > 0 ? `${ctx.mewsToday} mew${ctx.mewsToday === 1 ? '' : 's'} in already — ` : ''}what should the week hold?`,
  ],
  [/^(ok(ay)?|cool|nice|great|good)\b/i, () => `Good. Mewing away.`],
]

/** Apply a parsed intent through the executor; returns the reply text.
    Shared by the rules and Ollama adapters. */
export function runIntent(
  intent: ScheduleIntent,
  exec: ToolExecutor,
  ctx: WeekContext,
  rawText: string,
  planMode: PlanMode = 'auto'
): string {
  switch (intent.kind) {
    case 'plan': {
      const places = intent.places ?? []
      const frees = intent.frees ?? []
      /* plan mode's keyless gear (#293): a braindump of separate, un-pinned
         items goes through the scenario picker instead of the one-pass place.
         Un-pinned means the USER decided nothing the picker would discard —
         no stated time, day, recurrence, or background hold; a single pinned
         item (or any kept-free window) keeps the whole ask on today's path,
         so an explicit time is never quietly re-derived. The floor is the
         same the model reads from its tool description: three items on
         'auto', two on 'always', never on 'off'. */
      const unpinned = (p: (typeof places)[number]) =>
        p.startMin == null && p.dayOffset == null && !p.rrule && p.attention !== 'background'
      const floor = planMode === 'always' ? 2 : 3
      if (planMode !== 'off' && !frees.length && places.length >= floor && places.every(unpinned)) {
        const out = exec.proposeScenarios(
          '',
          places.map((p) => ({
            title: p.title,
            tag: p.tag,
            durationMin: p.durationMin,
            due: p.due,
          }))
        )
        /* the executor may have posted the picker (#254 pattern): its result
           then addresses a model — the floor stays quiet, the cards ARE the
           reply. A fall-through line (single shape, nothing fits) speaks. */
        return out.startsWith(CHOICES_POSTED) ? '' : out
      }
      return exec.plan(
        places.map((p) => ({
          title: p.title,
          tag: p.tag,
          dayOffset: p.dayOffset ?? 0,
          startMin: p.startMin,
          durationMin: p.durationMin,
          protected: p.protected,
          attention: p.attention,
          due: p.due,
          rrule: p.rrule,
        })),
        frees.map((f) => ({
          dayOffset: /^\d+$/.test(f.dayKey) ? Number(f.dayKey) : 0,
          startMin: f.startMin,
          endMin: f.endMin,
        }))
      )
    }
    case 'complete':
      return exec.complete(intent.query ?? '')
    case 'move':
      return exec.move(
        intent.query ?? '',
        intent.toDayKey != null && /^\d+$/.test(intent.toDayKey)
          ? Number(intent.toDayKey)
          : undefined,
        intent.toStartMin
      )
    case 'capture':
      return exec.capture(intent.title ?? '')
    case 'clear':
      return exec.clear(intent.scope ?? 'upcoming')
    case 'edit':
      return exec.edit(intent.query ?? '', intent.edit ?? {})
    case 'remember':
      return intent.pref
        ? exec.remember(intent.pref)
        : 'nothing to remember — the rule needs a subject and a value'
    case 'remove': {
      const out = exec.remove(intent.query ?? '', intent.remove ?? {})
      /* the executor may have asked "which one?" as clickable chips (#254);
         its result then addresses a model, not the user — the floor stays
         quiet and the chips message IS the reply (empty yields never post). */
      return out.startsWith(CHOICES_POSTED) ? '' : out
    }
    case 'chat': {
      if (intent.reply) return intent.reply
      const hit = CHAT_REPLIES.find(([re]) => re.test(rawText))
      return hit
        ? hit[1](ctx)
        : `I can place that for you — try "block thursday morning for the deck", "move the deck to friday", or "done with the walk". (Connect a key in Settings and I'll understand more.)`
    }
    case 'insights': {
      /* read-only, keyless by construction: the same presenter the Settings
         card renders (#287) — one source, two skins, identical numbers. The
         executor is never touched; showing the science changes nothing. */
      const card = ctx.insights ? insightsCard(ctx.insights) : null
      return card
        ? [card.title, ...card.rows.map((r) => `${r.label}: ${r.value}`)].join('\n')
        : `still learning your week — check back friday`
    }
  }
}

/** Execute a rescue split ask (#286) by composing the two EXISTING tools —
    shrink the block to end where the gap opens (edit), then place the kept
    tail after it (plan) — the same two calls a keyed model makes from the
    same words. No new mutation path: the executor's tools stay the only way
    the week changes. The tail gets a distinct base title because execPlan
    de-dups on exact base (#89) and would otherwise MOVE the piece just
    shrunk instead of placing a second one. */
export function runSplit(ask: SplitAsk, exec: ToolExecutor, now: Date): string {
  const dayOffset =
    ask.dayWord == null
      ? 0
      : ask.dayWord === 'tomorrow'
        ? 1
        : (weekdayOffset(ask.dayWord, now) ?? 0)
  const shrunk = exec.edit(ask.query, { endMin: ask.gapStartMin })
  /* execEdit's miss shape is stable ("I couldn't find …") and pinned in tests:
     with no block to shrink, placing a stray tail would double time — stop. */
  if (shrunk.startsWith(`I couldn't find`)) return shrunk
  const placed = exec.plan(
    [
      {
        title: `${ask.query} (part 2)`,
        tag: inferTag(ask.query),
        dayOffset,
        startMin: ask.gapEndMin,
        durationMin: ask.tailMin,
        protected: true,
      },
    ],
    []
  )
  return `${shrunk} ${placed}`
}

/* "plan my week" / "plan the week" — the weekly ritual's ask (#304), typed or
   via the Sunday chip. Deliberately narrow: "plan my day" and every phrase
   carrying its own items stay with the grammar. */
const RITUAL_ASK = /^\s*plan\s+(?:my|the)\s+week\b/i

/** The keyless ritual route (#304): skip the shaping questions (a floor has
    none to ask) and go straight to the picker with the standing defaults —
    open captures as the top-priority answers, time-default rules as the
    habits, deep-work anchors from the realistic best. Pure composition of the
    EXISTING propose tool: generation is read-only, the pick is the one apply,
    and best-hours alignment rides execProposeScenarios' own insights. The
    route ignores the planMode gear on purpose — that gear governs the
    braindump auto-offer; an explicit "plan my week" is the user choosing the
    picker. */
function runRitual(ctx: WeekContext, exec: ToolExecutor): string {
  const out = exec.proposeScenarios(
    '',
    ritualTasks({
      realisticBestH: ctx.realisticBestH,
      captures: ctx.openCaptures ?? [],
      prefs: ctx.prefs ?? [],
    })
  )
  /* the picker posted (#254 pattern): the cards ARE the reply — stay quiet.
     A fall-through line (one shape, nothing fits) speaks. */
  return out.startsWith(CHOICES_POSTED) ? '' : out
}

export function createRulesAdapter(now: () => Date, planMode: PlanMode = 'auto'): ModelPort {
  return {
    id: 'rules',
    async *converse(thread: ChatTurn[], ctx: WeekContext, exec: ToolExecutor) {
      const last = [...thread].reverse().find((t) => t.role === 'user')?.text ?? ''
      /* the rescue split ask (#286) carries every concrete number and rides
         ahead of the grammar — parse.ts has no single intent for shrink+place */
      const split = parseSplitAsk(last)
      if (split) {
        yield runSplit(split, exec, now())
        return
      }
      /* the weekly ritual (#304) rides ahead of the grammar the same way —
         to the block clause, "plan my week" reads as placing "my week" */
      if (RITUAL_ASK.test(last)) {
        yield runRitual(ctx, exec)
        return
      }
      const intent = ruleParse(last, now())
      yield runIntent(intent, exec, ctx, last, planMode)
    },
  }
}

/** Shared post-parse guard so a weak model can't produce an unusable intent. */
export function sanitizeIntent(raw: unknown): ScheduleIntent | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const kind = o.kind
  if (kind === 'plan') {
    const places = Array.isArray(o.places) ? o.places : []
    const frees = Array.isArray(o.frees) ? o.frees : []
    const okPlaces = places
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .filter((p) => typeof p.title === 'string' && p.title.trim())
      .map((p) => ({
        title: String(p.title).trim(),
        tag: (['work', 'private', 'health', 'rest'] as const).includes(p.tag as never)
          ? (p.tag as 'work')
          : 'work',
        dayOffset: clampInt(p.dayOffset, 0, 13, 0),
        startMin: optInt(p.startMin, 0, 1439),
        durationMin: optInt(p.durationMin, 15, 600),
        protected: p.protected !== false,
        attention: p.attention === 'background' ? ('background' as const) : undefined,
        due: optInt(p.dueMin ?? p.due, 0, 1439),
        rrule: normalizeRrule(p.recurrence ?? p.rrule) ?? undefined,
      }))
    const okFrees = frees
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
      .map((f) => ({
        dayKey: String(clampInt(f.dayOffset, 0, 13, 0)),
        startMin: clampInt(f.startMin, 0, 1439, 13 * 60),
        endMin: clampInt(f.endMin, 0, 1439, 17 * 60),
        label: typeof f.label === 'string' ? f.label : 'kept free',
      }))
    if (!okPlaces.length && !okFrees.length) return null
    return { kind: 'plan', places: okPlaces, frees: okFrees }
  }
  if (kind === 'complete' && typeof o.query === 'string') return { kind, query: o.query }
  if (kind === 'move' && typeof o.query === 'string')
    return {
      kind,
      query: o.query,
      toDayKey: o.toDayOffset != null ? String(clampInt(o.toDayOffset, 0, 13, 0)) : undefined,
      toStartMin: optInt(o.toStartMin, 0, 1439),
    }
  if (kind === 'capture' && typeof o.title === 'string') return { kind, title: o.title }
  if (kind === 'remove' && typeof o.query === 'string' && o.query.trim()) {
    const at = typeof o.at === 'string' && o.at.trim() ? o.at.trim() : undefined
    const all = o.all === true
    return { kind, query: o.query, ...(at || all ? { remove: { at, all } } : {}) }
  }
  if (kind === 'edit' && typeof o.query === 'string') {
    const e = (o.edit && typeof o.edit === 'object' ? o.edit : {}) as Record<string, unknown>
    const edit: NonNullable<ScheduleIntent['edit']> = {}
    const sm = optInt(e.startMin, 0, 1439)
    const em = optInt(e.endMin, 1, 1440)
    const dm = optInt(e.durationMin, 5, 720)
    if (sm != null) edit.startMin = sm
    if (em != null) edit.endMin = em
    if (dm != null) edit.durationMin = dm
    if (typeof e.title === 'string' && e.title.trim()) edit.title = e.title.trim()
    if (e.attention === 'background' || e.attention === 'focus') edit.attention = e.attention
    const due = optInt(e.dueMin ?? e.due, 0, 1439)
    if (due != null) edit.due = due
    if (!Object.keys(edit).length) return null
    return { kind, query: o.query, edit }
  }
  if (kind === 'clear') {
    const scopes = ['today', 'tomorrow', 'week', 'upcoming'] as const
    return { kind, scope: scopes.includes(o.scope as never) ? (o.scope as 'today') : 'upcoming' }
  }
  if (kind === 'remember') {
    const pr = (o.pref && typeof o.pref === 'object' ? o.pref : {}) as Record<string, unknown>
    const kinds = ['time-default', 'duration-default', 'flexibility', 'ordering', 'fact'] as const
    const match = typeof pr.match === 'string' ? pr.match.trim() : ''
    const value = typeof pr.value === 'string' ? pr.value.trim() : ''
    if (!match || !value) return null
    return {
      kind,
      pref: {
        kind: kinds.includes(pr.kind as never) ? (pr.kind as (typeof kinds)[number]) : 'fact',
        match,
        value,
        stated:
          typeof pr.stated === 'string' && pr.stated.trim()
            ? pr.stated.trim()
            : `${match} ${value}`,
      },
    }
  }
  if (kind === 'chat') return { kind, reply: typeof o.reply === 'string' ? o.reply : undefined }
  if (kind === 'insights') return { kind } // read-only; carries no fields
  return null
}

export function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' ? Math.round(v) : Number.NaN
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : dflt
}
export function optInt(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'number' ? Math.round(v) : Number.NaN
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : undefined
}
