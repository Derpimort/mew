/* The nudge library — a living research asset (PRD §5). Each nudge is data:
   trigger, phrasing in the user's own numbers, tone, footnote, cooldown.
   New research findings land here as new entries, not new code.
   Content source of truth: design_handoff_mew_mvp/mew-v4-research.jsx → NUDGES. */

import type { Block, Capture, NudgeAction, NudgeFiredMap, NudgeId, PrefPayload } from '../types'
import type { LiveNow } from '../liveNow'
import { type MemoryAggregates, heavyCarryWeeks } from '../memory'
import { dayLoadFiredKey, prefKey, type DelegationCandidate, type Insights } from '../insights'
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
  /** A due-bearing background block at its latest-start boundary, unstarted. */
  startBy: { block: Block; latestStart: number } | null
  /** A standing rule that lived behavior has outgrown (trailing 14d, ≥3). */
  prefDrift: { pref: PrefPayload; observed: string; count: number } | null
  /** A fixed block ~10 min out whose person the brain has recall lines for. */
  headsUp: { block: Block; lines: string[] } | null
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
  /** Recurring task×person pairs worth handing over — receipts from the
      graph, counts from the trailing 28d. Empty when the brain is off. */
  delegations: DelegationCandidate[]
  /** The evening story, composed by the engine when the day is past its end.
      Empty = nothing worth narrating (the nudge stays silent). */
  debriefLines: string[]
  /** The once-a-day rituals (#285), composed by the engine once the clock
      passes Settings.briefMin / wrapMin — null before then (or when the
      inputs never arrived). Once-per-day rides the persisted lastFired key. */
  morningBrief: { body: string } | null
  eveningWrap: { body: string } | null
  /** The Sunday shaping invite (#304), composed once the clock passes
      Settings.weeklyRitualMin on a Sunday — null elsewhere. Once-per-ISO-week
      rides the persisted key (`key = weekKey`), the daily rituals' law at
      week scale. */
  weeklyRitual: { body: string; weekKey: string } | null
  /** Last week's story, computed only in the Monday window — null elsewhere
      and on week one (no events = no lines = the original copy stands). */
  weekReview: { lines: string[]; kinder: boolean } | null
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
  /* dedupe state — the full fired map (#297): nudge slots plus the store
     rituals' (`sustenance`, `dayload:*`) so a trigger can defer to them */
  lastFired: NudgeFiredMap
  lastDriftBlockId: string | null
}

/** The day-load meter (#301) already spoke about the heavy day today —
    read from the same persisted slot the store burns when it posts. */
