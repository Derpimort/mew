/* WCAG 2.2 §1.4.3 contrast — the audit, as runnable math.
 *
 * Pure, dependency-free sRGB relative-luminance + contrast-ratio (the exact
 * formulas from WCAG 2.2 / WebAIM's checker), plus the AA thresholds and the
 * canonical Pet White (light-mode) token reference table. tokens.css is plain
 * CSS, so the only place an audit can *live with behaviour* is here: this module
 * states which token sits on which surface and at which bar, and
 * ui/__tests__/colorContrast.test.ts asserts every pair clears it. Any future
 * token edit that quietly drops a pair below AA fails that test — the audit
 * never goes stale.
 *
 * Carbon (dark) tokens aren't enumerated here: this issue (#174) is the Pet
 * White audit. The primitives below are theme-agnostic, so a Carbon table can be
 * added the same way later.
 */

/** WCAG AA minimum contrast for normal-size body text (1.4.3). */
export const AA_TEXT = 4.5
/**
 * WCAG AA minimum for large text (≥18.66px bold / 24px regular), UI-component
 * boundaries, and graphical objects (1.4.3 / 1.4.11). Also the honest floor for
 * the tertiary "faint" tier — hints, placeholders, footnotes, dashed borders.
 */
export const AA_LARGE_UI = 3.0

/** A parsed sRGB color, channels 0–255. */
export interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * Parse `#rgb` or `#rrggbb` (with or without the leading `#`) to channels.
 * Throws on anything else — token strings are author-controlled, so a malformed
 * value is a bug we want loud, not a silently-wrong ratio.
 */
export function parseHex(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, '')
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`parseHex: not a 3- or 6-digit hex color: "${hex}"`)
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

/** Linearize one gamma-encoded sRGB channel (0–255 → 0–1), per WCAG 2.2. */
function channelLuminance(c255: number): number {
  const c = c255 / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/**
 * Relative luminance L per WCAG 2.2 (0 = black, 1 = white).
 * L = 0.2126·R + 0.7152·G + 0.0722·B over linearized channels.
 */
export function relativeLuminance(color: string | Rgb): number {
  const { r, g, b } = typeof color === 'string' ? parseHex(color) : color
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

/**
 * Contrast ratio between two opaque colors, 1–21, per WCAG 2.2:
 * (L_lighter + 0.05) / (L_darker + 0.05). Order-independent.
 */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Round a ratio to 2 dp the way WebAIM reports it (table-friendly). */
export function ratioToFixed(ratio: number): string {
  return ratio.toFixed(2)
}

/** A foreground/background pair under audit, with the bar it must clear. */
export interface ContrastPair {
  /** Human label, e.g. "muted text on panel". */
  readonly label: string
  /** Foreground (text/glyph/fill) color. */
  readonly fg: string
  /** Background (surface) color. */
  readonly bg: string
  /** Minimum acceptable ratio (AA_TEXT or AA_LARGE_UI). */
  readonly min: number
}

/* ── Pet White (light) surfaces & neutrals — verbatim from tokens.css ──────── */

export const PET_WHITE_SURFACE = {
  bg: '#fdfbf6', // paper white
  panel: '#f6f1e8', // cream (the darkest light surface — the worst case for text)
  panel2: '#fffefb', // near-white raised card
} as const

export const PET_WHITE_NEUTRAL = {
  ink: '#1b160d', // primary text
  muted: '#766a58', // secondary text
  faint: '#998a6c', // tertiary text / hints / borders
} as const

/** Solid-accent label color in Pet White (`--on-acc`). */
export const PET_WHITE_ON_ACC = '#fff'

/** The five pet light-accent pairs (`--pal` work/gold, `--pbl` life/teal). */
export const PET_LIGHT_ACCENTS = {
  cat: { pal: '#8e661b', pbl: '#786d4c' },
  dog: { pal: '#9f5d23', pbl: '#7e6b4e' },
  fox: { pal: '#b0522a', pbl: '#876652' },
  bunny: { pal: '#a84f7c', pbl: '#7c648e' },
  bird: { pal: '#297782', pbl: '#4d7662' },
} as const

export type PetName = keyof typeof PET_LIGHT_ACCENTS

/**
 * Build the full Pet White audit: every neutral and accent against every
 * surface it actually sits on, at its WCAG bar. This is the documented token
 * reference table (acceptance criterion #1) in executable form — the test walks
 * it and the same array prints a before/after on demand.
 *
 *  - ink / muted as small text → AA_TEXT (4.5:1)
 *  - faint as tertiary text/UI → AA_LARGE_UI (3:1)
 *  - each pal/pbl as small text on each surface → AA_TEXT (it carries labels)
 *  - white --on-acc on each pal/pbl fill (now/work block, primary button) → AA_TEXT
 */
export function petWhiteContrastPairs(): ContrastPair[] {
  const pairs: ContrastPair[] = []
  const surfaces = Object.entries(PET_WHITE_SURFACE)

  // neutral text tiers
  for (const [sName, sHex] of surfaces) {
    pairs.push({ label: `ink on ${sName}`, fg: PET_WHITE_NEUTRAL.ink, bg: sHex, min: AA_TEXT })
    pairs.push({ label: `muted on ${sName}`, fg: PET_WHITE_NEUTRAL.muted, bg: sHex, min: AA_TEXT })
    pairs.push({
      label: `faint on ${sName}`,
      fg: PET_WHITE_NEUTRAL.faint,
      bg: sHex,
      min: AA_LARGE_UI,
    })
  }

  // per-pet accents: as text on every surface, and as a fill under white
  for (const pet of Object.keys(PET_LIGHT_ACCENTS) as PetName[]) {
    const { pal, pbl } = PET_LIGHT_ACCENTS[pet]
    for (const [sName, sHex] of surfaces) {
      pairs.push({ label: `${pet} pal text on ${sName}`, fg: pal, bg: sHex, min: AA_TEXT })
      pairs.push({ label: `${pet} pbl text on ${sName}`, fg: pbl, bg: sHex, min: AA_TEXT })
    }
    pairs.push({ label: `${pet} white-on-pal fill`, fg: PET_WHITE_ON_ACC, bg: pal, min: AA_TEXT })
    pairs.push({ label: `${pet} white-on-pbl fill`, fg: PET_WHITE_ON_ACC, bg: pbl, min: AA_TEXT })
  }

  return pairs
}

/** A single audited row: the pair, its measured ratio, and pass/fail. */
export interface ContrastResult extends ContrastPair {
  readonly ratio: number
  readonly passes: boolean
}

/** Measure one pair against its bar. */
export function auditPair(pair: ContrastPair): ContrastResult {
  const ratio = contrastRatio(pair.fg, pair.bg)
  return { ...pair, ratio, passes: ratio >= pair.min }
}

/** Measure the whole Pet White table. */
export function auditPetWhite(): ContrastResult[] {
  return petWhiteContrastPairs().map(auditPair)
}
