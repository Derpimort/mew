/* API-key audit (#180). PRODUCT LAW: keys never leave the device. MEW holds
   three on-device secrets — anthropicKey, openaiKey, brainToken — and they must
   not escape through any exit a backup, a log line, or a crash report can reach.

   This is a standing audit, not a one-off check: it fails CI the day a future
   change reintroduces a leak (logs a key, forgets to strip one from a backup,
   adds a fourth secret field and skips the redaction, or prints a raw key in
   Settings). The audit owns four exits:

     1. exportJson / stripSecrets — backups carry zero keys.
     2. console.* + throw across app/src — no key is ever logged or thrown.
     3. SECRET_SETTING_KEYS — every secret-shaped field is in the redaction set.
     4. SettingsPage — the key UI masks, never renders a raw key.

   References: OWASP Logging Cheat Sheet (never log secrets/credentials);
   OAuth 2.0 Security BCP (protect bearer tokens at rest and in transit). */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SECRET_SETTING_KEYS, stripSecrets } from '../storage-port'
import { DEFAULT_SETTINGS, type Settings } from '../../domain/types'

/* app/src — resolved from this test file (…/src/adapters/__tests__) so the
   scan is independent of the process cwd vitest happens to run under. */
const SRC = fileURLToPath(new URL('../..', import.meta.url))

/** Every .ts/.tsx under app/src, minus test files (a test naming a key is the
    audit doing its job, not a leak). */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === '__tests__' || ent.name === 'node_modules') continue
      out.push(...sourceFiles(full))
      continue
    }
    if (!/\.(ts|tsx)$/.test(ent.name)) continue
    if (/\.test\.(ts|tsx)$/.test(ent.name)) continue
    out.push(full)
  }
  return out
}

const SECRET_RE = new RegExp(`\\b(${SECRET_SETTING_KEYS.join('|')})\\b`)

