/* #15 + #8 — what you tell MEW sticks, through the REAL store with a controllable
   brain. A forget made with the brain on stays forgotten across refreshBrainPrefs,
   even when the brain keeps its copy. A rule told to MEW while the brain was away
   applies once it's back, and replays to the brain exactly once (and not at all
   while the brain is unreachable). What applies is read where the model reads it:
   the week context's rulebook. Adapters faked at their seams. No jsdom. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, MemoryEvent, PrefPayload, Settings } from '../../domain/types'
import { chatOrder } from '../../adapters/storage-port'
import type { ToolExecutor, WeekContext } from '../../adapters/model/types'

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

/* a controllable brain: pref pages upsert by slug; a forgotten-preference page
   retires the pref (unless `stubborn`, a brain that keeps its copy); `reachable`
   drives health(). Everything is off while the port's enabled() gate is off. */
const brainFake = {
  pages: new Map<string, { tags: string[]; pref?: PrefPayload }>(),
  ingests: [] as { slug: string; tags: string[] }[],
  reachable: true,
  stubborn: false,
  /** the brain goes away during its next write: nothing lands, health flips */
  dieOnIngest: false,
  reset() {
    this.pages.clear()
    this.ingests = []
    this.reachable = true
    this.stubborn = false
    this.dieOnIngest = false
  },
  seed(p: PrefPayload) {
    this.pages.set(`pref/${p.kind}-${p.match}`, { tags: ['mew', 'preference', p.kind], pref: p })
  },
}
vi.mock('../../adapters/brain/gbrainHttp', () => ({
  createGbrainHttp: (cfg: { enabled(): boolean }) => ({
    ingest: async (page: { slug: string; tags: string[]; body: string }) => {
      if (!cfg.enabled()) return
      if (brainFake.dieOnIngest) {
        brainFake.reachable = false // swallowed, like the port: warn + health flip
        return
      }
      brainFake.ingests.push({ slug: page.slug, tags: page.tags })
      if (page.tags.includes('forgotten-preference')) {
        if (!brainFake.stubborn) brainFake.pages.delete(page.slug)
        return
      }
      if (page.tags.includes('preference')) {
        const json = page.body.match(/```json\n([\s\S]*?)\n```/)?.[1]
        brainFake.pages.set(page.slug, {
          tags: page.tags,
          pref: json ? JSON.parse(json) : undefined,
        })
      }
    },
    recall: async () => [],
    health: async () => cfg.enabled() && brainFake.reachable,
    listPrefs: async () =>
      cfg.enabled()
        ? [...brainFake.pages.values()]
            .filter((p) => p.tags.includes('preference') && p.pref)
            .map((p) => p.pref!)
        : [],
    links: async () => [],
  }),
}))

/* a scripted local model that keeps the week context it was handed */
const scriptedModel = { lastCtx: null as WeekContext | null }
vi.mock('../../adapters/model/aiAdapter', () => ({
  createAiAdapter: (spec: { provider: string }) => ({
    id: spec.provider,
    async *converse(_thread: unknown, ctx: unknown, _exec: ToolExecutor) {
      if (spec.provider !== 'ollama') throw Object.assign(new Error('offline'), { statusCode: 503 })
      scriptedModel.lastCtx = ctx as WeekContext
      yield 'noted.'
    },
  }),
}))

import { useMew } from '../store'

const pristine = useMew.getState()
const TUE = new Date(2026, 5, 9, 11, 0)
const GYM: PrefPayload = {
  kind: 'time-default',
  match: 'gym',
  value: 'starts 07:00',
  stated: 'gym at 7',
}
const LUNCH: PrefPayload = {
  kind: 'time-default',
  match: 'lunch',
  value: 'starts 12:30',
  stated: 'lunch at 12:30',
}
const DECK: PrefPayload = {
  kind: 'duration-default',
  match: 'deck',
  value: '90m',
  stated: 'the deck takes 90 minutes',
}
/* any lived memory keeps the turn off the first-run path, so it reaches the model */
const LIVED: MemoryEvent = {
  id: 'lived',
  ts: 1,
  kind: 'nudge_outcome',
  dayKey: '2026-06-01',
  nudgeType: 'drift',
  outcome: 'accepted',
}
const said = (p: PrefPayload): MemoryEvent => ({
  id: `said-${p.match}`,
  ts: 1,
  kind: 'preference',
  dayKey: '2026-06-01',
  pref: p,
})

/* the replay ledger is per session per brain (module-level in the store), so each
   replay test talks to its own brain URL */
