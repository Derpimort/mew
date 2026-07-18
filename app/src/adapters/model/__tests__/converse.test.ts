import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAiAdapter } from '../aiAdapter'
import { createRulesAdapter } from '../rules'
import { runTool } from '../tools'
import { CHOICES_POSTED, type ConverseChunk, type ToolExecutor, type WeekContext } from '../types'

const NOW = () => new Date(2026, 5, 9, 9, 40) // Tuesday, June 9

const ctx: WeekContext = {
  todayKey: '2026-06-09',
  todayLabel: 'Tuesday, June 9',
  nowLabel: '9:40',
  weekSummary: ['today (2026-06-09): 9:00 Q3 deck [work]'],
  realisticBestH: 5.5,
  mewsToday: 2,
  recallLines: [],
  brainOn: false,
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
    listBlocks: vi.fn((day, tag) => {
      calls.push('listBlocks')
      return `here's ${day}${tag ? ` tagged ${tag}` : ''}: - 9:00–10:00 deep work [work]`
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
    offerChoices: vi.fn((prompt: string, options: { label: string }[]) => {
      calls.push('offerChoices')
      return `${CHOICES_POSTED}: ${options.map((o) => `"${o.label}"`).join(' · ')}. (asked: ${prompt})`
    }),
    proposeScenarios: vi.fn((_prompt: string, tasks: { title: string }[]) => {
      calls.push('proposeScenarios')
      return `${CHOICES_POSTED}: ${tasks.length} tasks laid out. Say nothing more and END your turn.`
    }),
    clear: vi.fn((scope) => {
      calls.push('clear')
      return `Cleared ${scope}.`
    }),
    undoLast: vi.fn(() => {
      calls.push('undoLast')
      return `Undone — took back the deck block I'd just placed.`
    }),
    resize: vi.fn((q) => {
      calls.push('resize')
      return `Updated ${q}.`
    }),
    duplicate: vi.fn((q) => {
      calls.push('duplicate')
      return `Copied ${q}.`
    }),
    relativeMove: vi.fn((q) => {
      calls.push('relativeMove')
      return `Moved ${q}.`
    }),
    giveRoom: vi.fn((fc) => {
      calls.push('giveRoom')
      return `Gave your ${fc} blocks room.`
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
      createRulesAdapter(NOW).converse([{ role: 'user', text: 'hello pixie' }], ctx, exec)
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
        exec
      )
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
      createRulesAdapter(NOW).converse([{ role: 'user', text: 'done with the deck' }], ctx, exec)
    )
    expect(exec.complete).toHaveBeenCalledWith('deck', undefined)
    expect(reply).toBe('Marked deck done.')
  })

  it('"cleanup my calendar so I can restart" clears through the executor (keyless floor)', async () => {
    const exec = mockExec()
    const reply = await collect(
      createRulesAdapter(NOW).converse(
        [{ role: 'user', text: 'cleanup my calendar so that i could restart and plan' }],
        ctx,
        exec
      )
    )
    expect(exec.clear).toHaveBeenCalledWith('upcoming')
    expect(reply).toBe('Cleared upcoming.')
  })
})

