import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenAIAdapter } from '../openai'
import { createRulesAdapter } from '../rules'
import { runTool } from '../tools'
import type { ConverseChunk, ToolExecutor, WeekContext } from '../types'

const NOW = () => new Date(2026, 5, 9, 9, 40) // Tuesday, June 9

const ctx: WeekContext = {
  todayKey: '2026-06-09',
  todayLabel: 'Tuesday, June 9',
  nowLabel: '9:40',
  weekSummary: ['today (2026-06-09): 9:00 Q3 deck [work]'],
  realisticBestH: 5.5,
  mewsToday: 2,
  recallLines: [],
  prefLines: [],
  insightLines: ['mornings hold: 9/10 finished there'],
}

function mockExec(): ToolExecutor & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    plan: vi.fn((places, frees) => {
      calls.push('plan')
      return `Done — placed ${places.length}, freed ${frees.length}.`
    }),
    complete: vi.fn((q) => {
      calls.push('complete')
      return `Marked ${q} done.`
    }),
    move: vi.fn((q) => {
      calls.push('move')
      return `Moved ${q}.`
    }),
    capture: vi.fn((t) => {
      calls.push('capture')
      return `Captured "${t}".`
    }),
    edit: vi.fn((q) => {
      calls.push('edit')
      return `Updated ${q}.`
    }),
    remove: vi.fn((q) => {
      calls.push('remove')
      return `Removed ${q}.`
    }),
    analyze: vi.fn((d) => {
      calls.push('analyze')
      return `Day shape (offset ${d}).`
    }),
    findSlot: vi.fn((dur, d, nb, na) => {
      calls.push('findSlot')
      return `Slot ${dur}m day ${d} [${nb ?? '-'},${na ?? '-'}].`
    }),
    suggestSlots: vi.fn((title, _tag, dur) => {
      calls.push('suggestSlots')
      return `Best slots for "${title}" (${dur}m): today 09:00–10:00.`
    }),
    remember: vi.fn((pref: { match: string; value: string }) => {
      calls.push('remember')
      return `Remembered — ${pref.match} ${pref.value}.`
    }),
    queryBrain: vi.fn(async (q: string) => {
      calls.push('queryBrain')
      return `Spicanova this week: 2.5h across 2 blocks. (asked: ${q})`
    }),
    clear: vi.fn((scope) => {
      calls.push('clear')
      return `Cleared ${scope}.`
    }),
  }
}

async function collect(it: AsyncIterable<ConverseChunk>): Promise<string> {
  let out = ''
  for await (const c of it) if (typeof c === 'string') out += c
  return out
}

