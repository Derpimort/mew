import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  AA_LARGE_UI,
  AA_TEXT,
  auditPetWhite,
  contrastRatio,
  parseHex,
  PET_LIGHT_ACCENTS,
  PET_WHITE_NEUTRAL,
  petWhiteContrastPairs,
  ratioToFixed,
  relativeLuminance,
  type PetName,
} from '../colorContrast'

/* The Pet White WCAG 2.2 §1.4.3 audit, enforced. Three jobs:
   1. the contrast math matches the WCAG/WebAIM reference values,
   2. every Pet White token clears its bar (the audit can't regress),
   3. the documented token table in colorContrast.ts still matches tokens.css
      (the audit can't silently drift from what actually ships). */

describe('relativeLuminance — WCAG 2.2 reference points', () => {
  it('black is 0, white is 1', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6)
  })

  it('uses the 0.2126/0.7152/0.0722 channel weights (green dominates)', () => {
    const r = relativeLuminance('#ff0000')
    const g = relativeLuminance('#00ff00')
    const b = relativeLuminance('#0000ff')
    expect(g).toBeGreaterThan(r)
    expect(r).toBeGreaterThan(b)
    // pure green luminance is the green weight exactly
    expect(g).toBeCloseTo(0.7152, 4)
  })
})

describe('contrastRatio — WCAG 2.2 reference points', () => {
  it('black on white is the maximum 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2)
  })

  it('a color against itself is 1:1', () => {
    expect(contrastRatio('#766a58', '#766a58')).toBeCloseTo(1, 6)
  })

  it('is order-independent', () => {
    expect(contrastRatio('#1b160d', '#fdfbf6')).toBeCloseTo(contrastRatio('#fdfbf6', '#1b160d'), 10)
  })

  it('matches WebAIM for a known pair (#777 on #fff ≈ 4.48)', () => {
    // WebAIM's canonical "fails AA by a hair" example
    expect(ratioToFixed(contrastRatio('#777777', '#ffffff'))).toBe('4.48')
  })
})

describe('parseHex', () => {
  it('reads 6-digit and 3-digit hex, with or without #', () => {
    expect(parseHex('#fdfbf6')).toEqual({ r: 253, g: 251, b: 246 })
    expect(parseHex('fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHex('#abc')).toEqual({ r: 170, g: 187, b: 204 })
  })

  it('throws on a malformed color (loud, not silently wrong)', () => {
    expect(() => parseHex('#12345')).toThrow()
    expect(() => parseHex('not-a-color')).toThrow()
  })
})

describe('Pet White token audit — every pair clears WCAG AA (1.4.3)', () => {
  const results = auditPetWhite()

  it('audits the full surface × token matrix (sanity: non-empty)', () => {
    // 3 neutrals × 3 surfaces + 5 pets × (2 accents × 3 surfaces + 2 fills)
    expect(results).toHaveLength(9 + 5 * 8)
  })

  it.each(results.map((r) => [r.label, r] as const))('%s clears its bar', (_label, r) => {
    expect(r.passes, `${r.label}: ${ratioToFixed(r.ratio)}:1 < required ${r.min}:1`).toBe(true)
  })

  it('secondary text (muted) clears the 4.5:1 body-text bar on the worst surface', () => {
    // panel (cream) is the darkest light surface — the hardest case for text
    expect(contrastRatio(PET_WHITE_NEUTRAL.muted, '#f6f1e8')).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('tertiary text (faint) clears 3:1 yet stays lighter than muted (tiers intact)', () => {
    expect(contrastRatio(PET_WHITE_NEUTRAL.faint, '#f6f1e8')).toBeGreaterThanOrEqual(AA_LARGE_UI)
    // faint must remain the *lighter* tier — a higher luminance than muted
    expect(relativeLuminance(PET_WHITE_NEUTRAL.faint)).toBeGreaterThan(
      relativeLuminance(PET_WHITE_NEUTRAL.muted)
    )
  })

  it('every pet accent works both as text and as a white-on-fill button', () => {
    for (const pet of Object.keys(PET_LIGHT_ACCENTS) as PetName[]) {
      const { pal, pbl } = PET_LIGHT_ACCENTS[pet]
      // as text on the worst surface (panel)
      expect(contrastRatio(pal, '#f6f1e8')).toBeGreaterThanOrEqual(AA_TEXT)
      expect(contrastRatio(pbl, '#f6f1e8')).toBeGreaterThanOrEqual(AA_TEXT)
      // as a fill carrying white --on-acc text
      expect(contrastRatio('#ffffff', pal)).toBeGreaterThanOrEqual(AA_TEXT)
      expect(contrastRatio('#ffffff', pbl)).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })
})

describe('audit fidelity — the documented table matches tokens.css', () => {
  // read the real stylesheet so the reference table can never silently drift
  const cssPath = fileURLToPath(new URL('../tokens.css', import.meta.url))
  const css = readFileSync(cssPath, 'utf8')

  const readVar = (scope: string, name: string): string => {
    // find the rule block for `scope`, then the variable inside it
    const block = new RegExp(`${scope.replace(/[.[\]'=]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)
    expect(block, `rule not found: ${scope}`).toBeTruthy()
    const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,6})`).exec(block![1])
    expect(m, `${name} not found in ${scope}`).toBeTruthy()
    return m![1].toLowerCase()
  }

  it('--faint in .sys--light equals PET_WHITE_NEUTRAL.faint', () => {
    expect(readVar('.nx.sys.sys--light', '--faint')).toBe(PET_WHITE_NEUTRAL.faint)
  })

  it.each(Object.keys(PET_LIGHT_ACCENTS) as PetName[])(
    '%s --pal/--pbl in tokens.css equal PET_LIGHT_ACCENTS',
    (pet) => {
      const scope = `.nx.sys[data-pet='${pet}']`
      expect(readVar(scope, '--pal')).toBe(PET_LIGHT_ACCENTS[pet].pal)
      expect(readVar(scope, '--pbl')).toBe(PET_LIGHT_ACCENTS[pet].pbl)
    }
  )
})

describe('petWhiteContrastPairs — shape of the documented audit', () => {
  it('labels every pair and tags it with a real WCAG bar', () => {
    for (const p of petWhiteContrastPairs()) {
      expect(p.label.length).toBeGreaterThan(0)
      expect([AA_TEXT, AA_LARGE_UI]).toContain(p.min)
    }
  })
})
