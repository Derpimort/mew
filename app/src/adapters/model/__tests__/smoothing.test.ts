/* The word-smoothing transform (#281b) pinned against the INSTALLED SDK — no
   mocks. The adapter hands streamText `smoothStream(SMOOTHING)`; if an `ai`
   bump renames the option, changes the chunking vocabulary, or stops passing
   tool-loop parts through, these fail before a user ever sees a pasted reply
   (the same doctrine as contract.test.ts: pin the seam we don't own).

   Tests build the transform with the delay nulled — the 10 ms pacing is real
   time between words and is asserted as config below, not waited out here. */

import { describe, expect, it } from 'vitest'
import { smoothStream } from 'ai'
import { SMOOTHING } from '../aiAdapter'

/** the slice of the SDK's TextStreamPart these pins drive */
type Part = { type: string; id?: string; text?: string; toolName?: string }

async function through(parts: Part[]): Promise<Part[]> {
  const src = new ReadableStream<Part>({
    start(c) {
      for (const p of parts) c.enqueue(p)
      c.close()
    },
  })
  const transform = smoothStream({ ...SMOOTHING, delayInMs: null })({
    tools: {},
  }) as unknown as TransformStream<Part, Part>
  const out: Part[] = []
  const reader = src.pipeThrough(transform).getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out.push(value)
  }
  return out
}

describe('SMOOTHING config (#281b) — the paint fix is word chunks WITH pacing', () => {
  it('chunks by word and keeps a positive inter-chunk delay', () => {
    /* the delay is load-bearing, not cosmetic: it yields the event loop
       between words, so React paints each delta instead of batching a whole
       SSE burst into one repaint. null here would re-create the paste. */
    expect(SMOOTHING.chunking).toBe('word')
    expect(SMOOTHING.delayInMs).toBeGreaterThan(0)
  })
})

describe('smoothStream through the installed SDK', () => {
  it('re-chunks one bursty text delta into word-granular deltas, text intact', async () => {
    const out = await through([
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', text: 'done — thursday 9 to 12 is held.' },
      { type: 'text-end', id: 't' },
    ])
    const deltas = out.filter((p) => p.type === 'text-delta')
    expect(deltas.length).toBeGreaterThanOrEqual(4) // words, not the one paste
    expect(deltas.map((p) => p.text).join('')).toBe('done — thursday 9 to 12 is held.')
  })

  it('tool-loop parts pass through in order, and buffered text flushes ahead of them', async () => {
    const out = await through([
      { type: 'text-delta', id: 't', text: 'placing it now' }, // no trailing space — would sit in the buffer
      { type: 'tool-call', toolName: 'plan_blocks' },
      { type: 'text-delta', id: 't2', text: 'done.' },
      { type: 'finish' },
    ])
    const types = out.map((p) => p.type)
    /* the tool call neither vanished nor overtook the text before it — the
       step boundary the store's executor relies on stays exactly where the
       model put it */
    expect(types).toContain('tool-call')
    expect(
      out
        .filter((p) => p.type === 'text-delta')
        .map((p) => p.text)
        .join('')
    ).toBe('placing it nowdone.')
    const toolAt = types.indexOf('tool-call')
    const textBefore = out
      .slice(0, toolAt)
      .filter((p) => p.type === 'text-delta')
      .map((p) => p.text)
      .join('')
    expect(textBefore).toBe('placing it now')
    expect(types[types.length - 1]).toBe('finish')
  })

  it('reasoning deltas ride the same smoothing without loss (the ON-path buffer is split-proof)', async () => {
    const out = await through([
      { type: 'reasoning-start', id: 'r' },
      { type: 'reasoning-delta', id: 'r', text: 'weigh the morning, then place the deck. ' },
      { type: 'reasoning-end', id: 'r' },
      { type: 'text-delta', id: 't', text: 'ok.' },
      { type: 'finish' },
    ])
    /* the adapter accumulates reasoning-deltas into one note (#166) — however
       the transform re-slices them, the concatenation must be byte-identical */
    expect(
      out
        .filter((p) => p.type === 'reasoning-delta')
        .map((p) => p.text)
        .join('')
    ).toBe('weigh the morning, then place the deck. ')
    // window boundaries survive — the adapter's flush-once contract keys on these
    expect(out.map((p) => p.type)).toContain('reasoning-start')
    expect(out.map((p) => p.type)).toContain('reasoning-end')
  })
})
