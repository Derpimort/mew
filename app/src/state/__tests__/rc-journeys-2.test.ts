/* RC journeys, round 2 (tsk_01m2rdpd9a4pj4mk1nbp4trfha): everything the RC gained
   AFTER round 1 (#125) — batch shift and retag, split and merge-back, undo reaching
   the previous message, the remove ask's typed answers, "tonight", one length on a
   re-plan, and MEW's own scaffolding kept out of carried work, open items and the
   rail — meeting on ONE week, the way an owner meets them.
   Each journey drives the real store (keyless floor unless it says keyed) and
   asserts, step by step, both the WEEK and the CHAT the owner would see.
   Test-only: a journey that finds a bug pins it as a filed issue (it.fails with
   the issue number), never a fix in this file. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChatMessage, MemoryEvent, Settings } from '../../domain/types'
import { chatOrder } from '../../adapters/storage-port'
import * as week from '../../domain/week'

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

/** keeps the week from being brand new, far from every journey's day */
const anchor = () =>
  block({ id: 'anchor', title: 'Standup', dayKey: WED, startMin: 540, endMin: 555 })

/* ── 6 · a split day, a batch shift over it, and one undo ────────────── */

describe('RC journey 6: a split pair, a seeded meal and a protected rest meet a batch shift', () => {
  /** Tuesday afternoon: the owner's Deck, a calendar call inside it, and a
      protected evening walk — with sustenance on, so MEW's own lunch, dinner
      and pacing breather sit on the same day. */
  const afternoon = () => [
    block({ id: 'deck', title: 'Deck', startMin: 15 * 60, endMin: 18 * 60, protected: false }),
    block({
      id: 'call',
      title: 'Client call',
      startMin: 16 * 60,
      endMin: 16 * 60 + 30,
      calendarRefs: ['c'],
      external: { calId: 'c', eventId: 'call-ev' },
    }),
    block({
      id: 'walk',
      title: 'Evening walk',
      tag: 'rest',
      startMin: 18 * 60 + 30,
      endMin: 19 * 60 + 15,
      protected: true,
    }),
  ]

  it('the batch offers only what can move, names what stays and why, and one undo puts it back', async () => {
    await fresh(afternoon(), { settings: { sustenance: 'on' } })
    /* MEW placed three things on this day; the owner placed three */
    expect(
      blocks()
        .filter((b) => b.placedBy)
        .map((b) => b.title)
    ).toEqual(['Lunch', 'Dinner', 'Breather'])

    /* 1 · the split (#107) works around the calendar call, and moves MEW's own
       breather aside rather than the owner's work */
    let from = chat().length
    await say('split the deck around the 4pm call')
    await settle()
    expect(seen(from)).toEqual([
      'user: split the deck around the 4pm call',
      'mew: Split — Deck now runs 15:00–16:00, and Deck (part 2) picks up 16:30–18:30, around Client call 16:00–16:30 — moved Breather to 19:15 to clear Deck (part 2).',
    ])
    const afterSplit = dayRows(TODAY)
    expect(afterSplit).toEqual([
      ['Lunch', 720, 765, 'open'],
      ['Deck', 900, 960, 'open'],
      ['Client call', 960, 990, 'open'],
      ['Deck (part 2)', 990, 1110, 'open'],
      ['Evening walk', 1110, 1155, 'open'],
      ['Breather', 1155, 1170, 'open'],
      ['Dinner', 1170, 1230, 'open'],
    ])

    /* 2 · the batch (#110) offers first, moves nothing yet, and names each block
       that stays with the reason — the calendar event, and the half of the split
       whose new time would sit over it */
    from = chat().length
    await say('push all work after 3pm back 30 min')
    await settle()
    expect(seen(from)).toEqual([
      'user: push all work after 3pm back 30 min',
      'mew: move 1 block 30 min later today? Deck (part 2) 16:30→17:00. Client call 16:00 (from your calendar) and Deck 15:00 (would sit over Client call 16:00–16:30) stay where they are. Deck (part 2) 17:00 would share time with Evening walk 18:30–19:15.',
    ])
    expect(chips().map(([label]) => label)).toEqual(['do it', 'not now'])
    expect(chips()[0][1]).toMatch(
      /^push all work after 15:00 today later by 30 min — yes, all 1 · [a-z0-9]+$/
    )
    expect(dayRows(TODAY)).toEqual(afterSplit) // an offer changes nothing

    /* 3 · the pick moves exactly the one block it listed, and the protected rest
       it now runs over is named in #122's words, never as "flexible" (#141) */
    from = chat().length
    await pick('do it')
    expect(seen(from).at(-1)).toBe(
      'mew: Moved 1 block 30 min later today — Deck (part 2) 16:30→17:00. Client call 16:00 (from your calendar) and Deck 15:00 (would sit over Client call 16:00–16:30) stay where they are. — it runs over your evening walk 18:30–19:15'
    )
    expect(dayRows(TODAY)).toEqual([
      ['Lunch', 720, 765, 'open'],
      ['Deck', 900, 960, 'open'],
      ['Client call', 960, 990, 'open'],
      ['Deck (part 2)', 1020, 1140, 'open'],
      ['Evening walk', 1110, 1155, 'open'],
      ['Breather', 1155, 1170, 'open'],
      ['Dinner', 1170, 1230, 'open'],
    ])

    /* 4 · "undo that" (#130) reaches the batch through the pick's own message
       and puts the whole day back exactly as the split left it */
    from = chat().length
    await say('undo that')
    await settle()
    expect(seen(from)).toEqual([
      'user: undo that',
      'mew: Undone — put Deck (part 2) back where it was.',
    ])
    expect(dayRows(TODAY)).toEqual(afterSplit)
  })
})

