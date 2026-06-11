import { describe, expect, it, vi } from 'vitest'
import { createRulesAdapter } from '../rules'
import { runTool } from '../tools'
import type { ToolExecutor, WeekContext } from '../types'

const NOW = () => new Date(2026, 5, 9, 9, 40) // Tuesday, June 9

const ctx: WeekContext = {
  todayKey: '2026-06-09',
  todayLabel: 'Tuesday, June 9',
  nowLabel: '9:40',
  weekSummary: ['today (2026-06-09): 9:00 Q3 deck [work]'],
  realisticBestH: 5.5,
  mewsToday: 2,
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
    clear: vi.fn((scope) => {
      calls.push('clear')
      return `Cleared ${scope}.`
    }),
  }
}

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = ''
  for await (const c of it) out += c
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
  it('sanitizes plan_blocks input (clamps, defaults, drops junk)', () => {
    const exec = mockExec()
    runTool(
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

  it('routes each tool to its executor and reports unknown tools without throwing', () => {
    const exec = mockExec()
    expect(runTool('complete_task', { query: 'deck' }, exec)).toBe('Marked deck done.')
    expect(runTool('move_task', { query: 'deck', toDayOffset: 2 }, exec)).toBe('Moved deck.')
    expect(runTool('capture_intention', { title: 'call the bank' }, exec)).toBe('Captured "call the bank".')
    expect(runTool('edit_block', { query: 'prod release', durationMin: 45 }, exec)).toBe(
      'Updated prod release.',
    )
    expect((exec.edit as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      'prod release',
      { durationMin: 45 },
    ])
    expect(runTool('remove_blocks', { query: 'prod release' }, exec)).toBe('Removed prod release.')
    expect(runTool('analyze_day', {}, exec)).toBe('Day shape (offset 0).')
    expect(runTool('find_slot', { durationMin: 45, notAfterMin: 1020 }, exec)).toBe(
      'Slot 45m day 0 [-,1020].',
    )
    expect(runTool('clear_blocks', { scope: 'week' }, exec)).toBe('Cleared week.')
    expect(runTool('clear_blocks', { scope: 'junk' }, exec)).toBe('Cleared upcoming.')
    expect(runTool('nope', {}, exec)).toMatch(/unknown tool/)
    expect(runTool('plan_blocks', {}, exec)).toMatch(/nothing to place/)
  })
})
