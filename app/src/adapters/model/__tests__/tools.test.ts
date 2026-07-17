import { describe, expect, it, vi } from 'vitest'
import { MEW_TOOLS, mewTools, runTool } from '../tools'
import type { ToolExecutor } from '../types'

/* The suggest_slots tool (#80, slice 2): schema registration + the runTool
   dispatch that parses/clamps args before handing them to the scoring oracle. */
describe('suggest_slots tool', () => {
  it('is registered, read-only, with title + durationMin required', () => {
    const tool = MEW_TOOLS.find((t) => t.name === 'suggest_slots')
    expect(tool).toBeDefined()
    expect((tool!.parameters as { required: string[] }).required).toEqual(['title', 'durationMin'])
  })

  it('dispatches parsed args to exec.suggestSlots', async () => {
    const suggestSlots = vi.fn(
      () => 'Best slots for "gym", highest first: tomorrow 07:00–08:00 (matches your rule).'
    )
    const exec = { suggestSlots } as unknown as ToolExecutor
    const out = await runTool(
      'suggest_slots',
      { title: 'gym', tag: 'health', durationMin: 60, dueMin: 780, window: 'morning' },
      exec
    )
    expect(suggestSlots).toHaveBeenCalledWith('gym', 'health', 60, 780, 'morning')
    expect(out).toContain('Best slots')
  })

  it('defaults an absent tag to work, clamps duration, drops an invalid window', async () => {
    const suggestSlots = vi.fn(() => 'ok')
    const exec = { suggestSlots } as unknown as ToolExecutor
    await runTool(
      'suggest_slots',
      { title: 'deep work', durationMin: 99999, window: 'midnight' },
      exec
    )
    expect(suggestSlots).toHaveBeenCalledWith('deep work', 'work', 600, undefined, undefined)
  })
})

/* plan_blocks gains an optional per-place `recurrence` (#159): the runTool
   dispatch parses freq/interval/until/count and the BYDAY CSV into a clean
   Rrule before handing the place to the executor — which expands it. */
describe('plan_blocks recurrence', () => {
  it('exposes a recurrence schema on each place (freq DAILY|WEEKLY)', () => {
    const tool = MEW_TOOLS.find((t) => t.name === 'plan_blocks')!
    const place = (
      tool.parameters as {
        properties: {
          places: {
            items: { properties: Record<string, { properties?: { freq?: { enum?: string[] } } }> }
          }
        }
      }
    ).properties.places.items.properties
    expect(place.recurrence).toBeDefined()
    expect(place.recurrence.properties!.freq!.enum).toEqual(['DAILY', 'WEEKLY'])
  })

  it('parses a weekly recurrence with a BYDAY CSV into an Rrule on the place', async () => {
    const plan = vi.fn<ToolExecutor['plan']>(() => 'ok')
    const exec = { plan } as unknown as ToolExecutor
    await runTool(
      'plan_blocks',
      {
        places: [
          {
            title: 'gym',
            tag: 'health',
            dayOffset: 0,
            startMin: 420,
            durationMin: 60,
            recurrence: { freq: 'WEEKLY', byday: 'MO,WE', count: 24 },
          },
        ],
      },
      exec
    )
    const places = plan.mock.calls[0][0]
    expect(places[0].rrule).toEqual({ freq: 'WEEKLY', interval: 1, byday: ['MO', 'WE'], count: 24 })
  })

  it('drops a monthly recurrence (unsupported) while still placing the block', async () => {
    const plan = vi.fn<ToolExecutor['plan']>(() => 'ok')
    const exec = { plan } as unknown as ToolExecutor
    await runTool(
      'plan_blocks',
      { places: [{ title: 'rent', tag: 'work', dayOffset: 0, recurrence: { freq: 'MONTHLY' } }] },
      exec
    )
    const places = plan.mock.calls[0][0]
    expect(places).toHaveLength(1)
    expect(places[0].rrule).toBeUndefined()
  })
})

/* The undo_last_action tool (#162): a no-param recovery that reverses the
   turn's last mutating tool. Schema registration + the runTool dispatch. */
