/* RC journeys (tsk_01m2r1nfdrpygn5ez1ysz9jg8g, tonight's RC push): the features that landed one
   at a time tonight, acting on ONE week together, the way an owner meets them.
   Each journey drives the real store (keyless floor unless it says keyed) and
   asserts, step by step, both the WEEK and the CHAT the owner would see.
   Test-only: a journey that finds a bug pins it as a filed issue (it.fails with
   the issue number), never a fix in this file. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, MemoryEvent, Settings } from '../../domain/types'
import { chatOrder } from '../../adapters/storage-port'
import { addDaysKey } from '../../domain/time'
import * as week from '../../domain/week'
import { dayRelation, daySummary, dayTitle } from '../../ui/components/dialDay'
import { dialBadges } from '../../ui/components/orbitGeometry'

/* ── fakes ────────────────────────────────────────────────────────── */

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

/* a scripted local model for the steps the keyless floor has no words for (an
   "undo that" fires exec.undoLast()). Provider 'ollama' (modelLocation:'local')
   runs midTurn; any other provider throws offline, so the floor answers. Nothing
   touches the network. */
const scriptedModel = {
  chunks: [] as string[],
  midTurn: null as null | ((exec: import('../../adapters/model').ToolExecutor) => void),
  reset() {
    this.chunks = []
    this.midTurn = null
  },
}
vi.mock('../../adapters/model/aiAdapter', () => ({
  createAiAdapter: (spec: { provider: string }) => ({
    id: spec.provider,
    async *converse(
      _thread: unknown,
      _ctx: unknown,
      exec: import('../../adapters/model').ToolExecutor
    ) {
      if (spec.provider !== 'ollama') throw Object.assign(new Error('offline'), { statusCode: 503 })
      const [first, ...rest] = scriptedModel.chunks
      if (first) yield first
      scriptedModel.midTurn?.(exec)
      for (const c of rest) yield c
    },
  }),
}))

import { useMew } from '../store'

/* ── harness ──────────────────────────────────────────────────────── */

const pristine = useMew.getState()
const TUE = (h: number, m = 0) => new Date(2026, 5, 9, h, m) // Tuesday, June 9
const TODAY = '2026-06-09'

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Deck',
    tag: 'work',
    dayKey: TODAY,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** a fresh store on `at` (default Tuesday 8:30), hydrated from exactly `seed`:
    no seeded meals unless a journey asks for them, a connected calendar 'c' so
    [calendar] blocks survive hydrate, and the keyless floor unless `location`
    says 'local' (a scripted model then runs midTurn). */
