/* Estimate correction at plan time (#322), through the REAL store, keyless: a
   plan that places under-booked work of a kind the user's OWN history shows runs
   long offers ONE choicesMsg (the #296 shape) — kindly, once per day, their
   choice — and the pad chip re-sizes exactly those blocks through the resize
   executor. Per task-type: admin (which the user keeps quick and dusted) is
   never over-padded to fix deep. A stated duration is never touched, either way.
   THE COORDINATION: a single placement never speaks BOTH the day-load meter and
   this offer — the meter runs first and this yields to it (one guard voice per
   placement). And off is byte-identical to today. Adapters faked at their seams
   (the rescue/dayload harness); no network, no keys, no jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, MemoryEvent, Settings } from '../../domain/types'
import { addDaysKey, dayKey } from '../../domain/time'
import { chatOrder } from '../../adapters/storage-port'

/* ── fakes (identical seams to dayload.test.ts) ───────────────────────── */

const fakeDb = {
  blocks: new Map<string, unknown>(),
  captures: new Map<string, unknown>(),
  chat: new Map<string, unknown>(),
  memory: new Map<string, unknown>(),
  settings: null as Settings | null,
  chatAsc(): ChatMessage[] {
    return ([...this.chat.values()] as ChatMessage[]).sort(chatOrder)
  },
  reset() {
    this.blocks.clear()
    this.captures.clear()
    this.chat.clear()
    this.memory.clear()
    this.settings = null
  },
}

vi.mock('../../adapters/storage', () => ({
  createDexieStorage: () => ({
    load: async () => ({
      blocks: [...fakeDb.blocks.values()],
      captures: [...fakeDb.captures.values()],
      chat: fakeDb.chatAsc(),
      memory: [...fakeDb.memory.values()],
      settings: fakeDb.settings,
    }),
    putBlocks: async (bs: { id: string }[]) => bs.forEach((b) => fakeDb.blocks.set(b.id, b)),
    deleteBlocks: async (ids: string[]) => ids.forEach((i) => fakeDb.blocks.delete(i)),
    putCaptures: async (cs: { id: string }[]) => cs.forEach((c) => fakeDb.captures.set(c.id, c)),
    deleteCaptures: async (ids: string[]) => ids.forEach((i) => fakeDb.captures.delete(i)),
    putChat: async (ms: { id: string }[]) => ms.forEach((m) => fakeDb.chat.set(m.id, m)),
    countChat: async () => fakeDb.chat.size,
    loadChatBefore: async () => [],
    loadChatOlderThan: async () => [],
    deleteChat: async (ids: string[]) => ids.forEach((i) => fakeDb.chat.delete(i)),
    putMemory: async (es: { id: string }[]) => es.forEach((e) => fakeDb.memory.set(e.id, e)),
    deleteMemory: async (ids: string[]) => ids.forEach((i) => fakeDb.memory.delete(i)),
    putSettings: async (s: Settings) => {
      fakeDb.settings = s
    },
    loadSyncMap: async () => [],
    saveSyncMap: async () => {},
    deleteSyncForCalendar: async () => {},
    exportJson: async () => '{}',
    importJson: async () => {},
    getAuditLog: async () => [],
    wipe: async () => fakeDb.reset(),
  }),
}))

vi.mock('../../adapters/desktop', () => ({
  isTauri: () => false,
  readBackup: async () => null,
  latestBackupDate: async () => null,
  writeBackup: async () => {},
  registerCloseFlush: () => {},
  backupPath: () => '',
  openBackupFolder: async () => {},
  onUpdateReady: () => {},
  applyUpdate: async () => {},
  brainEndpoint: async () => null,
  brainStatus: async () => null,
  onBrainEndpoint: () => {},
  onBrainStatus: () => {},
  onShellTick: () => {},
  onTrayAction: () => {},
  updateTray: async () => {},
}))

vi.mock('../../adapters/notify', () => {
  const stub = () => ({ mirror: () => {} })
  return { createNotifier: stub, createBrowserNotifier: stub }
})

vi.mock('../../adapters/brain/gbrainHttp', () => ({
  createGbrainHttp: () => ({
    ingest: async () => {},
    recall: async () => [],
    health: async () => false,
    listPrefs: async () => [],
    links: async () => [],
  }),
}))

import { useMew } from '../store'

/* ── harness ──────────────────────────────────────────────────────────── */

