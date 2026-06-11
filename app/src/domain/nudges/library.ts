/* The nudge library — a living research asset (PRD §5). Each nudge is data:
   trigger, phrasing in the user's own numbers, tone, footnote, cooldown.
   New research findings land here as new entries, not new code.
   Content source of truth: design_handoff_mew_mvp/mew-v4-research.jsx → NUDGES. */

import type { Block, Capture, NudgeAction, NudgeId } from '../types'
import type { LiveNow } from '../liveNow'
import type { MemoryAggregates } from '../memory'
import { heavyCarryWeeks } from '../memory'
import type { Insights } from '../insights'
import { addDaysKey, fmtDowLong, fmtTime, spell } from '../time'

export interface NudgeCtx {
  nowMs: number
  nowMin: number
  todayKey: string
  blocks: Block[]
  live: LiveNow
  agg: MemoryAggregates
  idleMin: number
  interruptionsLastHour: number
  guardUntilMin: number | null
  /* computed by the engine's context builder */
  heavyDay: { dayKey: string; plannedH: number } | null
  pastDayEnd: boolean
  eodOpen: Block | null
  eodProposal: { toDayKey: string; toStartMin: number } | null
  restCollision: { rest: Block; intruder: Block } | null
  restPlannedToday: Block | null
  /** A ≥45-min fixed event that ended in the last 12 min, nothing live now. */
  justEndedFixed: Block | null
  /* event payloads (set only on the matching event) */
  justCompleted: Block | null
  newCapture: Capture | null
  captureProposal: { dayKey: string; startMin: number } | null
  justCleared: { scope: string; count: number } | null
  /** finishing early: minutes reclaimed inside the completed block's window */
  earlyGapMin: number
  /** continuous work since the last rest today */
  workStreakMin: number
  breakDue: boolean
  /** something that fits the reclaimed gap */
  nextUp: { kind: 'block' | 'capture'; id: string; title: string; durMin: number } | null
  /* GBrain */
  insights: Insights
  /** Monday=0 … Sunday=6 (fresh-start landmark check). */
  dowMon0: number
  /** A chronic roller (≥3 rolls) that currently has an open block + a starter slot. */
  stalled: {
    title: string
    rolls: number
    blockId: string
    proposal: { dayKey: string; startMin: number } | null
  } | null
  /* outcome learning: trailing accept/decline per type → cooldown stretching */
  outcomeStats: Partial<Record<NudgeId, { accepted: number; declined: number }>>
  /* dedupe state */
  lastFired: Partial<Record<NudgeId, { ts: number; key?: string }>>
  lastDriftBlockId: string | null
}

export interface NudgeInstance {
  type: NudgeId
  label: string // "drift check-in" → rendered "NUDGE · DRIFT CHECK-IN"
  body: string
  footnote: string
  actions: NudgeAction[]
  payload: Record<string, string | number>
  key?: string // contextual dedupe key (dayKey, blockId, …)
}

export interface NudgeDef {
  id: NudgeId
  label: string
  tone: string
  cooldownMs: number
  trigger: (c: NudgeCtx) => boolean
  build: (c: NudgeCtx) => Omit<NudgeInstance, 'type' | 'label'>
}

const H = 60 * 60 * 1000