describe('rules adapter — converse', () => {
  it('greets back without touching the week', async () => {
    const exec = mockExec()
    const reply = await collect(
      createRulesAdapter(NOW).converse([{ role: 'user', text: 'hello pixie' }], ctx, exec),
    )
    expect(reply).toMatch(/what should the week hold/)
    expect(exec.calls).toHaveLength(0)
  })

  it('runs the canonical plan through the executor and answers with its facts', async () => {
    const exec = mockExec()
    const reply = await collect(
      createRulesAdapter(NOW).converse(
        [{ role: 'user', text: 'block thursday morning for the deck, keep friday afternoon free' }],
        ctx,
        exec,
      ),
    )
    expect(exec.plan).toHaveBeenCalledOnce()
    const [places, frees] = (exec.plan as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(places[0]).toMatchObject({ title: 'deck', tag: 'work', dayOffset: 2, startMin: 540 })
    expect(frees[0]).toMatchObject({ dayOffset: 3, startMin: 780 })
    expect(reply).toBe('Done — placed 1, freed 1.')
  })

  it('completions go through the executor', async () => {
    const exec = mockExec()
    const reply = await collect(
      createRulesAdapter(NOW).converse([{ role: 'user', text: 'done with the deck' }], ctx, exec),
    )
    expect(exec.complete).toHaveBeenCalledWith('deck')
    expect(reply).toBe('Marked deck done.')
  })

  it('"cleanup my calendar so I can restart" clears through the executor (keyless floor)', async () => {
    const exec = mockExec()
    const reply = await collect(
      createRulesAdapter(NOW).converse(
        [{ role: 'user', text: 'cleanup my calendar so that i could restart and plan' }],
        ctx,
        exec,
      ),
    )
    expect(exec.clear).toHaveBeenCalledWith('upcoming')
    expect(reply).toBe('Cleared upcoming.')
  })
})

describe('anthropic tool dispatch — runTool', () => {
  it('sanitizes plan_blocks input (clamps, defaults, drops junk)', async () => {
    const exec = mockExec()
    await runTool(
      'plan_blocks',
      {
        places: [
          { title: ' deck ', tag: 'work', dayOffset: 99, startMin: -5, durationMin: 9999 },
          { title: '', tag: 'work', dayOffset: 0 }, // dropped: empty title
          null,
        ],
        frees: [{ dayOffset: 3, startMin: 780, endMin: 1020 }],
      },
      exec,
    )
    const [places, frees] = (exec.plan as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(places).toHaveLength(1)
    expect(places[0]).toMatchObject({ title: 'deck', dayOffset: 13, startMin: 0, durationMin: 600 })
    expect(frees[0]).toMatchObject({ dayOffset: 3 })
  })

  it('routes each tool to its executor and reports unknown tools without throwing', async () => {
    const exec = mockExec()
    expect(await runTool('complete_task', { query: 'deck' }, exec)).toBe('Marked deck done.')
    expect(await runTool('move_task', { query: 'deck', toDayOffset: 2 }, exec)).toBe('Moved deck.')
    expect(await runTool('capture_intention', { title: 'call the bank' }, exec)).toBe('Captured "call the bank".')
    expect(await runTool('edit_block', { query: 'prod release', durationMin: 45 }, exec)).toBe(
      'Updated prod release.',
    )
    expect((exec.edit as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      'prod release',
      { durationMin: 45 },
    ])
    expect(await runTool('remove_blocks', { query: 'prod release' }, exec)).toBe('Removed prod release.')
    /* the at/all disambiguators reach the executor; bare call carries empty opts */
    await runTool('remove_blocks', { query: 'sleep', at: '22:30' }, exec)
    await runTool('remove_blocks', { query: 'prod release', all: true }, exec)
    const removeCalls = (exec.remove as ReturnType<typeof vi.fn>).mock.calls
    expect(removeCalls[0]).toEqual(['prod release', { at: undefined, all: false }])
    expect(removeCalls[1]).toEqual(['sleep', { at: '22:30', all: false }])
    expect(removeCalls[2]).toEqual(['prod release', { at: undefined, all: true }])
    expect(await runTool('analyze_day', {}, exec)).toBe('Day shape (offset 0).')
    expect(await runTool('find_slot', { durationMin: 45, notAfterMin: 1020 }, exec)).toBe(
      'Slot 45m day 0 [-,1020].',
    )
    expect(await runTool('clear_blocks', { scope: 'week' }, exec)).toBe('Cleared week.')
    expect(await runTool('clear_blocks', { scope: 'junk' }, exec)).toBe('Cleared upcoming.')
    expect(await runTool('nope', {}, exec)).toMatch(/unknown tool/)
    expect(await runTool('query_brain', { question: 'how much has spicanova eaten' }, exec)).toContain(
      'Spicanova this week',
    )
    expect(exec.calls).toContain('queryBrain')
    expect(await runTool('query_brain', { question: '  ' }, exec)).toMatch(/nothing to look up/)
    expect(await runTool('plan_blocks', {}, exec)).toMatch(/nothing to place/)
  })
})

describe('remember rides the tool registry', () => {
  it('passes the structured rule through to the executor', async () => {
    const exec = mockExec()
    const out = await runTool(
      'remember',
      { kind: 'time-default', match: 'gym', value: 'starts 07:00', stated: 'gym is always 7am' },
      exec,
    )
    expect(out).toBe('Remembered — gym starts 07:00.')
    const [pref] = (exec.remember as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(pref).toEqual({ kind: 'time-default', match: 'gym', value: 'starts 07:00', stated: 'gym is always 7am' })
  })

  it('an unknown kind degrades to fact; a subject-less rule is refused', async () => {
    const exec = mockExec()
    await runTool('remember', { kind: 'sneaky', match: 'gym', value: 'x', stated: 's' }, exec)
    expect((exec.remember as ReturnType<typeof vi.fn>).mock.calls[0][0].kind).toBe('fact')
    expect(await runTool('remember', { match: ' ', value: '' }, exec)).toMatch(/nothing to remember/)
  })
})

describe('attention + due ride the tool registry', () => {
  it('plan_blocks passes attention/dueMin through to the executor as attention/due', async () => {
    const exec = mockExec()
    await runTool(
      'plan_blocks',
      { places: [{ title: 'swap iphone', tag: 'work', dayOffset: 0, durationMin: 180, attention: 'background', dueMin: 780 }] },
      exec,
    )
    const [places] = (exec.plan as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(places[0]).toMatchObject({ title: 'swap iphone', attention: 'background', due: 780 })
  })

  it('an unknown attention value is dropped, not trusted', async () => {
    const exec = mockExec()
    await runTool('plan_blocks', { places: [{ title: 'x', tag: 'work', dayOffset: 0, attention: 'sneaky' }] }, exec)
    const [places] = (exec.plan as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(places[0].attention).toBeUndefined()
  })

  it('edit_block carries the demote-to-background and the due patch', async () => {
    const exec = mockExec()
    await runTool('edit_block', { query: 'restore', attention: 'background', dueMin: 780 }, exec)
    const [q, patch] = (exec.edit as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(q).toBe('restore')
    expect(patch).toMatchObject({ attention: 'background', due: 780 })
  })
})

describe('openai adapter — abort', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** A fetch stub that speaks the chat-completions JSON shape. Round 1 returns a
      tool_call (so the loop runs the executor and commits a real action, then
      loops); from round 2 on it behaves like the browser does once a request is
      aborted — rejecting with an AbortError DOMException — and records the
      `signal` it was handed so we can prove the adapter threaded it through. */
  function abortingFetch() {
    const signals: (AbortSignal | undefined)[] = []
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      signals.push(init?.signal ?? undefined)
      if (fetch.mock.calls.length === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'on it.',
                  tool_calls: [
                    { id: 'c1', type: 'function', function: { name: 'complete_task', arguments: '{"query":"deck"}' } },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
      throw new Error('round 2 fetch ran without the abort signal')
    })
    return { fetch, signals }
  }

  it('stops cleanly when the signal aborts mid-loop — no retry, no replay', async () => {
    const { fetch, signals } = abortingFetch()
    vi.stubGlobal('fetch', fetch)

    const exec = mockExec()
    const abort = new AbortController()
    const adapter = createOpenAIAdapter('sk-test', 'gpt-test')
    const it = adapter
      .converse([{ role: 'user', text: 'done with the deck' }], ctx, exec, abort.signal)
      [Symbol.asyncIterator]()

    /* drive round 1 (commits the tool action), then stop before round 2 — the
       store's ■/Esc fires between rounds, exactly as in the live loop. */
    await it.next()
    abort.abort()

    await expect(it.next()).rejects.toMatchObject({ name: 'AbortError' })

    /* round 2's fetch was reached once and handed the signal — and the
       non-transient AbortError short-circuited withRetry: no 3rd attempt. */
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(signals[1]).toBe(abort.signal)

    /* the action committed in round 1 stays — the abort keeps partial work,
       it never rolls back or replays the turn (store.ts honesty guard). */
    expect(exec.calls).toEqual(['complete'])
    expect(exec.complete).toHaveBeenCalledTimes(1)
  })
})