const pristine = useMew.getState()
const TUE = (h: number, m = 0) => new Date(2026, 5, 9, h, m) // Tuesday, June 9
const TODAY = '2026-06-09'
const TOMORROW = addDaysKey(TODAY, 1)

/** completed events (one per day, offset −1…−days) whose DEEP work finishes 24
    min past its 2h plan → factor 1.2; a same-day admin item finishes ~on time →
    factor ~1.07 (below the pad floor). `days < 10` keeps the day-load meter's
    own floor unmet (its throughput needs ≥10 work outcomes), so these tests read
    the estimate offer alone. */
function estimateMem(days = 6): MemoryEvent[] {
  const out: MemoryEvent[] = []
  let n = 0
  for (let i = 1; i <= days; i++) {
    const k = addDaysKey(TODAY, -i)
    const midnight = new Date(k + 'T00:00:00').getTime()
    out.push({
      id: `deep${n++}`,
      ts: midnight + (11 * 60 + 24) * 60_000, // 24 min past the 11:00 planned end
      kind: 'completed',
      dayKey: k,
      tag: 'work',
      plannedMin: 120,
      deep: true,
      startMin: 9 * 60,
      endMin: 11 * 60,
    })
    out.push({
      id: `adm${n++}`,
      ts: midnight + (13 * 60 + 32) * 60_000, // 2 min past the 13:30 planned end
      kind: 'completed',
      dayKey: k,
      tag: 'private',
      plannedMin: 30,
      startMin: 13 * 60,
      endMin: 13 * 60 + 30,
    })
  }
  return out
}

/** 12 lived days of run-long DEEP work (2h planned, 24 late → factor 1.2) AND
    120 completed work min/day → the day-load meter engages too (throughput 120,
    line 138, realisticBestH set). The overlap the coordination must resolve. */
function bothMem(): MemoryEvent[] {
  const out: MemoryEvent[] = []
  for (let i = 1; i <= 12; i++) {
    const k = addDaysKey(TODAY, -i)
    const midnight = new Date(k + 'T00:00:00').getTime()
    out.push({
      id: `b${i}`,
      ts: midnight + (11 * 60 + 24) * 60_000,
      kind: 'completed',
      dayKey: k,
      tag: 'work',
      plannedMin: 120,
      deep: true,
      startMin: 9 * 60,
      endMin: 11 * 60,
    })
  }
  return out
}

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Held — deep work',
    tag: 'work',
    dayKey: TOMORROW,
    startMin: 9 * 60,
    endMin: 11 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

