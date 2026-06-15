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
    const suggestSlots = vi.fn(() => 'Best slots for "gym", highest first: tomorrow 07:00–08:00 (matches your rule).')
    const exec = { suggestSlots } as unknown as ToolExecutor
    const out = await runTool(
      'suggest_slots',
      { title: 'gym', tag: 'health', durationMin: 60, dueMin: 780, window: 'morning' },
      exec,
    )
    expect(suggestSlots).toHaveBeenCalledWith('gym', 'health', 60, 780, 'morning')
    expect(out).toContain('Best slots')
  })

  it('defaults an absent tag to work, clamps duration, drops an invalid window', async () => {
    const suggestSlots = vi.fn(() => 'ok')
    const exec = { suggestSlots } as unknown as ToolExecutor
    await runTool('suggest_slots', { title: 'deep work', durationMin: 99999, window: 'midnight' }, exec)
    expect(suggestSlots).toHaveBeenCalledWith('deep work', 'work', 600, undefined, undefined)
  })
})
