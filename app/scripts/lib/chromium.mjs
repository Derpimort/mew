/* Shared chromium resolver for the shoot scripts — a single source of truth,
   since shoot.mjs and shoot-overlap.mjs both gate CI from ui-overlap.yml and
   must pick the same browser. Playwright's cache folder name (chromium-NNNN)
   tracks the playwright version, so a hard-pinned path breaks across
   machines/CI. Honor the PW_CHROMIUM seam, else pick the newest chromium-* in
   the cache, else fall back to a known local build. */

import { existsSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function findChromium() {
  if (process.env.PW_CHROMIUM && existsSync(process.env.PW_CHROMIUM)) return process.env.PW_CHROMIUM
  const root = path.join(os.homedir(), '.cache/ms-playwright')
  try {
    const dir = readdirSync(root)
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .reverse()[0]
    for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = dir && path.join(root, dir, rel)
      if (p && existsSync(p)) return p
    }
  } catch {
    /* fall through to the pinned default */
  }
  return path.join(root, 'chromium-1223/chrome-linux64/chrome')
}