async function fresh(
  blocks: Block[],
  memory: MemoryEvent[],
  over: Partial<Settings> = {},
  start = TUE(8, 0)
) {
  fakeDb.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  memory.forEach((e) => fakeDb.memory.set(e.id, e))
  fakeDb.settings = { ...pristine.settings, ...over }
  vi.setSystemTime(start)
  useMew.setState(
    {
      ...pristine,
      lastTickDay: dayKey(start),
      nowMs: start.getTime(),
      lastActivityMs: start.getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
}

const chat = () => useMew.getState().chat
const blocks = () => useMew.getState().blocks
const offers = () => chat().filter((m) => /give them room/.test(m.body))
const meterMsgs = () => chat().filter((m) => /against your usual/.test(m.body))
const chipMsgs = () => chat().filter((m) => (m.choices?.length ?? 0) > 0)
const found = (title: string) => blocks().find((b) => b.title.split('—')[0].trim() === title)

const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/* ── the offer (ask mode) ─────────────────────────────────────────────── */

describe('the plan-time offer (#322, ask)', () => {
  it('under-booked deep work with no stated duration → ONE offer, pad/leave chips, after the reply', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'ask' })
    await useMew.getState().speak('block the quarterly report tomorrow')
    await settle()

    expect(offers()).toHaveLength(1)
    const offer = offers()[0]
    expect(offer.role).toBe('mew')
    expect(offer.body).toBe(
      `your deep-work blocks tend to run ~20% long — want me to give them room?`
    )
    expect(offer.choices!.map((c) => ({ id: c.id, label: c.label }))).toEqual([
      { id: 'pad', label: 'give them room' },
      { id: 'leave', label: 'leave as-is' },
    ])
    /* the pad reply is a plain ask both floors execute (parse.ts giveRoom) */
    expect(offer.choices![0].reply).toBe('give my deep-work blocks room')
    /* reflection, not interrupt: the offer lands AFTER the plan's own reply */
    const bodies = chat().map((m) => m.body)
    expect(bodies.findIndex((b) => /give them room/.test(b))).toBeGreaterThan(
      bodies.findIndex((b) => /^today|^Done|held for/.test(b))
    )
  })

  it('once per day: a second under-booked placement the same day re-offers nothing', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'ask' })
    await useMew.getState().speak('block the quarterly report tomorrow')
    await settle()
    expect(offers()).toHaveLength(1)

    await useMew.getState().speak('block the roadmap review on friday')
    await settle()
    expect(offers()).toHaveLength(1)
    /* the burned key is persisted machine state (#297) — survives a restart */
    expect(useMew.getState().settings.nudgeLastFired?.estimate?.key).toBe(TODAY)
    expect(fakeDb.settings?.nudgeLastFired?.estimate?.key).toBe(TODAY)
  })

  it('the pad chip re-sizes the exact block through the executor (60 → 70 at factor 1.2)', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'ask' })
    await useMew.getState().speak('block the quarterly report tomorrow')
    await settle()
    const placed = found('quarterly report')!
    expect(placed.endMin - placed.startMin).toBe(60)

    await useMew.getState().pickChoice(offers()[0].id, 'pad')
    await settle()

    const padded = blocks().find((b) => b.id === placed.id)!
    expect(padded.endMin - padded.startMin).toBe(70) // padDuration(60, 1.2)
    /* a plan-voice confirmation, tools stayed the only mutation path */
    expect(chat().some((m) => m.role === 'mew' && /Gave your deep-work block/.test(m.body))).toBe(
      true
    )
  })

  it('the leave chip is a quiet acknowledgment — nothing on the week changes', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'ask' })
    await useMew.getState().speak('block the quarterly report tomorrow')
    await settle()
    const before = blocks()

    await useMew.getState().pickChoice(offers()[0].id, 'leave')
    await settle()

    expect(blocks()).toEqual(before)
    expect(chat().some((m) => m.role === 'user' && m.body === 'ok, leave them as they are')).toBe(
      true
    )
  })

  it('voice pin: the whole flow never says you underestimate / always / behind', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'ask' })
    await useMew.getState().speak('block the quarterly report tomorrow')
    await settle()
    const everything = chat()
      .map((m) => m.body)
      .join(' ')
    expect(everything).not.toMatch(/\b(underestimate|you always|behind|too slow)\b/i)
  })
})

/* ── stated word wins (pinned both ways) ──────────────────────────────── */

describe('stated word wins (#322)', () => {
  it('an explicit-duration ask is never offered on', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'ask' })
    await useMew.getState().speak('block 90 min for the quarterly report tomorrow')
    await settle()
    expect(offers()).toHaveLength(0)
    const placed = found('quarterly report')!
    expect(placed.endMin - placed.startMin).toBe(90) // exactly as asked
  })

  it('pad never touches a stated-duration block placed in the same turn', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'ask' })
    /* one unstated deep block (offer-eligible) + one stated-duration deep block */
    await useMew
      .getState()
      .speak('block the quarterly report tomorrow, block 90 min for the board deck tomorrow')
    await settle()
    expect(offers()).toHaveLength(1)

    await useMew.getState().pickChoice(offers()[0].id, 'pad')
    await settle()

    expect(found('quarterly report')!.endMin - found('quarterly report')!.startMin).toBe(70) // padded
    expect(found('board deck')!.endMin - found('board deck')!.startMin).toBe(90) // stated → untouched
  })
})

/* ── per-tag: admin is never over-padded ──────────────────────────────── */

describe('per-tag — admin is not over-padded (#322)', () => {
  it('placing admin (factor below the floor) never offers', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'ask' })
    await useMew.getState().speak('block groceries tomorrow')
    await settle()
    expect(offers()).toHaveLength(0)
  })

  it('deep + admin in one turn → the offer is about deep only; pad leaves admin be', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'ask' })
    await useMew.getState().speak('block the quarterly report tomorrow, block groceries tomorrow')
    await settle()
    expect(offers()).toHaveLength(1)
    expect(offers()[0].body).toContain('deep-work')

    const adminBefore = found('groceries')!
    await useMew.getState().pickChoice(offers()[0].id, 'pad')
    await settle()
    /* deep grew; admin is byte-identical */
    expect(found('quarterly report')!.endMin - found('quarterly report')!.startMin).toBe(70)
    expect(found('groceries')).toEqual(adminBefore)
  })
})

/* ── THE COORDINATION: one guard voice per placement (#301 + #322) ────── */

