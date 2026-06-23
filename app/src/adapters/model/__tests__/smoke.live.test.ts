/* Live model-contract smoke test — the single source of truth for "does the
   real call actually work". Every other adapter test mocks the SDK/fetch, so a
   green suite proves our CODE, not the provider CONTRACT: a wrong param name /
   value / header (the shipped `max_tokens`-instead-of-`max_completion_tokens`
   400) passes every mock and still breaks for users. This hits the real API.

   KEY-GATED so it never blocks the normal suite, forks, or PRs without secrets:
   - off unless MEW_SMOKE=1 (so a bare `vitest run` skips it cleanly), and
   - each provider runs only when ITS key is present; absent → skipped + logged
     (no silent green — a skip prints WHY).

   Run it: `MEW_SMOKE=1 ANTHROPIC_API_KEY=… OPENAI_API_KEY=… pnpm smoke:models`. */

import { describe, expect, it } from 'vitest'
import { createAiAdapter } from '../aiAdapter'
import { PROVIDER_CONTRACT } from '../contract'
import type { ConverseChunk, ToolExecutor, WeekContext } from '../types'

const SMOKE = process.env.MEW_SMOKE === '1'
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY?.trim()
const OPENAI_KEY = process.env.OPENAI_API_KEY?.trim()

/* Skip-WHY at module load (a describe.skip body never runs, so logging there is
   invisible). Printed every run so a skip is never silently green. */
if (!SMOKE) {
  console.log('[smoke] MEW_SMOKE!=1 — live model smoke SKIPPED (run `pnpm smoke:models` with keys to exercise it).')
} else {
  if (!OPENAI_KEY) console.log('[smoke] OPENAI_API_KEY absent — OpenAI live smoke SKIPPED.')
  if (!ANTHROPIC_KEY) console.log('[smoke] ANTHROPIC_API_KEY absent — Anthropic live smoke SKIPPED.')
  if (OPENAI_KEY || ANTHROPIC_KEY) console.log('[smoke] MEW_SMOKE=1 — exercising live model contract.')
}

const ctx: WeekContext = {
  todayKey: '2026-06-18',
  todayLabel: 'Thursday, June 18',
  nowLabel: '9:40',
  weekSummary: ['today (2026-06-18): nothing scheduled'],
  realisticBestH: 6,
  mewsToday: 0,
  recallLines: [],
  prefLines: [],
  insightLines: [],
}
// a no-op executor: the smoke turn is a plain greeting, so no tool should run
const exec = {} as ToolExecutor

async function firstText(it: AsyncIterable<ConverseChunk>): Promise<string> {
  let out = ''
  for await (const c of it) {
    if (typeof c !== 'string') continue // skip a reasoning chunk; we want a real token
    out += c
    if (out.length > 0) break // one real token is proof the contract held
  }
  return out
}

/* The whole file is gated: with MEW_SMOKE unset, `describe.skip` keeps every
   case out of the normal run, so `vitest run` stays green with no live calls. */
const maybe = SMOKE ? describe : describe.skip

maybe('live model-contract smoke', () => {
  const oa = OPENAI_KEY ? it : it.skip
  oa(
    'OpenAI: a real turn streams text with the contract param',
    async () => {
      const adapter = createAiAdapter('openai', OPENAI_KEY!, PROVIDER_CONTRACT.openai.defaultModel)
      const text = await firstText(adapter.converse([{ role: 'user', text: 'say hi in 3 words' }], ctx, exec))
      expect(text.length).toBeGreaterThan(0)
    },
    30_000,
  )

  const an = ANTHROPIC_KEY ? it : it.skip
  an(
    'Anthropic: a real turn streams text within the contract ceiling',
    async () => {
      const adapter = createAiAdapter('anthropic', ANTHROPIC_KEY!, PROVIDER_CONTRACT.anthropic.defaultModel)
      const text = await firstText(adapter.converse([{ role: 'user', text: 'say hi in 3 words' }], ctx, exec))
      expect(text.length).toBeGreaterThan(0)
    },
    30_000,
  )
})
