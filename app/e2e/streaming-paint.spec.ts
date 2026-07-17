/* Real streaming, not cosmetic (#281): the paint pin. The rules floor yields
   its whole reply in one chunk, so a keyless turn can't exercise delta
   painting — instead __mewSayStream (state/store.ts) drives scripted chunks
   through the SAME per-chunk flush path speak() uses (streamedReply). What
   this observes is therefore the real mechanics under a live model: one
   message row created on the first delta, then repainted in place per delta —
   growing text, stable row identity — never a stall-then-paste. */

import { test, expect } from '@playwright/test'
import { boot } from './helpers'

test.describe('streaming paint (#281)', () => {
  test('a long scripted reply paints ≥3 distinct, growing states of one message row', async ({
    page,
  }) => {
    await boot(page)

    /* Drive ~20 word chunks 100 ms apart and sample the newest log row every
       25 ms while the stream runs — all inside the page, so sampling cadence
       never rides the CDP round-trip. */
    const samples = await page.evaluate(async () => {
      const read = () => {
        const rows = document.querySelectorAll('.session-scroll .log [data-msg]')
        const last = rows[rows.length - 1]
        return {
          id: last?.getAttribute('data-msg') ?? null,
          text: (last?.textContent ?? '').trim(),
        }
      }
      // word-granular chunks, trailing spaces kept — the shape smoothStream emits
      const chunks =
        'plotting a calm afternoon for you — deck first, then a walk, then inbox zero, and the evening stays yours.'.split(
          /(?<=\s)/
        )
      let settled = false
      void window.__mewSayStream!(chunks, 100).then(() => {
        settled = true
      })
      const out: { id: string | null; text: string }[] = []
      while (!settled) {
        out.push(read())
        await new Promise((r) => setTimeout(r, 25))
      }
      out.push(read())
      return out
    })

    // the streamed row exists and kept ONE identity across the whole turn
    const rowId = samples[samples.length - 1].id
    expect(rowId).toBeTruthy()

    // every observed paint of that row, deduped in arrival order
    const painted = samples.filter((s) => s.id === rowId).map((s) => s.text)
    const distinct = painted.filter((t, i) => i === 0 || t !== painted[i - 1])

    // ≥3 distinct paint states — deltas painted as they arrived, not one paste
    expect(distinct.length).toBeGreaterThanOrEqual(3)
    // …and strictly growing: each repaint extends the same row's text
    for (let i = 1; i < distinct.length; i++) {
      expect(distinct[i].length).toBeGreaterThan(distinct[i - 1].length)
      expect(distinct[i].startsWith(distinct[i - 1])).toBe(true)
    }
    // the full scripted reply landed, word for word
    expect(distinct[distinct.length - 1]).toContain('the evening stays yours.')
  })
})