async function fresh(memory: MemoryEvent[], brainOn: boolean, brainUrl = 'http://brain.test') {
  fakeDb.reset()
  memory.forEach((e) => fakeDb.memory.set(e.id, e))
  fakeDb.settings = {
    ...pristine.settings,
    modelLocation: 'local',
    sustenance: 'off',
    brainEnabled: brainOn,
    brainUrl,
    brainToken: 't',
  }
  vi.setSystemTime(TUE)
  useMew.setState(
    { ...pristine, lastTickDay: '2026-06-09', nowMs: TUE.getTime(), lastActivityMs: TUE.getTime() },
    true
  )
  await useMew.getState().hydrate()
  await flush()
}
/** drain the fire-and-forget brain reads/writes (listPrefs → replay → ingest) */
const flush = async () => {
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0)
}
/** what applies, read where the model reads it */
const rulebook = async (): Promise<string[]> => {
  scriptedModel.lastCtx = null
  await useMew.getState().speak('what should I keep in mind today?')
  await flush()
  return scriptedModel.lastCtx!.prefLines
}
const reconnect = async () => {
  useMew.getState().updateSettings({ brainEnabled: false })
  useMew.getState().updateSettings({ brainEnabled: true })
  await flush()
}
const prefIngests = (slug: string) => brainFake.ingests.filter((i) => i.slug === slug).length

beforeEach(() => {
  vi.useFakeTimers()
  brainFake.reset()
})
afterEach(() => vi.useRealTimers())

describe('#15 — a forget sticks with the brain on', () => {
  it('stays forgotten across refreshBrainPrefs, even when the brain keeps its copy', async () => {
    brainFake.seed(GYM)
    brainFake.stubborn = true
    await fresh([said(GYM)], true)
    expect((await rulebook()).some((l) => l.startsWith('gym →'))).toBe(true)

    useMew.getState().forgetStandingPref(GYM)
    await flush()
    await reconnect() // a second refreshBrainPrefs: the stubborn brain still lists gym
    expect([...brainFake.pages.keys()]).toContain('pref/time-default-gym')
    expect((await rulebook()).some((l) => l.startsWith('gym →'))).toBe(false)
    /* the tombstone is persisted, so it holds across a restart too */
    expect(
      [...fakeDb.memory.values()].some((e) => (e as MemoryEvent).kind === 'forgotten_pref')
    ).toBe(true)
  })

  it('a cooperative brain retires its copy', async () => {
    brainFake.seed(GYM)
    await fresh([said(GYM)], true)
    useMew.getState().forgetStandingPref(GYM)
    await flush()
    expect(brainFake.pages.has('pref/time-default-gym')).toBe(false)
    expect((await rulebook()).some((l) => l.startsWith('gym →'))).toBe(false)
  })

  it('remembering it again brings it back', async () => {
    brainFake.seed(GYM)
    brainFake.stubborn = true
    await fresh([said(GYM)], true)
    useMew.getState().forgetStandingPref(GYM)
    await flush()
    useMew.getState().saveStandingPref({ ...GYM, value: 'starts 06:30' })
    await flush()
    expect((await rulebook()).some((l) => l.startsWith('gym → starts 06:30'))).toBe(true)
  })
})

describe('#15 — told while the brain was away, it applies and replays once', () => {
  it('a brain-down rule applies after reconnect and replays to the brain exactly once', async () => {
    brainFake.seed(GYM) // the brain already holds some other rule
    await fresh([LIVED], false)
    useMew.getState().saveStandingPref(LUNCH) // brain off: local only
    await flush()
    expect(prefIngests('pref/time-default-lunch')).toBe(0)

    await reconnect()
    expect(prefIngests('pref/time-default-lunch')).toBe(1)
    const lines = await rulebook()
    expect(lines.some((l) => l.startsWith('lunch →'))).toBe(true) // local-only rule applies with the brain on
    expect(lines.some((l) => l.startsWith('gym →'))).toBe(true) // and the brain's own rule joins

    /* reconnecting again never replays it twice, even if the brain lost the page */
    await reconnect()
    brainFake.pages.delete('pref/time-default-lunch')
    await reconnect()
    expect(prefIngests('pref/time-default-lunch')).toBe(1)
  })

  /* peer review of #68 (coderpa): a write the brain never took must not stay
     claimed — the ledger means "landed", not "attempted" */
  it('a brain that goes away mid-replay releases the claim; the next reachable connect replays each once', async () => {
    await fresh([said(LUNCH), said(DECK)], false, 'http://brain-3.test')
    brainFake.dieOnIngest = true
    await reconnect()
    expect(prefIngests('pref/time-default-lunch')).toBe(0)
    expect(prefIngests('pref/duration-default-deck')).toBe(0)

    brainFake.dieOnIngest = false
    brainFake.reachable = true
    await reconnect()
    expect(prefIngests('pref/time-default-lunch')).toBe(1)
    expect(prefIngests('pref/duration-default-deck')).toBe(1)
    await reconnect()
    expect(prefIngests('pref/time-default-lunch')).toBe(1) // and still exactly once
  })

  it('an unreachable brain claims nothing; the next reachable connect replays', async () => {
    await fresh([said(LUNCH)], false, 'http://brain-2.test')
    brainFake.reachable = false
    await reconnect()
    expect(prefIngests('pref/time-default-lunch')).toBe(0)
    brainFake.reachable = true
    await reconnect()
    expect(prefIngests('pref/time-default-lunch')).toBe(1)
  })
})
