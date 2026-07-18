/* "show me today" / "what's on this week" — the keyless list_blocks intent
   (#333). The deterministic grammar names the read-only intent; the rules floor
   routes it through the SAME executor readout the keyed tool uses (keyless and
   keyed can't drift), and never through a mutating method. */

import { describe, expect, it, vi } from 'vitest'
import { createRulesAdapter, runIntent } from '../rules'
import type { ConverseChunk, ToolExecutor, WeekContext } from '../types'
import { parseCommand } from '../../../domain/parse'

const NOW = () => new Date(2026, 5, 10, 9, 40) // Wednesday, June 10
const READOUT = "here's today:\n- 9:00–11:00 deep work [work]\n- 11:30–12:00 inbox sweep [work] ✓"

function ctx(): WeekContext {
  return {
    todayKey: '2026-06-10',
    todayLabel: 'Wednesday, June 10',
    nowLabel: '9:40',
    weekSummary: [],
    realisticBestH: null,
    mewsToday: 0,
    insightLines: [],
    recallLines: [],
    brainOn: false,
    prefLines: [],
  }
}

/** An executor that answers listBlocks and THROWS on any other method — proof
    the read-only intent never mutates the week. */
function listOnly(readout = READOUT) {
  const listBlocks = vi.fn(() => readout)
  const exec = new Proxy({ listBlocks } as unknown as ToolExecutor, {
    get(_t, prop) {
      if (prop === 'listBlocks') return listBlocks
      return () => {
        throw new Error(`list intent touched a mutating executor method (${String(prop)})`)
      }
    },
  })
  return { exec, listBlocks }
}

async function collect(it: AsyncIterable<ConverseChunk>): Promise<string> {
  let out = ''
  for await (const c of it) if (typeof c === 'string') out += c
  return out
}

describe('parseCommand — the read-only list intent', () => {
  const day = (text: string) => {
    const intent = parseCommand(text, NOW())
    return intent.kind === 'list' ? intent.list!.day : `not-list(${intent.kind})`
  }

  it("recognizes the day asks: 'show me today', 'what do I have at 3?', 'list my blocks'", () => {
    expect(day('show me today')).toBe(0)
    expect(day('what do I have at 3?')).toBe(0)
    expect(day('what do I have today')).toBe(0)
    expect(day('list my blocks')).toBe(0)
    expect(day("what's on")).toBe(0)
    expect(day("what's on my calendar")).toBe(0)
  })

  it('recognizes the week ask and tomorrow', () => {
    expect(day("what's on this week")).toBe('week')
    expect(day('show me my week')).toBe('week')
    expect(day('list my week')).toBe('week')
    expect(day("what's on tomorrow")).toBe(1)
    expect(day('list tomorrow')).toBe(1)
  })

  it('does NOT swallow neighbouring intents — how/plan/clear stay themselves', () => {
    expect(parseCommand("how's my week looking", NOW()).kind).not.toBe('list')
    expect(parseCommand('clear my calendar', NOW()).kind).toBe('clear')
    // "remember to buy milk" is a capture, not a list, despite "milk"/"buy"
    expect(parseCommand('remember to buy milk', NOW()).kind).toBe('capture')
    // a bare braindump with no calendar word is not a list
    expect(parseCommand('list of ideas for the retro', NOW()).kind).not.toBe('list')
  })
})

describe('runIntent — list routes through the read-only executor readout', () => {
  it('calls exec.listBlocks with the parsed day + tag and yields its readout verbatim', () => {
    const { exec, listBlocks } = listOnly()
    const out = runIntent({ kind: 'list', list: { day: 'week', tag: 'health' } }, exec, ctx(), '')
    expect(listBlocks).toHaveBeenCalledWith('week', 'health')
    expect(out).toBe(READOUT)
  })

  it('defaults an absent payload to today, no tag', () => {
    const { exec, listBlocks } = listOnly()
    runIntent({ kind: 'list' }, exec, ctx(), '')
    expect(listBlocks).toHaveBeenCalledWith(0, undefined)
  })

  it('touches no mutating method (the proxy would throw)', () => {
    const { exec } = listOnly()
    expect(() =>
      runIntent({ kind: 'list', list: { day: 0 } }, exec, ctx(), 'show me today')
    ).not.toThrow()
  })
})

describe('the keyless floor end-to-end', () => {
  it('"show me today" streams the itemized readout from the executor', async () => {
    const { exec, listBlocks } = listOnly()
    const reply = await collect(
      createRulesAdapter(NOW).converse([{ role: 'user', text: 'show me today' }], ctx(), exec)
    )
    expect(listBlocks).toHaveBeenCalledWith(0, undefined)
    expect(reply).toBe(READOUT)
    expect(reply).toContain('✓') // the done block is visible, not hidden
  })
})