function dayLoadSpokeToday(c: NudgeCtx): boolean {
  return c.heavyDay != null && c.lastFired[dayLoadFiredKey(c.heavyDay.dayKey)]?.key === c.todayKey
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
    /* one guard voice per day per day: when the plan-time day-load meter
       (#301) already spoke about this day today, the tick nudge yields —
       asking "want me to right-size it?" an hour after "want me to keep it
       kind?" would be the nagging both exist to prevent */
    trigger: (c) => c.heavyDay != null && !dayLoadSpokeToday(c),
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
        left === 0 ? ' The day is clear — rest is earned.' : left === 1 ? ' One to go.' : ''
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
          {
            id: 'roll',
            label: `${dayLabel[0].toUpperCase()}${dayLabel.slice(1)} at ${fmtTime(p.toStartMin)}`,
            kind: 'primary',
          },
          { id: 'leave', label: 'Leave it open', kind: 'secondary' },
        ],
        payload: { blockId: b.id, toDayKey: p.toDayKey, toStartMin: p.toStartMin },
        key: c.todayKey,
      }
    },
  },
  {
    id: 'debrief',
    label: 'day debrief',
    tone: 'reflective, factual',
    cooldownMs: 20 * H, // once per evening; key scopes it to the day
    /* the same wind-down window close-loop owns — and one priority slot
       behind it, so the open thread gets a plan before the day gets a story */
    trigger: (c) => c.pastDayEnd && c.debriefLines.length > 0,
    build: (c) => ({
      body: c.debriefLines.join('\n'),
      footnote: `End-of-day reflection consolidates learning and closes the day's open loops — the story, not the scorecard.`,
      actions: [], // pure information: nothing to accept, nothing to decline
      payload: {},
      key: c.todayKey,
    }),
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
              {
                id: 'placecap',
                label: `${p.dayKey === c.todayKey ? 'Today' : fmtDowLong(p.dayKey)} ${fmtTime(p.startMin)}`,
                kind: 'primary',
              },
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
        const work = intruder.title.split('—')[0].trim()
        return {
          /* one clean line — the work and the rest named once each. The old
             copy jammed the rest title in twice across two sentences (#326);
             "keep it?" carries the whole ask and pairs with the Keep-it chip.
             restName is the rest's own title, so an errand ("groceries order")
             is named naturally rather than called a generic "rest". */
          body: `${work} is set to run over your ${restName} — keep it?`,
          footnote: `The WHO defines burnout as chronic workplace stress that never got successfully managed — so rest gets scheduled and protected like work. (WHO ICD-11; Eagle Hill, 2025)`,
          actions: [
            { id: 'keeprest', label: 'Keep it', kind: 'primary' },
            { id: 'moverest', label: 'Move the rest instead', kind: 'secondary' },
          ],
          payload: { restId: rest.id, intruderId: intruder.id } as Record<string, string | number>,
          /* dedup per (rest block × day): a burst of placements can swap the
             intruder tick-to-tick, so keying on the intruder re-fired the same
             minute (#326). Key on the rest alone → one ask per rest per day. */
          key: `${rest.id}|${rest.dayKey}`,
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
    trigger: (c) =>
      c.justCompleted != null && !c.breakDue && c.nextUp != null && c.earlyGapMin >= 15,
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
    id: 'start-by',
    label: 'start by',
    tone: 'deadline, factual',
    cooldownMs: 8 * H, // once per block per working day; key scopes it per-block
    trigger: (c) => c.startBy != null,
    build: (c) => {
      const { block, latestStart } = c.startBy!
      const title = block.title.split('—')[0].trim()
      return {
        body: `start ${title} by ${fmtTime(latestStart)} or it misses ${fmtTime(block.due!)}.`,
        footnote: `Implementation intentions: naming when-and-where roughly doubles follow-through. (Gollwitzer & Sheeran, 2006)`,
        actions: [
          { id: 'start', label: 'Start now', kind: 'primary' },
          { id: 'ack', label: 'Acknowledged', kind: 'secondary' },
        ],
        payload: { blockId: block.id },
        key: block.id,
      }
    },
  },
  {
    id: 'pref-drift',
    label: 'rule check',
    tone: 'care, never blame',
    cooldownMs: 7 * 24 * H, // keep stretches it toward 14d via outcome learning
    trigger: (c) => c.prefDrift != null,
    build: (c) => {
      const { pref, observed, count } = c.prefDrift!
      const obs = observed.replace(/^starts /, '')
      const cur = pref.value.replace(/^starts /, '')
      return {
        body: `your rule says ${pref.match} ${pref.value}, but it has lived near ${obs} ${spell(count)} times running — update the rule, or keep ${cur}?`,
        footnote: `Habits drift with context; rules that track reality get followed. (Wood & Neal, 2007)`,
        actions: [
          { id: 'update', label: `Update to ${obs}`, kind: 'primary' },
          { id: 'keep', label: `Keep ${cur}`, kind: 'secondary' },
        ],
        payload: {
          kind: pref.kind,
          match: pref.match,
          value: pref.value,
          observed,
          stated: pref.stated,
        },
        key: prefKey(pref),
      }
    },
  },
  {
    id: 'heads-up',
    label: 'heads-up',
    tone: 'informational, factual',
    cooldownMs: 8 * H, // once per block; the per-block key scopes it
    trigger: (c) => c.headsUp != null,
    build: (c) => {
      const { block, lines } = c.headsUp!
      const title = block.title.split('—')[0].trim()
      return {
        /* the recall lines ride verbatim — history informs, it never demands */
        body: `${title} at ${fmtTime(block.startMin)} — what the brain holds:\n${lines.join('\n')}`,
        footnote: `From your brain: the last thing that happened with these people, so the first minute isn't spent reconstructing it.`,
        actions: [{ id: 'ack', label: 'Got it', kind: 'secondary' }],
        payload: { blockId: block.id },
        key: block.id,
      }
    },
  },
  {
    id: 'fresh-start',
    label: 'fresh start',
    tone: 'opening, light',
    cooldownMs: 20 * H, // at most once per landmark day
    trigger: (c) =>
      c.justCleared != null || (c.dowMon0 === 0 && c.nowMin >= 8 * 60 && c.nowMin < 11 * 60),
    build: (c) => {
      /* with history, Monday opens with the story; justCleared keeps the
         blank-page copy (mid-week clears aren't about last week) */
      const review = !c.justCleared && c.weekReview?.lines.length ? c.weekReview : null
      const opening = c.justCleared
        ? `A blank page. Fresh starts open a real window — want to shape the week while it's soft?`
        : review
          ? `${review.lines.join('\n')}\nShape this week the same${review.kinder ? ', or kinder' : ''}?`
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
    id: 'delegate',
    label: 'delegation',
    tone: 'opening, collaborative',
    cooldownMs: 6 * 24 * H, // once per candidate per week; key scopes per pair
    /* week-shaping moments only — the same window fresh-start owns. By
       priority it rides one tick behind fresh-start, so the opener lands
       first and the handoff idea second. */
    trigger: (c) =>
      c.delegations.length > 0 &&
      (c.justCleared != null || (c.dowMon0 === 0 && c.nowMin >= 8 * 60 && c.nowMin < 11 * 60)),
    build: (c) => {
      const d = c.delegations[0]
      return {
        body: `${d.label} has run with ${d.personLabel} ${spell(d.count)} times this month — worth handing them the thread this week?`,
        footnote: `Managers systematically under-delegate recurring work they have already co-staffed. (Akinola et al., 2018)`,
        actions: [
          { id: 'capture', label: 'Capture the handoff', kind: 'primary' },
          { id: 'later', label: 'Not now', kind: 'secondary' },
        ],
        payload: {
          taskKind: d.taskKind,
          label: d.label,
          person: d.person,
          personLabel: d.personLabel,
        },
        key: `${d.person}:${d.taskKind}`,
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
    id: 'morning-brief',
    label: 'morning brief',
    tone: 'opening ritual, factual',
    cooldownMs: 0, // once-per-day is the persisted key's law, not a clock cooldown
    /* fires the first tick at/after briefMin that hasn't fired TODAY — the
       persisted key survives restarts, and moving briefMin later in the day
       re-arms only while today's key is still unwritten (#285) */
    trigger: (c) => c.morningBrief != null && c.lastFired['morning-brief']?.key !== c.todayKey,
    build: (c) => ({
      body: c.morningBrief!.body,
      footnote: `A plan with a when and a where follows through about twice as often — the brief names both before the day starts. (Gollwitzer & Sheeran, 2006)`,
      actions: [], // pure information: the day itself is the call to action
      payload: {},
      key: c.todayKey,
    }),
  },
  {
    id: 'evening-wrap',
    label: 'evening wrap',
    tone: 'closing ritual, kind',
    cooldownMs: 0, // once-per-day is the persisted key's law, not a clock cooldown
    trigger: (c) => c.eveningWrap != null && c.lastFired['evening-wrap']?.key !== c.todayKey,
    build: (c) => ({
      body: c.eveningWrap!.body,
      footnote: `The day's story, told kindly — what landed, what waits, one thing worth noticing. Open work is waiting, never a verdict.`,
      actions: [],
      payload: {},
      key: c.todayKey,
    }),
  },
  {
    id: 'weekly-ritual',
    label: 'weekly ritual',
    tone: 'opening ritual, inviting',
    cooldownMs: 0, // once-per-ISO-week is the persisted key's law, not a clock cooldown
    /* fires the first Sunday tick at/after weeklyRitualMin that hasn't fired
       THIS ISO WEEK — the persisted weekKey survives restarts (#297 pattern).
       The nudge INVITES; the chip's words become an ordinary user turn and
       the turn does the work (chat-first law): read-only sweep → shaping
       questions → the plan-mode picker → one apply on the user's pick. */
    trigger: (c) =>
      c.weeklyRitual != null && c.lastFired['weekly-ritual']?.key !== c.weeklyRitual.weekKey,
    build: (c) => ({
      body: c.weeklyRitual!.body,
      footnote: `An if-then plan with a when and a where raises follow-through, d = .65 across 94 studies — the ritual names both for the whole week. (Gollwitzer & Sheeran, 2006)`,
      actions: [{ id: 'plan', label: 'plan my week', kind: 'primary' }],
      payload: {},
      key: c.weeklyRitual!.weekKey,
    }),
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