export const NUDGES: NudgeDef[] = [
  {
    id: 'right-size',
    label: 'right-size',
    tone: 'honest, warm',
    cooldownMs: 6 * H,
    trigger: (c) => c.heavyDay != null,
    build: (c) => {
      const d = c.heavyDay!
      const day = d.dayKey === c.todayKey ? 'today' : fmtDowLong(d.dayKey)
      return {
        body: `You've planned ${d.plannedH} hours of deep work ${day}; your realistic best has been about ${c.agg.realisticBestH}. Want me to right-size it?`,
        footnote: `People underestimate their own tasks by ~40% on average — you're in good company. (Buehler, Griffin & Ross, 1994)`,
        actions: [
          { id: 'rightsize', label: 'Right-size it', kind: 'primary' },
          { id: 'keep', label: 'Keep as is', kind: 'secondary' },
        ],
        payload: { dayKey: d.dayKey },
        key: d.dayKey,
      }
    },
  },
  {
    id: 'drift',
    label: 'drift check-in',
    tone: 'gentle, no blame',
    cooldownMs: 0.5 * H,
    trigger: (c) =>
      c.live.current != null &&
      c.idleMin >= 10 &&
      (c.guardUntilMin == null || c.nowMin >= c.guardUntilMin) &&
      c.lastDriftBlockId !== c.live.current.id &&
      c.live.current.tag !== 'rest',
    build: (c) => {
      const b = c.live.current!
      const base = b.title.split('—')[0].trim()
      return {
        body: `Still on ${base}, or should I move it? You've been off it ~${Math.round(c.idleMin)} minutes.`,
        footnote: `Interrupted work takes ~25 minutes and a couple of detour tasks to get back to — and the old task's attention residue clings to the new one. (Mark, González & Harris, 2005; Leroy, 2009)`,
        actions: [
          { id: 'still', label: 'Still on it', kind: 'primary' },
          { id: 'move', label: 'Move it', kind: 'secondary' },
          { id: 'guard', label: 'Guard block', kind: 'secondary' },
        ],
        payload: { blockId: b.id },
        key: b.id,
      }
    },
  },
  {
    id: 'guard',
    label: 'guard the block',
    tone: 'protective',
    cooldownMs: 1 * H,
    trigger: (c) =>
      c.interruptionsLastHour >= 3 &&
      c.live.current != null &&
      c.live.current.tag === 'work' &&
      (c.guardUntilMin == null || c.nowMin >= c.guardUntilMin),
    build: (c) => ({
      body: `Three switches inside the hour — each one drags the last task's residue along. Want me to guard the block?`,
      footnote: `Average screen attention fell from 2.5 minutes (2004) to ~47 seconds in recent studies; about 44% of interruptions are self-inflicted. (Mark, Attention Span, 2023)`,
      actions: [
        { id: 'guard', label: 'Guard the block', kind: 'primary' },
        { id: 'notnow', label: 'Not now', kind: 'secondary' },
      ],
      payload: { blockId: c.live.current!.id },
      key: c.live.current!.id,
    }),
  },
  {
    id: 'post-buffer',
    label: 'post-meeting buffer',
    tone: 'practical, while it is fresh',
    cooldownMs: 1 * H,
    trigger: (c) => c.justEndedFixed != null,
    build: (c) => {
      const b = c.justEndedFixed!
      const base = b.title.split('—')[0].trim()
      return {
        body: `${base} just wrapped. want fifteen minutes to write down the decisions and next steps while they're fresh?`,
        footnote: `Back-to-back work after meetings keeps stress elevated; a short buffer resets the brain — and what isn't written down intrudes until it is. (Microsoft Human Factors Lab, 2021; Masicampo & Baumeister, 2011)`,
        actions: [
          { id: 'buffer', label: '15 min — review & notes', kind: 'primary' },
          { id: 'skip', label: 'Not needed', kind: 'secondary' },
        ],
        payload: { blockId: b.id },
        key: b.id,
      }
    },
  },
  {
    id: 'celebrate',
    label: 'a mew',
    tone: 'celebratory, brief',
    cooldownMs: 0, // always fires, never skipped (PRD §5 #4)
    trigger: (c) => c.justCompleted != null,
    build: (c) => {
      const n = c.live.mewsToday
      const left = c.live.openToday
      const tail =
        left === 0
          ? ' The day is clear — rest is earned.'
          : left === 1
            ? ' One to go.'
            : ''
      return {
        body: `That's a mew — ${spell(n)} today.${tail}`,
        footnote: `Progress on meaningful work is the strongest motivator there is. (Amabile & Kramer, 2011)`,
        actions: [],
        payload: { blockId: c.justCompleted!.id },
      }
    },
  },
  {
    id: 'close-loop',
    label: 'close the loop',
    tone: 'calming, end-of-day',
    cooldownMs: 8 * H,
    trigger: (c) => c.pastDayEnd && c.eodOpen != null && c.eodProposal != null,
    build: (c) => {
      const b = c.eodOpen!
      const p = c.eodProposal!
      const base = b.title.split('—')[0].trim()
      /* tomorrow may have been full — name the day the slot actually lives on */
      const dayLabel =
        p.toDayKey === addDaysKey(c.todayKey, 1) ? 'tomorrow' : fmtDowLong(p.toDayKey)
      return {
        body: `${base} isn't done — shall it live ${dayLabel} at ${fmtTime(p.toStartMin)}? Then let it go for tonight.`,
        footnote: `Unfinished tasks intrude on the mind until they have a concrete plan — then it lets go. (Zeigarnik, 1927; Masicampo & Baumeister, 2011)`,
        actions: [
          { id: 'roll', label: `${dayLabel[0].toUpperCase()}${dayLabel.slice(1)} at ${fmtTime(p.toStartMin)}`, kind: 'primary' },
          { id: 'leave', label: 'Leave it open', kind: 'secondary' },
        ],
        payload: { blockId: b.id, toDayKey: p.toDayKey, toStartMin: p.toStartMin },
        key: c.todayKey,
      }
    },
  },
  {
    id: 'when-where',
    label: 'when & where',
    tone: 'practical',
    cooldownMs: 0, // event-driven per capture
    trigger: (c) => c.newCapture != null,
    build: (c) => {
      const cap = c.newCapture!
      const p = c.captureProposal
      const where = p
        ? `${p.dayKey === c.todayKey ? 'Today' : fmtDowLong(p.dayKey)} at ${fmtTime(p.startMin)} has room.`
        : `The week is full — want me to look at next week?`
      return {
        body: `Got it — '${cap.title}.' When should it live? ${where}`,
        footnote: `An if-then plan with a when and a where raises follow-through, d = .65 across 94 studies. (Gollwitzer & Sheeran, 2006)`,
        actions: p
          ? [
              { id: 'placecap', label: `${p.dayKey === c.todayKey ? 'Today' : fmtDowLong(p.dayKey)} ${fmtTime(p.startMin)}`, kind: 'primary' },
              { id: 'later', label: "I'll pick a time", kind: 'secondary' },
            ]
          : [{ id: 'later', label: "I'll pick a time", kind: 'secondary' }],
        payload: {
          captureId: cap.id,
          ...(p ? { dayKey: p.dayKey, startMin: p.startMin } : {}),
        } as Record<string, string | number>,
        key: cap.id,
      }
    },
  },
  {
    id: 'protect-rest',
    label: 'protect the rest',
    tone: 'firm but kind',
    cooldownMs: 12 * H,
    trigger: (c) =>
      c.restCollision != null || (c.agg.restSkippedStreak >= 2 && c.restPlannedToday != null),
    build: (c) => {
      if (c.restCollision) {
        const { rest, intruder } = c.restCollision
        const restName = rest.title.split('—')[0].trim().toLowerCase()
        return {
          body: `${intruder.title.split('—')[0].trim()} lands on your ${restName}. The ${restName} is yours — keep it?`,
          footnote: `The WHO defines burnout as chronic workplace stress that never got successfully managed — so rest gets scheduled and protected like work. (WHO ICD-11; Eagle Hill, 2025)`,
          actions: [
            { id: 'keeprest', label: 'Keep it', kind: 'primary' },
            { id: 'moverest', label: 'Move the rest instead', kind: 'secondary' },
          ],
          payload: { restId: rest.id, intruderId: intruder.id } as Record<string, string | number>,
          key: `${restName}|${intruder.title.split('—')[0].trim().toLowerCase()}`,
        }
      }
      const rest = c.restPlannedToday!
      return {
        body: `Rest has slipped two days running. Tonight's ${rest.title.split('—')[0].trim().toLowerCase()} is yours — keep it?`,
        footnote: `The WHO defines burnout as chronic workplace stress that never got successfully managed — so rest gets scheduled and protected like work. (WHO ICD-11; Eagle Hill, 2025)`,
        actions: [{ id: 'keeprest', label: 'Keep it', kind: 'primary' }],
        payload: { restId: rest.id },
        key: rest.dayKey,
      }
    },
  },
  {
    id: 'micro-break',
    label: 'micro-break',
    tone: 'light, physical',
    cooldownMs: 1.5 * H,
    trigger: (c) => c.justCompleted != null && c.earlyGapMin >= 10 && c.breakDue,
    build: (c) => {
      const ideas = [
        'move around for a few minutes',
        'drink some water, away from the screen',
        'tidy one small thing',
        'call someone you like',
      ]
      const idea = ideas[(c.live.mewsToday + c.dowMon0) % ideas.length]
      const take = Math.min(10, c.earlyGapMin)
      return {
        body: `Finished early, and you've been at it ~${Math.round(c.workStreakMin / 10) * 10} minutes straight — ${idea}? ${take} minutes is enough.`,
        footnote: `Micro-breaks of around ten minutes reliably lift energy and lower fatigue. (Albulescu et al., 2022 — meta-analysis)`,
        actions: [
          { id: 'take', label: `Take ${take}`, kind: 'primary' },
          { id: 'keep', label: 'Keep going', kind: 'secondary' },
        ],
        payload: { durMin: take },
        key: c.todayKey,
      }
    },
  },
  {
    id: 'next-up',
    label: 'next up',
    tone: 'momentum, light',
    cooldownMs: 0.5 * H,
    trigger: (c) => c.justCompleted != null && !c.breakDue && c.nextUp != null && c.earlyGapMin >= 15,
    build: (c) => {
      const n = c.nextUp!
      return {
        body: `${c.earlyGapMin} minutes reclaimed. ${n.title} fits (${n.durMin} min) — pull it in while the engine's warm?`,
        footnote: `Momentum compounds: progress on meaningful work is the strongest motivator there is. (Amabile & Kramer, 2011)`,
        actions: [
          { id: 'pull', label: 'Pull it in', kind: 'primary' },
          { id: 'leave', label: 'Leave the gap', kind: 'secondary' },
        ],
        payload: { kind: n.kind, id: n.id, title: n.title, durMin: n.durMin },
        key: n.id,
      }
    },
  },
  {
    id: 'fresh-start',
    label: 'fresh start',
    tone: 'opening, light',
    cooldownMs: 20 * H, // at most once per landmark day
    trigger: (c) =>
      c.justCleared != null ||
      (c.dowMon0 === 0 && c.nowMin >= 8 * 60 && c.nowMin < 11 * 60),
    build: (c) => {
      const opening = c.justCleared
        ? `A blank page. Fresh starts open a real window — want to shape the week while it's soft?`
        : `Monday — a new accounting period, the window where follow-through spikes. Want to shape the week while it's soft?`
      const bestNote =
        c.agg.realisticBestH != null
          ? ` I'll keep the shape inside your realistic ~${c.agg.realisticBestH}h of deep work a day.`
          : ''
      return {
        body: opening + bestNote,
        footnote: `Goal pursuit spikes at temporal landmarks — gym visits +33% at the start of a week, commitment contracts surge after fresh-start dates. (Dai, Milkman & Riis, 2014)`,
        actions: [
          { id: 'shape', label: 'Start with the big rock', kind: 'primary' },
          { id: 'later', label: 'Not now', kind: 'secondary' },
        ],
        payload: {},
        key: c.todayKey,
      }
    },
  },
  {
    id: 'break-smaller',
    label: 'break it smaller',
    tone: 'practical, kind',
    cooldownMs: 24 * H,
    trigger: (c) => c.stalled != null,
    build: (c) => {
      const s = c.stalled!
      return {
        body: `"${s.title}" has rolled forward ${spell(s.rolls)} times now. Want a 25-minute starter — just to crack it open?`,
        footnote: `On stalled, unappealing work, near-term subgoals built mastery, confidence, and even liking for the task; distant goals did nothing. (Bandura & Schunk, 1981)`,
        actions: s.proposal
          ? [
              {
                id: 'starter',
                label: `Starter ${s.proposal.dayKey === c.todayKey ? 'today' : fmtDowLong(s.proposal.dayKey)} ${fmtTime(s.proposal.startMin)}`,
                kind: 'primary',
              },
              { id: 'leave', label: 'Leave it whole', kind: 'secondary' },
            ]
          : [{ id: 'leave', label: 'Leave it whole', kind: 'secondary' }],
        payload: {
          blockId: s.blockId,
          title: s.title,
          ...(s.proposal ? { dayKey: s.proposal.dayKey, startMin: s.proposal.startMin } : {}),
        } as Record<string, string | number>,
        key: s.title,
      }
    },
  },
  {
    id: 'kinder-plan',
    label: 'the kinder plan',
    tone: 'a real conversation',
    cooldownMs: 7 * 24 * H, // max once per week (PRD §5)
    trigger: (c) => heavyCarryWeeks(c.agg),
    build: () => ({
      body: `Fourth week of heavy carry-over. Can we look at the load together? I have a kinder shape for next week — proposed, not imposed.`,
      footnote: `Burnt-out employees are nearly 3× more likely to plan to leave within the year. Strain is met with help, never judgment. (Eagle Hill, 2025)`,
      actions: [
        { id: 'kinder', label: "Let's look", kind: 'primary' },
        { id: 'notweek', label: 'Not this week', kind: 'secondary' },
      ],
      payload: {},
    }),
  },
]