describe('rules adapter — the rescue split ask (#286)', () => {
  it('composes the two existing tools: shrink to the gap, place the kept tail', async () => {
    const exec = mockExec()
    const reply = await collect(
      createRulesAdapter(NOW).converse(
        [{ role: 'user', text: 'split the deck around 13:00-13:45, keep 45m after' }],
        ctx,
        exec
      )
    )
    expect(exec.calls).toEqual(['edit', 'plan'])
    expect(exec.edit).toHaveBeenCalledWith('deck', { endMin: 13 * 60 })
    const [places] = (exec.plan as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(places[0]).toMatchObject({
      title: 'deck (part 2)',
      tag: 'work',
      dayOffset: 0,
      startMin: 13 * 60 + 45,
      durationMin: 45,
    })
    expect(reply).toBe('Updated deck. Done — placed 1, freed 0.')
  })

  it('a future-day split carries its day into the placement', async () => {
    const exec = mockExec()
    await collect(
      createRulesAdapter(NOW).converse(
        [{ role: 'user', text: 'split the deck around 13:00-13:45 on friday, keep 45m after' }],
        ctx,
        exec
      )
    )
    const [places] = (exec.plan as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(places[0]).toMatchObject({ dayOffset: 3, startMin: 825 }) // Tue → Friday
  })

  it('a missed block stops the split — no stray tail is ever placed', async () => {
    const exec = mockExec()
    ;(exec.edit as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      `I couldn't find "deck" to change — say it another way?`
    )
    const reply = await collect(
      createRulesAdapter(NOW).converse(
        [{ role: 'user', text: 'split the deck around 13:00-13:45, keep 45m after' }],
        ctx,
        exec
      )
    )
    expect(exec.plan).not.toHaveBeenCalled()
    expect(reply).toMatch(/couldn't find/)
  })
})

describe('rules adapter — plan mode route (#293)', () => {
  const braindump = 'block the deck, block budget review, block a gym session, block inbox sweep'

  it('a ≥3-item un-pinned braindump routes to proposeScenarios and stays quiet (the picker IS the reply)', async () => {
    const exec = mockExec()
    const reply = await collect(
      createRulesAdapter(NOW).converse([{ role: 'user', text: braindump }], ctx, exec)
    )
    expect(exec.calls).toEqual(['proposeScenarios'])
    const [prompt, tasks] = (exec.proposeScenarios as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(prompt).toBe('')
    expect(tasks.map((t: { title: string }) => t.title)).toEqual([
      'deck',
      'budget review',
      'gym session',
      'inbox sweep',
    ])
    // inferTag rode along from the parse — a braindump still classifies
    expect(tasks.find((t: { title: string }) => t.title === 'gym session')!.tag).toBe('private')
    expect(reply).toBe('') // CHOICES_POSTED result → the floor yields nothing
  })

  it('a fall-through result (one shape / nothing fits) speaks as the reply', async () => {
    const exec = mockExec()
    ;(exec.proposeScenarios as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      `One shape fits — spread even: all 3 fit. Say the word and I'll place exactly that.`
    )
    const reply = await collect(
      createRulesAdapter(NOW).converse([{ role: 'user', text: braindump }], ctx, exec)
    )
    expect(reply).toMatch(/^One shape fits/)
    expect(exec.plan).not.toHaveBeenCalled()
  })

  it('an explicitly timed item keeps the WHOLE ask on the one-pass path — a stated time is never re-derived', async () => {
    const exec = mockExec()
    await collect(
      createRulesAdapter(NOW).converse(
        [
          {
            role: 'user',
            text: 'block the deck at 9, block budget review, block a gym session, block inbox sweep',
          },
        ],
        ctx,
        exec
      )
    )
    expect(exec.calls).toEqual(['plan'])
    expect(exec.proposeScenarios).not.toHaveBeenCalled()
  })

  it('a stated day pins the same way ("tomorrow" is the user deciding)', async () => {
    const exec = mockExec()
    await collect(
      createRulesAdapter(NOW).converse(
        [
          {
            role: 'user',
            text: 'block the deck tomorrow, block budget review, block a gym session',
          },
        ],
        ctx,
        exec
      )
    )
    expect(exec.calls).toEqual(['plan'])
  })

  it('two items stay one-pass on auto, propose on always, and never propose on off', async () => {
    const two = 'block the deck, block budget review'
    const auto = mockExec()
    await collect(createRulesAdapter(NOW).converse([{ role: 'user', text: two }], ctx, auto))
    expect(auto.calls).toEqual(['plan'])

    const always = mockExec()
    await collect(
      createRulesAdapter(NOW, 'always').converse([{ role: 'user', text: two }], ctx, always)
    )
    expect(always.calls).toEqual(['proposeScenarios'])

    const off = mockExec()
    await collect(
      createRulesAdapter(NOW, 'off').converse([{ role: 'user', text: braindump }], ctx, off)
    )
    expect(off.calls).toEqual(['plan']) // four items, and still the one-pass place
  })

  it('a kept-free window rides only the classic path', async () => {
    const exec = mockExec()
    await collect(
      createRulesAdapter(NOW).converse(
        [
          {
            role: 'user',
            text: 'block the deck, block budget review, block inbox sweep and keep friday afternoon free',
          },
        ],
        ctx,
        exec
      )
    )
    expect(exec.calls).toEqual(['plan'])
  })
})

describe('tool dispatch — runTool (every provider rides this)', () => {
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
      exec
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
    expect(await runTool('capture_intention', { title: 'call the bank' }, exec)).toBe(
      'Captured "call the bank".'
    )
    expect(await runTool('edit_block', { query: 'prod release', durationMin: 45 }, exec)).toBe(
      'Updated prod release.'
    )
    expect((exec.edit as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      'prod release',
      { durationMin: 45 },
      undefined,
      undefined, // #343: no recurring scope on a plain edit
    ])
    /* #334: the name+time handle reaches the executor — edit/move/complete each
       carry `at` (the target block's start time) so a shared title pins one */
    await runTool('edit_block', { query: 'release', at: '19:45', title: 'v1.2-rc' }, exec)
    expect((exec.edit as ReturnType<typeof vi.fn>).mock.calls[1]).toEqual([
      'release',
      { title: 'v1.2-rc' },
      '19:45',
      undefined, // #343: scope absent unless the ask made it explicit
    ])
    await runTool('complete_task', { query: 'standup', at: '9am' }, exec)
    expect(exec.complete).toHaveBeenCalledWith('standup', '9am')
    await runTool('move_task', { query: 'release', at: '19:45', toDayOffset: 2 }, exec)
    expect((exec.move as ReturnType<typeof vi.fn>).mock.calls.at(-1)).toEqual([
      'release',
      2,
      undefined,
      undefined,
      '19:45',
    ])
    expect(await runTool('remove_blocks', { query: 'prod release' }, exec)).toBe(
      'Removed prod release.'
    )
    /* the at/all disambiguators reach the executor; bare call carries empty opts */
    await runTool('remove_blocks', { query: 'sleep', at: '22:30' }, exec)
    await runTool('remove_blocks', { query: 'prod release', all: true }, exec)
    const removeCalls = (exec.remove as ReturnType<typeof vi.fn>).mock.calls
    expect(removeCalls[0]).toEqual(['prod release', { at: undefined, all: false }])
    expect(removeCalls[1]).toEqual(['sleep', { at: '22:30', all: false }])
    expect(removeCalls[2]).toEqual(['prod release', { at: undefined, all: true }])
    expect(await runTool('analyze_day', {}, exec)).toBe('Day shape (offset 0).')
    expect(await runTool('find_slot', { durationMin: 45, notAfterMin: 1020 }, exec)).toBe(
      'Slot 45m day 0 [-,1020].'
    )
    expect(await runTool('clear_blocks', { scope: 'week' }, exec)).toBe('Cleared week.')
    expect(await runTool('clear_blocks', { scope: 'junk' }, exec)).toBe('Cleared upcoming.')
    expect(await runTool('nope', {}, exec)).toMatch(/unknown tool/)
    expect(
      await runTool('query_brain', { question: 'how much has spicanova eaten' }, exec)
    ).toContain('Spicanova this week')
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
      exec
    )
    expect(out).toBe('Remembered — gym starts 07:00.')
    const [pref] = (exec.remember as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(pref).toEqual({
      kind: 'time-default',
      match: 'gym',
      value: 'starts 07:00',
      stated: 'gym is always 7am',
    })
  })

  it('an unknown kind degrades to fact; a subject-less rule is refused', async () => {
    const exec = mockExec()
    await runTool('remember', { kind: 'sneaky', match: 'gym', value: 'x', stated: 's' }, exec)
    expect((exec.remember as ReturnType<typeof vi.fn>).mock.calls[0][0].kind).toBe('fact')
    expect(await runTool('remember', { match: ' ', value: '' }, exec)).toMatch(
      /nothing to remember/
    )
  })
})

describe('offer_choices rides the tool registry (#254)', () => {
  it('routes prompt + options to the executor, defaulting reply to the label', async () => {
    const exec = mockExec()
    const out = await runTool(
      'offer_choices',
      {
        prompt: 'which gym block?',
        options: [
          { label: 'the 7:00', reply: 'remove gym 7:00' },
          { label: 'both' }, // no reply — defaults to the label
        ],
      },
      exec
    )
    expect(out).toContain(CHOICES_POSTED)
    const [prompt, options] = (exec.offerChoices as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(prompt).toBe('which gym block?')
    expect(options).toEqual([
      { label: 'the 7:00', reply: 'remove gym 7:00' },
      { label: 'both', reply: 'both' },
    ])
  })

  it('caps at five options and drops junk entries — a hand of chips, not a menu', async () => {
    const exec = mockExec()
    await runTool(
      'offer_choices',
      {
        prompt: 'pick a slot',
        options: [
          { label: ' 9:00 ' },
          { label: '10:00' },
          { label: '11:00' },
          { label: '12:00' },
          { label: '13:00' },
          { label: '14:00' }, // sixth — sliced off
          { label: '   ' }, // blank — dropped
          null,
          'nope',
        ],
      },
      exec
    )
    const [, options] = (exec.offerChoices as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(options).toHaveLength(5)
    expect(options[0]).toEqual({ label: '9:00', reply: '9:00' }) // trimmed
    expect(options.map((o: { label: string }) => o.label)).not.toContain('14:00')
  })

  it('refuses an empty call without reaching the executor', async () => {
    const exec = mockExec()
    expect(await runTool('offer_choices', { prompt: '  ', options: [] }, exec)).toMatch(
      /nothing to offer/
    )
    expect(await runTool('offer_choices', { options: [{ label: 'x' }] }, exec)).toMatch(
      /nothing to offer/
    )
    expect(exec.offerChoices).not.toHaveBeenCalled()
  })
})

describe('the keyless floor stays quiet once chips are on screen (#254)', () => {
  it('a CHOICES_POSTED remove result yields no reply text — the chips message IS the reply', async () => {
    const exec = mockExec()
    ;(exec.remove as ReturnType<typeof vi.fn>).mockImplementation(
      () => `${CHOICES_POSTED}: "the 14:00" · "the 10:00" · "both". END your turn.`
    )
    const reply = await collect(
      createRulesAdapter(NOW).converse([{ role: 'user', text: 'drop the prod release' }], ctx, exec)
    )
    expect(exec.remove).toHaveBeenCalledOnce()
    expect(reply).toBe('')
  })

  it('an ordinary remove result still speaks', async () => {
    const exec = mockExec()
    const reply = await collect(
      createRulesAdapter(NOW).converse([{ role: 'user', text: 'drop the prod release' }], ctx, exec)
    )
    expect(reply).toBe('Removed prod release.')
  })
})

describe('attention + due ride the tool registry', () => {
  it('plan_blocks passes attention/dueMin through to the executor as attention/due', async () => {
    const exec = mockExec()
    await runTool(
      'plan_blocks',
      {
        places: [
          {
            title: 'swap iphone',
            tag: 'work',
            dayOffset: 0,
            durationMin: 180,
            attention: 'background',
            dueMin: 780,
          },
        ],
      },
      exec
    )
    const [places] = (exec.plan as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(places[0]).toMatchObject({ title: 'swap iphone', attention: 'background', due: 780 })
  })

  it('an unknown attention value is dropped, not trusted', async () => {
    const exec = mockExec()
    await runTool(
      'plan_blocks',
      { places: [{ title: 'x', tag: 'work', dayOffset: 0, attention: 'sneaky' }] },
      exec
    )
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

describe('unified adapter — abort (#117, on the SDK path)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /* Minimal OpenAI-compatible SSE stream — what the local Ollama surface
     (`/v1/chat/completions`) sends. The unified adapter is driven through the
     REAL SDK against this stubbed wire, so the abort contract is proven on the
     shipping code path, not a mock of it. */
  function sseResponse(lines: string[]) {
    const enc = new TextEncoder()
    return new Response(
      new ReadableStream({
        start(c) {
          for (const l of lines) c.enqueue(enc.encode(`data: ${l}\n\n`))
          c.enqueue(enc.encode('data: [DONE]\n\n'))
          c.close()
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    )
  }
  const delta = (d: unknown, finish: string | null = null) =>
    JSON.stringify({
      id: '1',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'm',
      choices: [{ index: 0, delta: d, finish_reason: finish }],
    })

  it('stops cleanly when the signal aborts mid-loop — no replay, action kept', async () => {
    const signals: (AbortSignal | null | undefined)[] = []
    /* Round 1 streams text + a complete_task tool call (the SDK runs the
       executor, committing a real action, then loops). The user's stop fires
       inside that tool — mid-loop, exactly where the store's ■/Esc lands — so
       any later round behaves like an aborted browser fetch. */
    const fetchSpy = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal)
      if (fetchSpy.mock.calls.length === 1) {
        return sseResponse([
          delta({ role: 'assistant', content: 'on it.' }),
          delta({
            tool_calls: [
              {
                index: 0,
                id: 'c1',
                type: 'function',
                function: { name: 'complete_task', arguments: '{"query":"deck"}' },
              },
            ],
          }),
          delta({}, 'tool_calls'),
        ])
      }
      throw new DOMException('The operation was aborted.', 'AbortError')
    })
    vi.stubGlobal('fetch', fetchSpy)

    const exec = mockExec()
    const abort = new AbortController()
    exec.complete = vi.fn((q: string) => {
      exec.calls.push('complete')
      abort.abort() // the stop control fires the instant the action commits
      return `Marked ${q} done.`
    })

    const adapter = createAiAdapter({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3.2',
    })
    const out: string[] = []
    const run = (async () => {
      for await (const c of adapter.converse(
        [{ role: 'user', text: 'done with the deck' }],
        ctx,
        exec,
        abort.signal
      )) {
        if (typeof c === 'string') out.push(c)
      }
    })()

    /* an aborted turn REJECTS (the store reads the rejection against
       signal.aborted for its "(stopped — …)" copy) — v7 would otherwise end the
       stream silently, which the adapter deliberately un-silences. */
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })

    // the text that streamed before the stop was yielded, and stays
    expect(out.join('')).toContain('on it.')
    // the action committed before the stop stays — exactly once, never replayed
    expect(exec.calls).toEqual(['complete'])
    expect(exec.complete).toHaveBeenCalledTimes(1)
    // the turn's signal was threaded into the wire request
    expect(signals[0]).toBeInstanceOf(AbortSignal)
  })
})

describe('graceful step-cap end-to-end (#153) — the SDK loop, capped at 14 steps', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a model that wants a 15th step gets paused with the honest keep-going line', async () => {
    const enc = new TextEncoder()
    const sse = (lines: string[]) =>
      new Response(
        new ReadableStream({
          start(c) {
            for (const l of lines) c.enqueue(enc.encode(`data: ${l}\n\n`))
            c.enqueue(enc.encode('data: [DONE]\n\n'))
            c.close()
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    let round = 0
    /* every round: a fresh tool call and the wish to continue (finish_reason
       tool_calls) — a genuinely large plan, not an error. The cap must end the
       turn kindly after 14 rounds, with every committed action kept. */
    const fetchSpy = vi.fn(async () => {
      round++
      return sse([
        JSON.stringify({
          id: String(round),
          object: 'chat.completion.chunk',
          created: 0,
          model: 'm',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: `c${round}`,
                    type: 'function',
                    function: { name: 'complete_task', arguments: `{"query":"item ${round}"}` },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
        JSON.stringify({
          id: String(round),
          object: 'chat.completion.chunk',
          created: 0,
          model: 'm',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        }),
      ])
    })
    vi.stubGlobal('fetch', fetchSpy)

    const exec = mockExec()
    const adapter = createAiAdapter({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3.2',
    })
    let out = ''
    for await (const c of adapter.converse(
      [{ role: 'user', text: 'work through my whole backlog' }],
      ctx,
      exec
    )) {
      if (typeof c === 'string') out += c
    }

    // the loop ran exactly to the cap — every capped step's action committed
    expect(fetchSpy).toHaveBeenCalledTimes(14)
    expect(exec.complete).toHaveBeenCalledTimes(14)
    // …and the turn ended with the kind pause, not a silent dead stop
    expect(out).toContain("that's a full turn of changes")
    expect(out).toContain('say "keep going"')
  })
})
