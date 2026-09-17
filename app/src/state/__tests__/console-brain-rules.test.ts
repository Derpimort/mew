/* #71 — the memory console shows what APPLIES, brain-only rules included, and lets
   the owner forget them. Through the REAL store with #68's controllable brain: a
   rule the brain holds that nothing local decided joins the rulebook the
   planners read, so it must be visible in the console with a quiet "from your
   brain" mark, spoken the same by the keyless "what do you know about me?"
   reply, and gone the moment the owner forgets it (and after a refresh, even
   with a brain that keeps its copy). With the brain off, the console is exactly
   the local rulebook, as before. No jsdom; the presenter runs as the card does. */

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
  /** the list call fails — the real port swallows it and lists nothing */
  listFails: false,
  reset() {
    this.pages.clear()
    this.ingests = []
    this.reachable = true
    this.stubborn = false
    this.dieOnIngest = false
    this.listFails = false
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
      cfg.enabled() && !brainFake.listFails
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

beforeEach(() => {
  vi.useFakeTimers()
  brainFake.reset()
})
afterEach(() => vi.useRealTimers())

import { memoryConsole } from '../../domain/console'
import { aggregates } from '../../domain/memory'
import { computeInsights } from '../../domain/insights'
import { standingRulebook, activePrefsFrom } from '../store'

const YOGA: PrefPayload = {
  kind: 'time-default',
  match: 'yoga',
  value: 'starts 18:00',
  stated: 'yoga at 6pm',
}

/** the console card's data, built exactly as SettingsPage's MemoryConsoleFromStore builds it */
const card = () => {
  const s = useMew.getState()
  const now = new Date(s.nowMs)
  return memoryConsole({
    events: s.memory,
    ...standingRulebook(s),
    insights: computeInsights(s.memory, aggregates(s.memory, now), now),
  })
}
const row = (match: string) => card().standingRules.find((r) => r.match === match)
/** the keyless summary the model context carries (the "what do you know about me?" reply) */
const known = async (): Promise<string[]> => {
  await rulebook()
  return scriptedModel.lastCtx!.knownLines ?? []
}

describe('#71 — brain on: a brain-only rule is listed, marked, and applies', () => {
  it('the console lists it with the brain mark; a local rule reads as your own', async () => {
    brainFake.seed(YOGA)
    await fresh([LIVED, said(GYM)], true, 'http://brain-71a.test')
    expect(row('yoga')).toMatchObject({ value: 'starts 18:00', fromBrain: true })
    expect(row('gym')).toBeDefined()
    expect(Object.keys(row('gym')!)).not.toContain('fromBrain')
    // it applies — the planners read the same rulebook
    expect((await rulebook()).some((l) => l.startsWith('yoga →'))).toBe(true)
  })

  it('the keyless summary speaks the same rows, the brain one marked', async () => {
    brainFake.seed(YOGA)
    await fresh([LIVED, said(GYM)], true, 'http://brain-71b.test')
    const lines = await known()
    expect(lines).toContain('• from your brain: yoga → starts 18:00')
    expect(lines).toContain('• you told me: gym → starts 07:00')
  })

  it('a rule both hold is local — the brain copy never marks or duplicates it', async () => {
    brainFake.seed(GYM)
    brainFake.seed(YOGA)
    await fresh([LIVED, said(GYM)], true, 'http://brain-71c.test')
    const rules = card().standingRules
    expect(rules.filter((r) => r.match === 'gym')).toHaveLength(1)
    expect(Object.keys(row('gym')!)).not.toContain('fromBrain')
    expect(row('yoga')!.fromBrain).toBe(true)
  })

  it('an unreachable brain adds nothing — brain rows appear only once a brain answered', async () => {
    brainFake.seed(YOGA)
    brainFake.reachable = false
    brainFake.listFails = true
    await fresh([LIVED, said(GYM)], true, 'http://brain-71d.test')
    expect(row('yoga')).toBeUndefined()
    expect((await known()).join('\n')).not.toMatch(/from your brain/)
  })
})

describe('#71 — forget on a brain-only row', () => {
  it('stops it applying at once, and it stays gone after a refresh with a brain that keeps its copy', async () => {
    brainFake.seed(YOGA)
    brainFake.stubborn = true
    await fresh([LIVED], true, 'http://brain-71e.test')
    const r = row('yoga')!
    expect(r.fromBrain).toBe(true)

    useMew.getState().forgetStandingPref(r.pref) // the row's forget calls exactly this
    await flush()
    expect(row('yoga')).toBeUndefined()
    expect((await rulebook()).some((l) => l.startsWith('yoga →'))).toBe(false)
    // the brain was told (its page retired), even though this one keeps a copy
    expect(brainFake.ingests.some((i) => i.slug === 'pref/time-default-yoga')).toBe(true)

    await reconnect() // refreshBrainPrefs again: the stubborn brain still lists yoga
    expect([...brainFake.pages.keys()]).toContain('pref/time-default-yoga')
    expect(row('yoga')).toBeUndefined()
    expect((await rulebook()).some((l) => l.startsWith('yoga →'))).toBe(false)
  })
})

describe('#71 — brain off: the console is the local rulebook, byte-identical', () => {
  it('a stale brain list never shows once the effective brain is off (a sidecar gone without a refresh)', async () => {
    brainFake.seed(YOGA)
    await fresh([LIVED, said(GYM)], true, 'http://brain-71g.test')
    expect(row('yoga')?.fromBrain).toBe(true)
    // the brain goes off WITHOUT refreshBrainPrefs clearing the cached list
    useMew.setState((st) => ({ settings: { ...st.settings, brainEnabled: false } }))
    expect(useMew.getState().brainPrefs).not.toBeNull() // the stale copy is still there…
    expect(row('yoga')).toBeUndefined() // …and the console never shows it
    expect(row('gym')).toBeDefined()
  })

  it('no brain row, no mark, the same data as the local-only presenter', async () => {
    brainFake.seed(YOGA)
    await fresh([LIVED, said(GYM), said(LUNCH)], false, 'http://brain-71f.test')
    const s = useMew.getState()
    const now = new Date(s.nowMs)
    const localOnly = memoryConsole({
      events: s.memory,
      prefs: activePrefsFrom(s.memory, null),
      insights: computeInsights(s.memory, aggregates(s.memory, now), now),
    })
    expect(card()).toEqual(localOnly)
    expect(JSON.stringify(card())).not.toMatch(/fromBrain/)
  })
})
