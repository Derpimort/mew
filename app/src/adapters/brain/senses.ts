/* Senses — pure mapping from what happens in MEW to brain pages. No I/O:
   the store decides WHEN to ingest; this decides WHAT a moment looks like
   as knowledge. Positive voice carries through ("rolled", never "missed"). */

import type { Block, ChatMessage } from '../../domain/types'
import { fmtTime } from '../../domain/time'
import type { BrainPage, PrefPayload } from './types'

/** brain-safe slugs: lowercase alnum + hyphens, collapsed and trimmed */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
}

const STOP_NAMES = new Set(['the', 'a', 'an', 'team', 'everyone', 'all', 'me', 'us', 'them'])

/** People a title names. Deliberate patterns only — guessing wrong people
    into the graph is worse than missing one:
    "interview — mira"          → mira
    "sync: jordan/remy"         → jatin, remy
    "1:1 with dana"               → dana                                   */
export function peopleFrom(title: string): string[] {
  const out = new Set<string>()
  const dash = title.match(/^(?:.*\b(?:interview|call|sync|meeting|1:1|chat|review)\b.*?)—\s*(.+)$/i)
  if (dash) {
    for (const part of dash[1].split(/[,/&]|\band\b/i)) {
      const name = slugify(part)
      if (name && !STOP_NAMES.has(name)) out.add(name)
    }
  }
  const colon = title.match(/\b(?:sync|call|meeting|1:1|standup)\s*:\s*(.+)$/i)
  if (colon) {
    for (const part of colon[1].split(/[,/&]|\band\b/i)) {
      const name = slugify(part)
      if (name && !STOP_NAMES.has(name)) out.add(name)
    }
  }
  const withM = title.match(/\bwith\s+([a-z][a-z'-]+)\s*$/i)
  if (withM) {
    const name = slugify(withM[1])
    if (name && !STOP_NAMES.has(name)) out.add(name)
  }
  return [...out].map((n) => `person/${n}`)
}

export function taskSlug(title: string): string {
  return `task/${slugify(title.split('—')[0].trim())}`
}

export type BlockEventKind = 'completed' | 'rolled' | 'interrupted'

/** A block event becomes: the day's timeline entry + an upserted task page
    linked to the day and any people the title names. */
export function blockEventPage(b: Block, kind: BlockEventKind, dayKey: string, atMin: number): BrainPage {
  const title = b.title.split('—')[0].trim()
  const dur = b.endMin - b.startMin
  const deep = b.tag === 'work' && dur >= 60
  const summary = `${fmtTime(atMin)} ${kind} — ${title} (${dur}m${deep ? ', deep' : ''})`
  const people = peopleFrom(b.title)
  return {
    slug: taskSlug(b.title),
    type: 'task',
    tags: [b.tag, kind],
    body: `# ${title}\n\nlast: ${kind} on ${dayKey} · planned ${fmtTime(b.startMin)}–${fmtTime(b.endMin)} (${dur}m)\n`,
    links: [`week/${dayKey}`, ...people],
    timeline: [{ slug: `week/${dayKey}`, date: dayKey, summary }],
  }
}

/** A standing rule becomes one pref page. The slug is kind+match, so
    restating the same rule upserts — newest wins, count stays one. The
    payload travels as fenced JSON; the human line keeps it readable. */
export function prefPage(p: PrefPayload): BrainPage {
  return {
    slug: `pref/${p.kind}-${slugify(p.match)}`,
    type: 'pref',
    tags: ['preference', p.kind],
    body: `${p.match} → ${p.value}\n\nstated: "${p.stated.trim()}"\n\n\`\`\`json\n${JSON.stringify(p)}\n\`\`\`\n`,
  }
}

/** Parse a pref page body back into its payload (null on anything off). */
export function parsePrefBody(body: string): PrefPayload | null {
  const m = body.match(/```json\s*\n([\s\S]*?)\n```/)
  if (!m) return null
  try {
    const p = JSON.parse(m[1]) as PrefPayload
    if (typeof p.match === 'string' && typeof p.value === 'string' && typeof p.kind === 'string') return p
    return null
  } catch {
    return null
  }
}

/** A batch of chat turns → one timeline-only write on the day page.
    Nudges never go in (engine chatter isn't the user's story). */
export function chatBatchPage(turns: ChatMessage[], dayKey: string): BrainPage | null {
  const said = turns.filter((t) => t.role === 'user' || t.role === 'mew')
  if (!said.length) return null
  return {
    slug: `week/${dayKey}`,
    timeline: said.map((t) => ({
      slug: `week/${dayKey}`,
      date: dayKey,
      summary: `${t.role === 'user' ? 'you' : 'mew'}: ${t.body.slice(0, 140)}`,
    })),
  }
}

/** 60s coalescing batcher for chat turns — pure factory, fake-timer friendly. */
export function makeChatBatcher(
  flush: (turns: ChatMessage[], dayKey: string) => void,
  delayMs = 60_000,
): { add(turn: ChatMessage, dayKey: string): void; flushNow(): void } {
  let pending: ChatMessage[] = []
  let pendingDay = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  const fire = () => {
    timer = null
    if (!pending.length) return
    const batch = pending
    const day = pendingDay
    pending = []
    flush(batch, day)
  }
  return {
    add(turn, dayKey) {
      /* a day rollover mid-batch flushes the old day first */
      if (pending.length && pendingDay !== dayKey) fire()
      pendingDay = dayKey
      pending.push(turn)
      if (!timer) timer = setTimeout(fire, delayMs)
    },
    flushNow() {
      if (timer) clearTimeout(timer)
      fire()
    },
  }
}