describe('API-key audit (#180): keys never leave the device', () => {
  /* ── exit 1: backups ──────────────────────────────────────────────── */
  describe('exportJson / stripSecrets — a backup carries no keys', () => {
    const filled: Settings = {
      ...DEFAULT_SETTINGS,
      anthropicKey: 'sk-ant-SECRET-anthropic',
      openaiKey: 'sk-SECRET-openai',
      brainToken: 'brain-SECRET-token',
      // a non-secret string that MUST survive the redaction untouched
      mewName: 'Pixie',
    }

    it('blanks every secret field to an empty string', () => {
      const out = stripSecrets(filled)!
      for (const k of SECRET_SETTING_KEYS) expect(out[k]).toBe('')
    })

    it('leaves non-secret settings untouched', () => {
      const out = stripSecrets(filled)!
      expect(out.mewName).toBe('Pixie')
      expect(out.remoteProvider).toBe(filled.remoteProvider)
      expect(out.anthropicModel).toBe(filled.anthropicModel) // model id is not a secret
      // googleClientId is a PUBLIC OAuth identifier (BYO-credentials), not a
      // secret — it is allowed to ride along in a backup.
      expect(out.googleClientId).toBe(filled.googleClientId)
    })

    it('does not mutate the source settings object', () => {
      stripSecrets(filled)
      expect(filled.anthropicKey).toBe('sk-ant-SECRET-anthropic')
    })

    it('passes a null settings through unchanged', () => {
      expect(stripSecrets(null)).toBeNull()
    })

    it('no raw secret value appears anywhere in the serialized backup', () => {
      // exportJson is `JSON.stringify({ ...state, settings: stripSecrets(...) })`
      // in both vehicles (Dexie storage.ts, SQLite core sqlite.ts). Prove the
      // redaction end-to-end on that exact serialization.
      const backup = JSON.stringify({ settings: stripSecrets(filled) }, null, 2)
      expect(backup).not.toContain('SECRET') // the marker baked into every key above
      expect(backup).not.toContain(filled.anthropicKey)
      expect(backup).not.toContain(filled.openaiKey)
      expect(backup).not.toContain(filled.brainToken)
    })
  })

  /* ── exit 2: logs + throws ────────────────────────────────────────── */
  describe('no key is logged or thrown anywhere in app/src', () => {
    /* Collect every console.* and throw statement, with a few continuation
       lines so a multiline call is caught whole, then assert none name a
       secret field. This is the acceptance grep, frozen as a test. */
    const offenders: { file: string; line: number; text: string }[] = []

    for (const file of sourceFiles(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        const isLog = /\bconsole\.(log|error|warn|info|debug|trace)\s*\(/.test(line)
        const isThrow = /\bthrow\b/.test(line)
        if (!isLog && !isThrow) return
        // window: this line + up to 3 continuation lines (covers `console.error(\n  ...,\n  err,\n)`)
        const window = lines.slice(i, i + 4).join('\n')
        if (SECRET_RE.test(window)) {
          offenders.push({ file: file.slice(SRC.length), line: i + 1, text: line.trim() })
        }
      })
    }

    it('finds zero console.* / throw statements that reference a secret field', () => {
      expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([])
    })

    it('actually scanned the source tree (guards against a broken scanner)', () => {
      // sanity: the tree has the files we expect to police, so a zero result
      // above means "clean", not "scanned nothing".
      const files = sourceFiles(SRC)
      expect(files.length).toBeGreaterThan(20)
      expect(files.some((f) => f.endsWith('state/store.ts'))).toBe(true)
      expect(files.some((f) => f.endsWith('adapters/model/aiAdapter.ts'))).toBe(true)
    })
  })

  /* ── exit 3: the redaction set can't fall behind the type ──────────── */
  describe('SECRET_SETTING_KEYS covers every secret-shaped field on Settings', () => {
    it('matches every *Key / *Token / *Secret field in DEFAULT_SETTINGS', () => {
      // If someone adds e.g. `supabaseKey` to Settings, this fails until they
      // add it to SECRET_SETTING_KEYS — so the redaction can never silently
      // miss a new secret. googleClientId is intentionally excluded: an OAuth
      // *client id* is a public identifier, not a credential.
      const secretShaped = Object.keys(DEFAULT_SETTINGS).filter((k) => /(Key|Token|Secret)$/.test(k))
      expect([...secretShaped].sort()).toEqual([...SECRET_SETTING_KEYS].sort())
    })

    it('every secret field is a string defaulting to empty (nothing baked in)', () => {
      for (const k of SECRET_SETTING_KEYS) {
        expect(typeof DEFAULT_SETTINGS[k]).toBe('string')
        expect(DEFAULT_SETTINGS[k]).toBe('')
      }
    })
  })

  /* ── exit 4: the Settings UI masks, never prints a raw key ─────────── */
  describe('SettingsPage masks keys in the UI', () => {
    const page = readFileSync(join(SRC, 'ui/pages/SettingsPage.tsx'), 'utf8')

    it('renders every key/token field as a password input', () => {
      // each secret editor is an <input type="password" …>; assert there are at
      // least as many password inputs as secret fields the page edits.
      const passwordInputs = page.match(/type="password"/g) ?? []
      expect(passwordInputs.length).toBeGreaterThanOrEqual(2) // BYO key + brain serve key
    })

    it('shows masked readouts (bullets + last 4), never a bare key value', () => {
      expect(page).toContain('••••') // the mask glyph
      // the resting readout slices to the last 4 chars, never the whole key
      expect(page).toMatch(/\.slice\(-4\)/)
    })

    it('never renders a full secret value as visible text', () => {
      // a leak would look like `>{settings.anthropicKey}<` or
      // `{`...${settings.openaiKey}`}` outside an input value/defaultValue.
      // Guard the obvious shapes: a secret inside a JSX text node or a template
      // literal that is NOT a mask (no `.slice(` on the same expression).
      const rawTextNode = new RegExp(`>\\s*\\{\\s*settings\\.(${SECRET_SETTING_KEYS.join('|')})\\s*\\}`)
      expect(page).not.toMatch(rawTextNode)
    })
  })
})