describe('undo_last_action tool', () => {
  it('is registered, parameterless (no required args)', () => {
    const tool = MEW_TOOLS.find((t) => t.name === 'undo_last_action')
    expect(tool).toBeDefined()
    expect((tool!.parameters as { required: string[] }).required).toEqual([])
    expect((tool!.parameters as { properties: object }).properties).toEqual({})
  })

  it('dispatches to exec.undoLast and returns its summary verbatim', async () => {
    const undoLast = vi.fn(() => 'Undone — took back the three blocks I had just placed.')
    const exec = { undoLast } as unknown as ToolExecutor
    const out = await runTool('undo_last_action', {}, exec)
    expect(undoLast).toHaveBeenCalledTimes(1)
    expect(out).toBe('Undone — took back the three blocks I had just placed.')
  })

  it('ignores any stray args the model sends (no params to parse)', async () => {
    const undoLast = vi.fn(() => 'nothing to undo yet — I haven’t changed the week this turn.')
    const exec = { undoLast } as unknown as ToolExecutor
    const out = await runTool('undo_last_action', { query: 'gym', count: 3 }, exec)
    expect(undoLast).toHaveBeenCalledWith()
    expect(out).toMatch(/nothing to undo/i)
  })
})

/* propose_scenarios (#293): the plan-mode tool — schema registration, the
   runTool sanitize pass, and the mewTools planMode gear that re-advertises
   the registry per Settings without touching the executor. */
describe('propose_scenarios tool (#293)', () => {
  it('is registered chat-only with tasks required (title + tag per task)', () => {
    const tool = MEW_TOOLS.find((t) => t.name === 'propose_scenarios')
    expect(tool).toBeDefined()
    expect(tool!.description).toMatch(/INSTEAD of plan_blocks/)
    expect(tool!.description).toMatch(/END your turn/)
    const params = tool!.parameters as {
      required: string[]
      properties: { tasks: { items: { required: string[] } } }
    }
    expect(params.required).toEqual(['tasks'])
    expect(params.properties.tasks.items.required).toEqual(['title', 'tag'])
  })

  it('sanitizes loose args: trims, defaults tags, clamps durations, drops junk', async () => {
    const proposeScenarios = vi.fn(() => 'ok')
    const exec = { proposeScenarios } as unknown as ToolExecutor
    await runTool(
      'propose_scenarios',
      {
        prompt: '  three ways ',
        tasks: [
          { title: ' deck ', tag: 'work', durationMin: 9999, window: 'morning' },
          { title: 'gym', tag: 'bogus', dueMin: 780 },
          { title: '', tag: 'work' }, // dropped: empty title
          null,
        ],
      },
      exec
    )
    const [prompt, tasks] = proposeScenarios.mock.calls[0] as unknown as [
      string,
      { title: string }[],
    ]
    expect(prompt).toBe('three ways')
    expect(tasks).toEqual([
      { title: 'deck', tag: 'work', durationMin: 600, due: undefined, window: 'morning' },
      { title: 'gym', tag: 'work', durationMin: undefined, due: 780, window: undefined },
    ])
  })

  it('an empty call never reaches the executor', async () => {
    const proposeScenarios = vi.fn(() => 'ok')
    const exec = { proposeScenarios } as unknown as ToolExecutor
    const out = await runTool('propose_scenarios', { tasks: [] }, exec)
    expect(proposeScenarios).not.toHaveBeenCalled()
    expect(out).toMatch(/nothing to propose/)
  })

  it("mewTools gears the registry: 'off' drops the tool, 'always' lowers the floor to two", () => {
    expect(mewTools('off').some((t) => t.name === 'propose_scenarios')).toBe(false)
    expect(mewTools('off').length).toBe(MEW_TOOLS.length - 1)
    const always = mewTools('always').find((t) => t.name === 'propose_scenarios')!
    expect(always.description).toMatch(/two or more separate plannable items/)
    // 'auto' (the default) IS the registry, three-item floor
    expect(mewTools()).toBe(MEW_TOOLS)
    expect(mewTools('auto').find((t) => t.name === 'propose_scenarios')!.description).toMatch(
      /three or more separate plannable items/
    )
  })
})