/* ── 7 · the remove ask, answered in words, then taken back ──────────── */

describe('RC journey 7: three lunches, a count that does not fit, and one undo', () => {
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

  it('a mismatched count changes nothing and brings the chips back, a day word removes exactly one, and "undo that" returns it', async () => {
    await fresh([lunch('l-tue', TODAY), lunch('l-wed', WED), lunch('l-thu', THU), anchor()])

    /* 1 · three same-titled blocks ahead: MEW asks rather than guessing, and
       #124's line names the all-chip in its own words ("all of them", not "both") */
    let from = chat().length
    await say('remove lunch')
    await settle()
    expect(seen(from)).toEqual([
      'user: remove lunch',
      'mew: 3 "lunch" blocks ahead — the 12:00 (12:00–12:45), the 12:00 (Wednesday 12:00–12:45), or the 12:00 (Thursday 12:00–12:45)? Tell me which, or say "all of them" to drop them all.',
    ])
    expect(chips()).toEqual([
      ['today 12:00', 'remove lunch today at 12:00'],
      ['tomorrow 12:00', 'remove lunch tomorrow at 12:00'],
      ['thursday 12:00', 'remove lunch on thursday at 12:00'],
      ['all of them', 'remove all lunch'],
    ])

    /* 2 · a count word that doesn't fit the ask (#140): nothing is removed,
       nothing lands in the inbox, and the ask's own chips come back with the
       line so the next word still has somewhere to land */
    from = chat().length
    await say('all 2')
    await settle()
    expect(seen(from)).toEqual([
      'user: all 2',
      'mew: 3 "lunch" blocks ahead — say "all of them" to drop all 3, or tell me which one.',
    ])
    expect(chips()).toEqual([
      ['today 12:00', 'remove lunch today at 12:00'],
      ['tomorrow 12:00', 'remove lunch tomorrow at 12:00'],
      ['thursday 12:00', 'remove lunch on thursday at 12:00'],
      ['all of them', 'remove all lunch'],
    ])
    expect(blocks().filter((b) => b.title === 'Lunch')).toHaveLength(3)

    /* 3 · a day in words answers the re-posted ask through the chip's own path:
       the log shows what MEW acted on, and exactly one lunch goes */
    from = chat().length
    await say('the thursday one')
    await settle()
    expect(seen(from)).toEqual([
      'user: remove lunch on thursday at 12:00',
      'mew: Removed — Lunch (Thursday 12:00).',
    ])
    expect(blocks().map((b) => [b.title, b.dayKey])).toEqual([
      ['Lunch', TODAY],
      ['Lunch', WED],
      ['Standup', WED],
    ])

    /* 4 · undo reaches it from the very next message (#130) */
    from = chat().length
    await say('undo that')
    await settle()
    expect(seen(from)).toEqual(['user: undo that', 'mew: Undone — brought back Lunch.'])
    expect(blocks().map((b) => [b.title, b.dayKey])).toEqual([
      ['Lunch', TODAY],
      ['Lunch', WED],
      ['Lunch', THU],
      ['Standup', WED],
    ])

    /* not one of those words became a thought for the inbox */
    expect(useMew.getState().captures).toEqual([])
  })
})

/* ── 8 · a retag over a day that holds what MEW may not touch ────────── */

