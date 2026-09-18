/* #96, through the REAL store: one clock per turn. The store clock (nowMs) only
   moves on a tick, so in the seconds after midnight before one lands, the wall
   clock is already Wednesday while the store still says Tuesday. A turn now
   brings the store clock to now first, and the rules floor counts day words from
   that same clock, so "on thursday" means Thursday for the parse AND for the
   executor that resolves it — keyless and keyed alike. Adapters faked at their
   seams (the dayload harness + a scripted local model); no jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block } from '../../domain/types'
import {
  aiAdapterMock,
  brainMock,
  desktopMock,
  fakeDb,
  notifyMock,
  scriptedModel,
  storageMock,
} from './storeHarness'

/* the five adapter seams. The CALLS stay here because vitest hoists vi.mock
   above this file's own imports, and each factory must be an inline arrow that
   CALLS the shared builder rather than the builder itself: passing the imported
   binding directly is dereferenced at hoist time and throws "Cannot access
   __vi_import_0__ before initialization". Inside the arrow it is read lazily,
   when the mocked module is first imported. */
vi.mock('../../adapters/storage', () => storageMock())
vi.mock('../../adapters/desktop', () => desktopMock())
vi.mock('../../adapters/notify', () => notifyMock())
vi.mock('../../adapters/brain/gbrainHttp', () => brainMock())
vi.mock('../../adapters/model/aiAdapter', () => aiAdapterMock())

import { useMew } from '../store'

/* ── harness ──────────────────────────────────────────────────────── */

const pristine = useMew.getState()
const TUE = '2026-06-09'
const WED = '2026-06-10'
const THU = '2026-06-11'
const TUE_235958 = new Date(2026, 5, 9, 23, 59, 58)
const WED_000002 = new Date(2026, 5, 10, 0, 0, 2)

function block(over: Partial<Block>): Block {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: 'Groceries',
    tag: 'private',
    dayKey: WED,
    startMin: 14 * 60,
    endMin: 15 * 60,
    protected: false,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

/** Boots at Tue 23:59:58 and ticks there, then lets the wall clock pass
    midnight WITHOUT a tick: the store still says Tuesday, the wall Wednesday. */
async function atTheSeam(blocks: Block[], location: 'remote' | 'local' = 'remote') {
  fakeDb.reset()
  blocks.forEach((b) => fakeDb.blocks.set(b.id, b))
  fakeDb.settings = { ...pristine.settings, modelLocation: location, sustenance: 'off' }
  vi.setSystemTime(TUE_235958)
  useMew.setState(
    {
      ...pristine,
      lastTickDay: TUE,
      nowMs: TUE_235958.getTime(),
      lastActivityMs: TUE_235958.getTime(),
    },
    true
  )
  await useMew.getState().hydrate()
  /* hydrate seeds its own settings on a first run; the model location rides in after */
  useMew.getState().updateSettings({ modelLocation: location, sustenance: 'off' })
  useMew.getState().tick()
  vi.setSystemTime(WED_000002) // midnight passes; no tick has landed yet
  expect(useMew.getState().nowMs).toBe(TUE_235958.getTime())
}

const blocks = () => useMew.getState().blocks
const byId = (id: string) => blocks().find((b) => b.id === id)
const say = (text: string) => useMew.getState().speak(text)
const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  scriptedModel.reset()
  /* this file's own inline adapter always yielded one chunk before midTurn */
  scriptedModel.chunks = ['on it.']
})
afterEach(() => {
  vi.useRealTimers()
})

describe('#96 — a turn in the seconds after midnight reads one clock', () => {
  it('the probe: "remove the Groceries on thursday at 14:00" removes Thursday\'s, never Wednesday\'s', async () => {
    await atTheSeam([block({ id: 'g-wed' }), block({ id: 'g-thu', dayKey: THU })])
    await say('remove the Groceries on thursday at 14:00')
    await settle()
    expect(byId('g-thu')).toBeUndefined()
    expect(byId('g-wed')).toBeDefined()
    expect(useMew.getState().nowMs).toBe(WED_000002.getTime()) // the turn's clock is now
  })

  it('a move: "move the Deck polish to thursday" lands on Thursday', async () => {
    await atTheSeam([
      block({ id: 'deck', title: 'Deck polish', tag: 'work', startMin: 10 * 60, endMin: 11 * 60 }),
    ])
    await say('move the Deck polish to thursday')
    await settle()
    expect(byId('deck')!.dayKey).toBe(THU)
  })

  it('a plan: "tomorrow", said on Wednesday, is Thursday', async () => {
    await atTheSeam([])
    await say('block 1h for the budget review tomorrow at 9')
    await settle()
    expect(blocks().find((b) => b.title === 'budget review')).toMatchObject({
      dayKey: THU,
      startMin: 9 * 60,
    })
  })

  it('keyed: the model is told Wednesday, and a tool call for day +1 lands on Thursday', async () => {
    await atTheSeam([], 'local')
    scriptedModel.midTurn = (exec) => {
      exec.plan({
        places: [
          { title: 'budget review', tag: 'work', dayOffset: 1, startMin: 9 * 60, durationMin: 60 },
        ],
        frees: [],
      })
    }
    await say('put the budget review tomorrow at 9')
    await settle()
    expect(scriptedModel.ctxToday).toBe(WED)
    expect(blocks().find((b) => b.title === 'budget review')!.dayKey).toBe(THU)
  })

  it('the rules floor follows the store clock when the wall clock steps back', async () => {
    await atTheSeam([block({ id: 'g-wed' }), block({ id: 'g-thu', dayKey: THU })])
    /* the store already says Wednesday (a tick landed), then the wall clock steps
       back a few seconds (a clock correction) */
    useMew.setState({ nowMs: WED_000002.getTime(), lastTickDay: WED })
    vi.setSystemTime(TUE_235958)
    await say('remove the Groceries on thursday at 14:00')
    await settle()
    expect(byId('g-thu')).toBeUndefined() // Thursday counted from Wednesday by parse AND executor
    expect(byId('g-wed')).toBeDefined()
  })

  it('the turn clock never runs backwards: a model turn after a wall-clock step back is still told Wednesday', async () => {
    await atTheSeam([], 'local')
    useMew.setState({ nowMs: WED_000002.getTime(), lastTickDay: WED })
    vi.setSystemTime(TUE_235958)
    await say('what does thursday look like')
    await settle()
    expect(scriptedModel.ctxToday).toBe(WED)
  })
})