describe('no double voice with the day-load meter (#322 pin)', () => {
  it('a placement that trips BOTH guards speaks ONLY the meter; the estimate offer defers (key unburned)', async () => {
    /* tomorrow already holds 120 min; the unstated deep block pushes it over the
       138-min line AND is run-long-eligible — both guards want to speak */
    await fresh([block({ id: 'pre', title: 'Standup notes — work', endMin: 11 * 60 })], bothMem(), {
      estimateAutosize: 'ask',
    })
    await useMew.getState().speak('block the quarterly report tomorrow')
    await settle()

    expect(meterMsgs()).toHaveLength(1) // the meter spoke
    expect(offers()).toHaveLength(0) // the estimate offer stayed silent
    /* deferred, NOT spent: the once-a-day key is unburned, so the offer still
       gets its shot on a turn the meter is quiet on */
    expect(useMew.getState().settings.nudgeLastFired?.estimate).toBeUndefined()
  })

  it('the deferred offer still fires on a later placement the meter is quiet on', async () => {
    await fresh([block({ id: 'pre', title: 'Standup notes — work', endMin: 11 * 60 })], bothMem(), {
      estimateAutosize: 'ask',
    })
    await useMew.getState().speak('block the quarterly report tomorrow')
    await settle()
    expect(offers()).toHaveLength(0)
    expect(meterMsgs()).toHaveLength(1) // turn 1: only the meter spoke

    /* Friday is empty → 60 min is under the line → the meter stays quiet → the
       estimate offer finally speaks (its key was never burned) */
    await useMew.getState().speak('block the roadmap review on friday')
    await settle()
    expect(meterMsgs()).toHaveLength(1) // no NEW meter message on the light day
    expect(offers()).toHaveLength(1) // the deferred offer fires
  })
})

/* ── off = byte-identical to today (pinned) ───────────────────────────── */

describe('off = byte-identical to today (#322 pin)', () => {
  it('off never offers and never pads — the placement is exactly today', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'off' })
    await useMew.getState().speak('block the quarterly report tomorrow')
    await settle()
    expect(offers()).toHaveLength(0)
    expect(chipMsgs()).toHaveLength(0)
    const placed = found('quarterly report')!
    expect(placed.endMin - placed.startMin).toBe(60) // default length, unpadded
  })

  it('off produces the same placed block as a run with rich run-long history', async () => {
    /* two identical placements, the only difference being the setting — the
       block that lands must be byte-identical (chat aside is the only delta) */
    await fresh([], estimateMem(), { estimateAutosize: 'off' })
    await useMew.getState().speak('block the quarterly report tomorrow at 9')
    await settle()
    const off = found('quarterly report')!

    await fresh([], [], { estimateAutosize: 'off' }) // cold history, same setting
    await useMew.getState().speak('block the quarterly report tomorrow at 9')
    await settle()
    const cold = found('quarterly report')!

    expect(off.startMin).toBe(cold.startMin)
    expect(off.endMin).toBe(cold.endMin)
    expect(off.tag).toBe(cold.tag)
  })
})

/* ── always = silent pre-size in the plan-mode picker ─────────────────── */

describe('always — silent pre-size in the plan-mode picker (#322)', () => {
  it('the picker previews demonstrated durations and the pick applies them; no chip offer', async () => {
    await fresh([], estimateMem(), { estimateAutosize: 'always', planMode: 'always' })
    await useMew
      .getState()
      .speak('block the quarterly report, block the board deck, block the roadmap review')
    await settle()

    const picker = chat().find((m) => (m.scenarios?.length ?? 0) > 0)
    expect(picker).toBeTruthy()
    /* every deep place previews the honest length (60 → 70 at factor 1.2) */
    const deepPlaces = picker!.scenarios![0].places.filter((p) => p.tag === 'work')
    expect(deepPlaces.length).toBeGreaterThan(0)
    for (const p of deepPlaces) expect(p.durationMin).toBe(70)
    /* always is silent — it pre-sizes, it never asks */
    expect(offers()).toHaveLength(0)

    /* the pick applies the previewed (padded) lengths byte-exactly */
    const sc = picker!.scenarios![0]
    useMew.getState().pickScenario(picker!.id, sc.id)
    await settle()
    for (const p of sc.places.filter((x) => x.tag === 'work')) {
      const landed = blocks().find(
        (b) => b.title === p.title && b.dayKey === addDaysKey(TODAY, p.dayOffset)
      )!
      expect(landed.endMin - landed.startMin).toBe(70)
    }
  })
})
