/* The deterministic floor — no key, no network, no model. Talk-to-schedule
   still works through the grammar in domain/parse.ts; replies are templated.
   Ollama shares runIntent() so a weak local model gets the same composer. */

import { parseCommand as ruleParse } from '../../domain/parse'
import type { ScheduleIntent } from '../../domain/types'
import type { ChatTurn, ModelPort, ToolExecutor, WeekContext } from './types'

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
): string {
  switch (intent.kind) {
    case 'plan':
      return exec.plan(
        (intent.places ?? []).map((p) => ({
          title: p.title,
          tag: p.tag,
          dayOffset: p.dayOffset ?? 0,
          startMin: p.startMin,
          durationMin: p.durationMin,
          protected: p.protected,
        })),
        (intent.frees ?? []).map((f) => ({
          dayOffset: /^\d+$/.test(f.dayKey) ? Number(f.dayKey) : 0,
          startMin: f.startMin,
          endMin: f.endMin,
        })),
      )
    case 'complete':
      return exec.complete(intent.query ?? '')
    case 'move':
      return exec.move(
        intent.query ?? '',
        intent.toDayKey != null && /^\d+$/.test(intent.toDayKey) ? Number(intent.toDayKey) : undefined,
        intent.toStartMin,
      )
    case 'capture':
      return exec.capture(intent.title ?? '')
    case 'clear':
      return exec.clear(intent.scope ?? 'upcoming')
    case 'edit':
      return exec.edit(intent.query ?? '', intent.edit ?? {})
    case 'remove':
      return exec.remove(intent.query ?? '')
    case 'chat': {
      if (intent.reply) return intent.reply
      const hit = CHAT_REPLIES.find(([re]) => re.test(rawText))
      return hit
        ? hit[1](ctx)
        : `I can place that for you — try "block thursday morning for the deck", "move the deck to friday", or "done with the walk". (Connect a key in Settings and I'll understand more.)`
    }
  }
}

export function createRulesAdapter(now: () => Date): ModelPort {
  return {
    id: 'rules',
    async *converse(thread: ChatTurn[], ctx: WeekContext, exec: ToolExecutor) {
      const last = [...thread].reverse().find((t) => t.role === 'user')?.text ?? ''
      const intent = ruleParse(last, now())
      yield runIntent(intent, exec, ctx, last)
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
  if (kind === 'remove' && typeof o.query === 'string' && o.query.trim()) return { kind, query: o.query }
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
    if (!Object.keys(edit).length) return null
    return { kind, query: o.query, edit }
  }
  if (kind === 'clear') {
    const scopes = ['today', 'tomorrow', 'week', 'upcoming'] as const
    return { kind, scope: scopes.includes(o.scope as never) ? (o.scope as 'today') : 'upcoming' }
  }
  if (kind === 'chat') return { kind, reply: typeof o.reply === 'string' ? o.reply : undefined }
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
