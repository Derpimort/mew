import { describe, expect, it, vi } from 'vitest'
import { MEW_TOOLS, runTool } from '../tools'
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