async function fresh(
  seed: Block[],
  opts: {
    at?: Date
    location?: 'remote' | 'local'
    memory?: MemoryEvent[]
    settings?: Partial<Settings>
  } = {}
) {
  const at = opts.at ?? TUE(8, 30)
  fakeDb.reset()
  seed.forEach((b) => fakeDb.blocks.set(b.id, b))
  ;(opts.memory ?? []).forEach((e) => fakeDb.memory.set(e.id, e))
  fakeDb.settings = {
    ...pristine.settings,
    modelLocation: opts.location ?? 'remote',
    sustenance: 'off',
    calendars: [
      { id: 'c', name: 'Work', who: 'me', provider: 'google', kind: 'import', readOnly: true },
    ],
    ...opts.settings,
  }
  vi.setSystemTime(at)
  useMew.setState(
    {
      ...pristine,
      lastTickDay: keyOf(at),
      nowMs: at.getTime(),
      lastActivityMs: at.getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
}

const chat = () => useMew.getState().chat
const blocks = () => useMew.getState().blocks
const byId = (id: string) => blocks().find((b) => b.id === id)
const say = (text: string) => useMew.getState().speak(text)
const settle = async () => {
  await Promise.resolve()
  vi.advanceTimersByTime(1)
  await Promise.resolve()
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  scriptedModel.reset()
})

/* ── journey helpers ──────────────────────────────────────────────── */

const MON = '2026-06-08'
const WED = '2026-06-10'
const THU = '2026-06-11'
const FRIDAY = '2026-06-12'
const NEXT_MON = '2026-06-15'
const FRI = (h: number, m = 0) => new Date(2026, 5, 12, h, m)

/** what the owner saw from chat index `from` on, as `role: body` (tool cards aside) */
const seen = (from: number) =>
  chat()
    .slice(from)
    .filter((m) => m.role !== 'tool')
    .map((m) => `${m.role}: ${m.body}`)
const lastMew = () =>
  chat()
    .filter((m) => m.role === 'mew')
    .at(-1)!.body
const chipMsgs = () => chat().filter((m) => (m.choices?.length ?? 0) > 0)
const chips = (msg = chipMsgs().at(-1)!) => msg.choices!.map((c) => [c.label, c.reply])
/** one day of the week as [title, start, end, status], in time order */
const dayRows = (k: string) =>
  blocks()
    .filter((b) => b.dayKey === k)
    .sort((a, b) => a.startMin - b.startMin)
    .map((b) => [b.title, b.startMin, b.endMin, b.status])
const pick = async (label: string, msg = chipMsgs().at(-1)!) => {
  await useMew.getState().pickChoice(msg.id, msg.choices!.find((c) => c.label === label)!.id)
  await settle()
}
const rollTo = (d: Date) => {
  vi.setSystemTime(d)
  useMew.getState().tick()
}
const keyed = () => useMew.getState().updateSettings({ modelLocation: 'local' })

/** a Mon–Wed out-of-office label from the connected calendar. Tagged work so
    load, rescue and protect-rest would all trip over it if it held any time. */
const ooo = (tag: Block['tag'] = 'work') =>
  block({
    id: 'ooo',
    title: 'OOO',
    tag,
    dayKey: MON,
    endDayKey: WED,
    startMin: 0,
    endMin: 0,
    allDay: true,
    protected: false,
    calendarRefs: ['c'],
    external: { calId: 'c', eventId: 'ooo-ev' },
  })
/** keeps the week from being brand new, far from every journey's day */
const anchor = () =>
  block({ id: 'anchor', title: 'Standup', dayKey: WED, startMin: 540, endMin: 555 })

/* ── 1 · an out-of-office week, planned into the evening ─────────────── */

describe('RC journey 1: an out-of-office week, planned into the evening', () => {
  it('the OOO span stays a label while writing lands tonight on the hour, a meeting splits it, and nothing counts the label', async () => {
    await fresh(
      [
        ooo(),
        block({ id: 'deck', title: 'Deck' }),
        block({ id: 'dinner', title: 'Dinner', tag: 'rest', startMin: 19 * 60, endMin: 20 * 60 }),
      ],
      { at: TUE(17, 10) }
    )
    /* the boot brief counts two blocks and one hour of deep work: the label holds no time */
    expect(seen(0)).toEqual([
      'nudge: today: 2 blocks, 9:00–20:00 · 1h deep work\nfirst up: Deck at 9:00\none thing: a clean runway — no overlaps, nothing due',
    ])

    /* tonight: after dinner, on the hour, inside the plannable hours, on an OOO day */
    let from = chat().length
    await say('block 2h for writing tonight')
    await settle()
    expect(seen(from)).toEqual([
      'user: block 2h for writing tonight',
      "mew: Done — today 20:00–22:00 is held for writing. That's your 2nd hour-plus work block this week.",
    ])
    expect(dayRows(TODAY)).toEqual([
      ['Deck', 540, 600, 'open'],
      ['Dinner', 1140, 1200, 'open'],
      ['writing', 1200, 1320, 'open'],
    ])

    /* the day read back: the label is a label */
    await say("what's on today")
    await settle()
    expect(lastMew()).toBe(
      "here's today:\n- all day OOO [all-day through 2026-06-10, calendar]\n- 9:00–10:00 Deck [work]\n- 19:00–20:00 Dinner [rest]\n- 20:00–22:00 writing [work]"
    )

    /* protect-rest: the label never "runs over your dinner" */
    from = chat().length
    rollTo(TUE(17, 20))
    await settle()
    expect(seen(from)).toEqual([])

    /* rescue: a timed meeting on writing is offered room; the label never was */
    from = chat().length
    useMew
      .getState()
      .simulatePull([{ eventId: 'ts', title: 'Team sync', startMin: 1230, endMin: 1260 }])
    await settle()
    expect(seen(from)).toEqual([
      'mew: heads up — Team sync at 20:30 landed on writing. want me to make room?',
    ])
    expect(chips()).toEqual([
      ['split around it', 'split the writing around 20:30-21:00, keep 60m after'],
      ['roll to tomorrow', 'move the writing to tomorrow'],
    ])
    await pick('split around it')
    expect(lastMew()).toBe(
      'Split — writing now runs 20:00–20:30, and writing (part 2) picks up 21:00–22:00, leaving 20:30–21:00 free.'
    )
    expect(dayRows(TODAY)).toEqual([
      ['Deck', 540, 600, 'open'],
      ['Dinner', 1140, 1200, 'open'],
      ['writing', 1200, 1230, 'open'],
      ['Team sync', 1230, 1260, 'open'],
      ['writing (part 2)', 1260, 1320, 'open'],
    ])

    /* load: the label adds nothing to the day */
    expect(week.loadBySegment(blocks(), TODAY)).toEqual({ work: 180, priv: 0, rest: 60 })
    expect(week.plannedDeepMin(blocks(), TODAY)).toBe(120)
    expect(byId('ooo')).toMatchObject({ allDay: true, dayKey: MON, endDayKey: WED, startMin: 0 })
  })

  it.fails(
    '#116: a plan that cannot fit before the plannable end never lands earlier today',
    async () => {
      await fresh([anchor()], { at: TUE(20, 46) })
      await say('block 2h for writing')
      await settle()
      const writing = blocks().find((b) => b.title === 'writing')
      expect(writing == null || writing.dayKey !== TODAY || writing.startMin >= 20 * 60 + 46).toBe(
        true
      )
    }
  )

  it.fails('#117: "tonight" asked at 14:00 lands in the evening', async () => {
    await fresh([anchor()], { at: TUE(14, 0) })
    await say('block 2h for writing tonight')
    await settle()
    expect(blocks().find((b) => b.title === 'writing')!.startMin).toBeGreaterThanOrEqual(
      18 * 60 + 30
    )
  })

  it.fails('#117: "this evening" stays out of the title', async () => {
    await fresh([anchor()], { at: TUE(14, 0) })
    await say('block 1h for reading this evening')
    await settle()
    expect(blocks().map((b) => b.title)).toContain('reading')
  })
})

/* ── 2 · a meeting lands on flexible work ────────────────────────────── */

describe('RC journey 2: a meeting lands on flexible work', () => {
  const deckPolish = () => block({ id: 'deck', title: 'Deck polish', startMin: 540, endMin: 660 })
  const meeting = { eventId: 'sync', title: 'Design sync', startMin: 570, endMin: 615 }
  const SPLIT = [
    ['Deck polish', 540, 570, 'open'],
    ['Design sync', 570, 615, 'open'],
    ['Deck polish (part 2)', 615, 660, 'open'],
    ['Breather', 660, 675, 'open'],
  ]
  async function splitAroundTheMeeting() {
    await fresh([deckPolish()], { at: TUE(8, 0) })
    useMew.getState().simulatePull([meeting])
    await settle()
    await pick('split around it')
  }

  it('the rescue split leaves the meeting uncovered, merge never joins across it, and a keyed move of part 2 is undone in its own turn', async () => {
    await fresh([deckPolish()], { at: TUE(8, 0) })
    let from = chat().length
    useMew.getState().simulatePull([meeting])
    await settle()
    expect(seen(from)).toEqual([
      'mew: heads up — Design sync at 9:30 landed on Deck polish. want me to make room?',
    ])
    expect(chips()).toEqual([
      ['shift to 10:15', 'move the Deck polish to today at 10:15'],
      ['split around it', 'split the Deck polish around 9:30-10:15, keep 45m after'],
      ['roll to tomorrow', 'move the Deck polish to tomorrow'],
    ])

    from = chat().length
    await pick('split around it')
    expect(seen(from)).toEqual([
      'user: split the Deck polish around 9:30-10:15, keep 45m after',
      'mew: Split — Deck polish now runs 9:00–9:30, and Deck polish (part 2) picks up 10:15–11:00, leaving 9:30–10:15 free. Tucked a 15-min breather into today at 11:00.',
    ])
    expect(dayRows(TODAY)).toEqual(SPLIT)

    /* merge never joins across the calendar meeting, and says so (#121) */
    await say('merge my two deck polish blocks')
    await settle()
    expect(dayRows(TODAY)).toEqual(SPLIT)
    expect(lastMew()).toBe(
      'Design sync 9:30–10:15 (from your calendar) sits between them today, so everything stays as it is.'
    )

    /* keyed: a move of part 2 and its undo in one turn put the week back exactly */
    await keyed()
    let moved = ''
    let undone = ''
    scriptedModel.midTurn = (exec) => {
      moved = exec.move('deck polish (part 2)', 0, 14 * 60)
      undone = exec.undoLast()
    }
    await say('move the second deck polish piece to 2pm — no, put it back')
    await settle()
    expect(moved).toBe('Moved — Deck polish (part 2) now lives today at 14:00.')
    expect(undone).toBe('Undone — put Deck polish (part 2) back where it was.')
    expect(dayRows(TODAY)).toEqual(SPLIT)
  })

  it('#121: once the meeting is gone, the split pair merges back into one block', async () => {
    await splitAroundTheMeeting()
    useMew.getState().simulatePull([])
    await settle()
    await say('merge my two deck polish blocks')
    await settle()
    expect(
      blocks()
        .filter((b) => b.title.startsWith('Deck polish'))
        .map((b) => [b.startMin, b.endMin])
    ).toEqual([[540, 660]])
  })

  it.fails(
    '#120: "undo that", the message after the split was picked, takes the split back',
    async () => {
      await splitAroundTheMeeting()
      await keyed()
      scriptedModel.midTurn = (exec) => {
        exec.undoLast()
      }
      await say('undo that')
      await settle()
      expect(dayRows(TODAY)).toEqual([
        ['Deck polish', 540, 660, 'open'],
        ['Design sync', 570, 615, 'open'],
      ])
    }
  )

  it.fails('#118: keyless "undo that" is never captured into the inbox', async () => {
    await fresh([deckPolish()], { at: TUE(8, 0) })
    await say('split the deck polish around 9:30-10:15')
    await settle()
    await say('undo that')
    await settle()
    expect(useMew.getState().captures.map((c) => c.title)).not.toContain('undo that')
  })

  it.fails("#119: a keyless capture reply shows the owner only the owner's line", async () => {
    await fresh([deckPolish()], { at: TUE(8, 0) })
    await say('call the bank')
    await settle()
    expect(lastMew()).toBe('Captured "call the bank".')
  })
})

/* ── 3 · same-titled lunches across midnight ─────────────────────────── */

describe('RC journey 3: same-titled lunches across midnight', () => {
  const lunch = (id: string, dayKey: string) =>
    block({
      id,
      title: 'Lunch',
      tag: 'private',
      dayKey,
      startMin: 720,
      endMin: 765,
      protected: false,
    })
  const lunchIds = () =>
    blocks()
      .map((b) => b.id)
      .sort()

  it("a day chip offered Tuesday 23:50 is refused after midnight, and Wednesday's words remove only Thursday's lunch", async () => {
    await fresh([lunch('l-tue', TODAY), lunch('l-wed', WED), lunch('l-thu', THU)], {
      at: TUE(23, 50),
    })

    await say('remove the lunch at 12:00')
    await settle()
    expect(lastMew()).toMatch(
      /^3 "lunch" blocks ahead — the 12:00 \(12:00–12:45\), the 12:00 \(Wednesday 12:00–12:45\), or the 12:00 \(Thursday 12:00–12:45\)\? Tell me which/
    )
    expect(chips()).toEqual([
      ['today 12:00', 'remove lunch today at 12:00'],
      ['tomorrow 12:00', 'remove lunch tomorrow at 12:00'],
      ['thursday 12:00', 'remove lunch on thursday at 12:00'],
      ['all of them', 'remove all lunch'],
    ])

    /* past midnight "tomorrow" means Thursday, so Tuesday's chip is refused */
    rollTo(new Date(2026, 5, 10, 0, 5))
    let from = chat().length
    await pick('tomorrow 12:00')
    expect(seen(from)).toEqual([
      'mew: That choice was offered on Tuesday ("tomorrow 12:00"), so everything stays as it is.',
    ])
    expect(lunchIds()).toEqual(['l-thu', 'l-tue', 'l-wed'])

    /* asked again on Wednesday: today is Wednesday, tomorrow is Thursday */
    await say('remove the lunch at 12:00')
    await settle()
    expect(lastMew()).toBe(
      '2 "lunch" blocks ahead — the 12:00 (12:00–12:45) or the 12:00 (Thursday 12:00–12:45)? Tell me which, or say "both" to drop them all.'
    )
    expect(chips()).toEqual([
      ['today 12:00', 'remove lunch today at 12:00'],
      ['tomorrow 12:00', 'remove lunch tomorrow at 12:00'],
      ['both', 'remove all lunch'],
    ])
    from = chat().length
    await pick('tomorrow 12:00')
    expect(seen(from)).toEqual([
      'user: remove lunch tomorrow at 12:00',
      'mew: Removed — Lunch (Thursday 12:00).',
    ])
    expect(lunchIds()).toEqual(['l-tue', 'l-wed'])
  })

  it.fails('#124: the ask for three lunches offers "all of them", not "both"', async () => {
    await fresh([lunch('l-tue', TODAY), lunch('l-wed', WED), lunch('l-thu', THU)], {
      at: TUE(9, 0),
    })
    await say('remove the lunch at 12:00')
    await settle()
    expect(lastMew()).toContain('or say "all of them" to drop them all.')
  })
})

/* ── 4 · Friday: a split pair, the room offer, rolling forward ────────── */

describe('RC journey 4: Friday, with a split pair, the room offer and rolling forward', () => {
  /** six lived days of 2h deep work finishing 24 min late: the room offer's evidence */
  function runsLong(today: string): MemoryEvent[] {
    const out: MemoryEvent[] = []
    for (let i = 1; i <= 6; i++) {
      const k = addDaysKey(today, -i)
      const midnight = new Date(k + 'T00:00:00').getTime()
      out.push({
        id: `deep${i}`,
        ts: midnight + (11 * 60 + 24) * 60_000,
        kind: 'completed',
        dayKey: k,
        tag: 'work',
        plannedMin: 120,
        deep: true,
        startMin: 540,
        endMin: 660,
      })
    }
    return out
  }
  const friday = () =>
    fresh(
      [
        block({
          id: 'roadmap',
          title: 'Roadmap draft',
          dayKey: WED,
          startMin: 600,
          endMin: 660,
          protected: false,
        }),
        block({ id: 'spec', title: 'Spec review', dayKey: FRIDAY, startMin: 780, endMin: 900 }),
        block({
          id: 'call',
          title: 'Client call',
          dayKey: FRIDAY,
          startMin: 840,
          endMin: 870,
          protected: false,
          calendarRefs: ['c'],
          external: { calId: 'c', eventId: 'cc' },
        }),
      ],
      { at: FRI(10, 0), memory: runsLong(FRIDAY), settings: { estimateAutosize: 'ask' } }
    )

  it('each change touches only its own blocks: split around a call, give the hour-plus blocks room, roll the draft and one split part', async () => {
    await friday()
    expect(seen(0)).toEqual([
      'nudge: today: 2 blocks, 13:00–15:00 · 2h deep work\nfirst up: Spec review at 13:00\none thing: Spec review and Client call share 30 minutes around 14:00 — one of them may need to drift',
    ])

    await say('split the spec review around the 2pm call')
    await settle()
    expect(lastMew()).toBe(
      'Split — Spec review now runs 13:00–14:00, and Spec review (part 2) picks up 14:30–15:30, around Client call 14:00–14:30. Tucked a 15-min breather into today at 15:30.'
    )

    let from = chat().length
    await say('block inbox sweep, block errands')
    await settle()
    expect(seen(from)).toEqual([
      'user: block inbox sweep, block errands',
      'mew: Done — today 10:00–11:00 is held for inbox sweep, today 11:30–12:30 is held for errands. Friday now holds 4h of deep work — your best is ~2. I can right-size it if you want.',
      'mew: your hour-plus work blocks tend to run ~20% long — want me to give them room? (inbox sweep, errands)',
    ])
    await pick(
      'give them room',
      chat()
        .filter((m) => /give them room/.test(m.body))
        .at(-1)!
    )
    expect(lastMew()).toBe(
      'Gave inbox sweep and errands room — 2 now run about 20% longer, sized to how they really go.'
    )
    const FRI_ROWS = [
      ['inbox sweep', 600, 670, 'open'],
      ['errands', 690, 760, 'open'],
      ['Spec review', 780, 840, 'open'],
      ['Client call', 840, 870, 'open'],
      ['Spec review (part 2)', 870, 930, 'open'],
      ['Breather', 930, 945, 'open'],
    ]
    expect(dayRows(FRIDAY)).toEqual(FRI_ROWS)

    from = chat().length
    useMew.getState().rollForward(['roadmap'], NEXT_MON)
    await settle()
    expect(seen(from)).toEqual([
      'mew: Rolled forward — Roadmap draft now lives in next week. Nothing else moved.',
    ])
    expect(dayRows(FRIDAY)).toEqual(FRI_ROWS)

    const part2 = blocks().find((b) => b.title === 'Spec review (part 2)')!
    from = chat().length
    useMew.getState().rollForward([part2.id], NEXT_MON)
    await settle()
    expect(seen(from)).toEqual([
      'mew: Rolled forward — Spec review (part 2) now lives in next week. Nothing else moved.',
    ])
    expect(dayRows(FRIDAY)).toEqual(
      FRI_ROWS.map((r) => (r[0] === 'Spec review (part 2)' ? [...r.slice(0, 3), 'rolled'] : r))
    )
    expect(dayRows(WED)).toEqual([['Roadmap draft', 600, 660, 'rolled']])
    expect(dayRows('2026-06-17')).toEqual([['Roadmap draft', 480, 540, 'open']])
    expect(dayRows('2026-06-19')).toEqual([['Spec review (part 2)', 480, 540, 'open']])
  })

  it.fails("#123: the weekly review never offers MEW's own breather as carried work", async () => {
    await friday()
    await say('split the spec review around the 2pm call')
    await settle()
    expect(
      useMew
        .getState()
        .openWeeklyReview()
        .carried.map((b) => b.title)
    ).not.toContain('Breather')
  })
})

/* ── 5 · the dial on a past day ──────────────────────────────────────── */

describe('RC journey 5: the dial on a past day', () => {
  it('Monday shows the OOO label and its mew and hides the block rolled forward; next week shows the copy', async () => {
    await fresh(
      [
        ooo('private'),
        block({
          id: 'plan',
          title: 'Planning',
          dayKey: MON,
          startMin: 540,
          endMin: 600,
          status: 'done',
        }),
        block({
          id: 'road',
          title: 'Roadmap',
          dayKey: MON,
          startMin: 840,
          endMin: 900,
          protected: false,
        }),
        block({ id: 'deck', title: 'Deck', startMin: 600, endMin: 660 }),
      ],
      { at: TUE(9, 0) }
    )
    const from = chat().length
    useMew.getState().rollForward(['road'], NEXT_MON)
    await settle()
    expect(seen(from)).toEqual([
      'mew: Rolled forward — Roadmap now lives in next week. Nothing else moved.',
    ])

    useMew.getState().focusDay(MON)
    expect(useMew.getState().focusedDayKey).toBe(MON)
    expect(dayRelation(MON, TODAY)).toBe('past')
    expect(dayTitle(MON)).toBe('Monday, Jun 8')
    /* the span wears its badge on every day it covers, and on no other */
    expect(dialBadges(blocks(), MON).map((b) => b.id)).toEqual(['ooo'])
    expect(dialBadges(blocks(), TODAY).map((b) => b.id)).toEqual(['ooo'])
    expect(dialBadges(blocks(), THU)).toEqual([])
    /* Monday: Planning is its mew; the label and the rolled Roadmap aren't blocks */
    expect(daySummary(blocks(), MON)).toEqual({ blocks: 1, mews: 1, committedMin: 60 })
    expect(daySummary(blocks(), NEXT_MON)).toEqual({ blocks: 1, mews: 0, committedMin: 60 })
    expect(dayRows(NEXT_MON)).toEqual([['Roadmap', 480, 540, 'open']])

    useMew.getState().setWeekOffset(1)
    expect(useMew.getState().focusedDayKey).toBeNull()
  })
})