describe('RC journey 8: retagging a selection that includes a calendar event and a repeating block', () => {
  const call = (
    id: string,
    title: string,
    startMin: number,
    endMin: number,
    over: Partial<Block> = {}
  ) =>
    block({ id, title, dayKey: WED, startMin, endMin, tag: 'private', protected: false, ...over })
  const day = () => [
    call('c1', 'Client call', 540, 570),
    call('c2', 'Vendor call', 660, 690),
    call('c3', 'Board call', 900, 960, {
      calendarRefs: ['c'],
      external: { calId: 'c', eventId: 'bc' },
    }),
    call('c4', 'Standup call', 1020, 1035, { recurringBlockId: 'r1' }),
  ]

  it('the offer names what it will not touch, the pick changes only tags, and the week never moves', async () => {
    await fresh(day())

    /* 1 · four blocks match "calls", but two of them are not MEW's to change:
       the calendar event and the repeating occurrence are named, not silently
       dropped, and the offer comes first because three or more were selected */
    let from = chat().length
    await say("tag all of tomorrow's calls as work")
    await settle()
    expect(seen(from)).toEqual([
      "user: tag all of tomorrow's calls as work",
      'mew: tag 2 blocks as work tomorrow? Client call 9:00 · Vendor call 11:00. Board call 15:00 (from your calendar) and Standup call 17:00 (repeats) keep their tags.',
    ])
    expect(chips().map(([label]) => label)).toEqual(['do it', 'not now'])
    expect(blocks().map((b) => b.tag)).toEqual(['private', 'private', 'private', 'private'])

    /* 2 · the pick retags exactly the two it listed and moves nothing at all */
    from = chat().length
    await pick('do it')
    expect(seen(from).at(-1)).toBe(
      'mew: Tagged 2 blocks as work tomorrow — Client call 9:00 · Vendor call 11:00. Board call 15:00 (from your calendar) and Standup call 17:00 (repeats) keep their tags.'
    )
    expect(blocks().map((b) => [b.title, b.tag, b.startMin, b.endMin])).toEqual([
      ['Client call', 'work', 540, 570],
      ['Vendor call', 'work', 660, 690],
      ['Board call', 'private', 900, 960],
      ['Standup call', 'private', 1020, 1035],
    ])

    /* 3 · one undo puts both tags back, times still untouched */
    await say('undo that')
    await settle()
    expect(blocks().map((b) => [b.title, b.tag, b.startMin])).toEqual([
      ['Client call', 'private', 540],
      ['Vendor call', 'private', 660],
      ['Board call', 'private', 900],
      ['Standup call', 'private', 1020],
    ])
  })

  /* 4 · the sentence that comes back with it — filed as #149. The week is right
     (step 3 proves it); only the receipt is wrong, calling a retag a move. */
  it.fails(
    '#149: undoing a retag does not say the blocks were put back WHERE they were',
    async () => {
      await fresh(day())
      await say("tag all of tomorrow's calls as work")
      await settle()
      await pick('do it')
      await say('undo that')
      await settle()
      expect(lastMew()).not.toContain('back where they were')
    }
  )
})

/* ── 9 · Friday evening: the review, the roll, and what counts as yours ─ */

describe("RC journey 9: MEW helped build the week, and none of its help is the owner's unfinished work", () => {
  it("the review carries only the owner's work, rolling one moves only it, and the evening's lists leave MEW's dinner out", async () => {
    await fresh(
      [
        block({
          id: 'deck',
          title: 'Deck',
          dayKey: WED,
          startMin: 600,
          endMin: 660,
          protected: false,
        }),
        block({
          id: 'spec',
          title: 'Spec review',
          dayKey: FRIDAY,
          startMin: 780,
          endMin: 840,
          protected: false,
        }),
        block({
          id: 'sam',
          title: 'lunch with sam',
          tag: 'private',
          dayKey: FRIDAY,
          startMin: 720,
          endMin: 780,
          protected: false,
        }),
      ],
      { at: FRI(17, 0), settings: { sustenance: 'on' } }
    )
    /* MEW placed a dinner on Friday and left the owner's own lunch alone */
    expect(
      blocks()
        .filter((b) => b.placedBy)
        .map((b) => [b.title, b.dayKey])
    ).toEqual([['Dinner', FRIDAY]])

    /* 1 · the weekly review (#138): three unfinished blocks are the owner's,
       and the dinner MEW placed is not one of them */
    expect(
      useMew
        .getState()
        .openWeeklyReview()
        .carried.map((b) => b.title)
    ).toEqual(['Deck', 'Spec review', 'lunch with sam'])

    /* 2 · rolling one really moves that one, and says so */
    const from = chat().length
    useMew.getState().rollForward(['deck'], NEXT_MON)
    await settle()
    expect(seen(from)).toEqual([
      'mew: Rolled forward — Deck now lives in next week. Nothing else moved.',
    ])
    expect(blocks().map((b) => [b.title, b.dayKey, b.status])).toEqual([
      ['Deck', WED, 'rolled'],
      ['Spec review', FRIDAY, 'open'],
      ['lunch with sam', FRIDAY, 'open'],
      ['Dinner', FRIDAY, 'open'],
      ['Deck', '2026-06-17', 'open'],
    ])

    /* 3 · later that evening, with the dinner's window behind it and the owner's
       own work still open: the day's open items (#144) and the loose-threads
       rail (#147) both leave MEW's dinner out, while the owner's lunch — which
       they asked for themselves — is in both */
    rollTo(FRI(20, 0))
    await settle()
    expect(week.openItems(blocks(), FRIDAY).map((b) => b.title)).toEqual([
      'lunch with sam',
      'Spec review',
    ])
    expect(week.looseThreads(blocks(), [], FRIDAY, 20 * 60).slipped.map((b) => b.title)).toEqual([
      'lunch with sam',
      'Spec review',
    ])
    /* and the day is not "clear" — because the owner's work is open, not
       because MEW's dinner is */
    expect(week.dayClear(blocks(), FRIDAY)).toBe(false)
  })
})
