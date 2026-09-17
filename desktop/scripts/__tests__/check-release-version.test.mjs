// Cases for the release-version guard. Each one runs the real CLI against a throwaway
// tauri.conf.json (via --conf) and asserts the exit code + the message, so what CI runs
// is exactly what is tested. Run: `pnpm --dir desktop test` (or node --test <this file>).
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', 'check-release-version.mjs')
const COMMITTED_CONF = join(HERE, '..', '..', 'src-tauri', 'tauri.conf.json')
const dir = mkdtempSync(join(tmpdir(), 'mew-release-guard-'))
after(() => rmSync(dir, { recursive: true, force: true }))
let n = 0

// wix === undefined -> no bundle.windows.wix.version at all
function conf(version, wix) {
  const file = join(dir, `tauri.${n++}.conf.json`)
  const bundle = wix === undefined ? {} : { windows: { wix: { version: wix } } }
  writeFileSync(file, JSON.stringify({ productName: 'MEW', version, bundle }))
  return file
}
function run(file, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, '--conf', file, ...args], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}
function passes(r, ...needles) {
  assert.equal(r.code, 0, r.out)
  for (const s of needles) assert.match(r.out, s)
}
function fails(r, ...needles) {
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /✗ release-version guard/)
  for (const s of needles) assert.match(r.out, s)
}

test('good rc: shape + tag pass, promotion refuses the prerelease', () => {
  const f = conf('2026.9.0-rc.1', '26.9.0')
  passes(run(f, '--shape'), /2026\.9\.0-rc\.1 is CalVer/, /MSI version 26\.9\.0 matches/)
  passes(run(f, '--tag', 'v2026.9.0-rc.1'), /matches tag v2026\.9\.0-rc\.1/)
  fails(run(f, '--promotion'), /prerelease version \(2026\.9\.0-rc\.1\)/, /clean release version \(2026\.9\.0/)
})

test('good release: every mode passes', () => {
  const f = conf('2026.9.0', '26.9.0')
  passes(run(f, '--shape'), /2026\.9\.0 is CalVer/)
  passes(run(f, '--promotion'), /clean release version \(2026\.9\.0\)/)
  passes(run(f, '--tag', 'v2026.9.0'), /matches tag v2026\.9\.0/)
  passes(run(f, '--tag', '2026.9.0'), /matches tag v2026\.9\.0/) // leading v optional
})

test('second release in a month and a December release map their MSI versions', () => {
  passes(run(conf('2026.9.1', '26.9.1'), '--promotion'), /MSI version 26\.9\.1 matches/)
  passes(run(conf('2026.12.3-rc.2', '26.12.3'), '--shape'), /MSI version 26\.12\.3 matches/)
  fails(run(conf('2026.9.1', '26.9.0'), '--shape'), /maps to "26\.9\.1"/)
})

test('leading-zero month fails in every mode', () => {
  const f = conf('2026.09.0', '26.9.0')
  for (const args of [['--shape'], ['--promotion'], ['--tag', 'v2026.09.0']]) {
    fails(run(f, ...args), /"2026\.09\.0" is not CalVer/, /never 2026\.09\.0/)
  }
})

test('month 0, month 13 and a year past 2099 are not CalVer', () => {
  fails(run(conf('2026.0.0', '26.0.0'), '--shape'), /"2026\.0\.0" is not CalVer/, /month 1–12/)
  fails(run(conf('2026.13.0', '26.13.0'), '--shape'), /"2026\.13\.0" is not CalVer/)
  fails(run(conf('2100.1.0', '100.1.0'), '--shape'), /"2100\.1\.0" is not CalVer/)
})

test('leading zeros in patch or rc, and legacy SemVer, are not CalVer', () => {
  fails(run(conf('2026.9.00', '26.9.0'), '--shape'), /is not CalVer/)
  fails(run(conf('2026.9.0-rc.01', '26.9.0'), '--shape'), /is not CalVer/)
  fails(run(conf('2026.9.0-beta.1', '26.9.0'), '--shape'), /is not CalVer/)
  fails(run(conf('0.7.0', '0.7.0'), '--shape'), /"0\.7\.0" is not CalVer/, /never SemVer like 0\.7\.0/)
})

test('missing MSI version fails and names the value to set', () => {
  const f = conf('2026.9.0')
  fails(run(f, '--shape'), /missing bundle\.windows\.wix\.version/, /set it to "26\.9\.0"/)
  fails(run(f, '--promotion'), /missing bundle\.windows\.wix\.version/)
  fails(run(f, '--tag', 'v2026.9.0'), /missing bundle\.windows\.wix\.version/)
})

test('mismatched MSI version fails in every mode, including a prerelease left on it', () => {
  fails(run(conf('2026.9.0', '26.9.1'), '--shape'), /is "26\.9\.1" but version 2026\.9\.0 maps to "26\.9\.0"/)
  fails(run(conf('2026.9.0', '2026.9.0'), '--promotion'), /maps to "26\.9\.0"/)
  fails(run(conf('2026.9.0-rc.1', '26.9.0-rc.1'), '--tag', 'v2026.9.0-rc.1'), /maps to "26\.9\.0"/)
})

test('tag mismatch fails, and --tag needs a name', () => {
  const f = conf('2026.9.0', '26.9.0')
  fails(run(f, '--tag', 'v2026.9.1'), /tag v2026\.9\.1 does not match/, /\(2026\.9\.0\)/)
  fails(run(f, '--tag', 'v2026.10.0'), /does not match/)
  fails(run(f, '--tag'), /--tag needs the tag name/)
})

test('a malformed tag fails on its own shape, with delete-and-retag advice — never "bump the config"', () => {
  const f = conf('2026.9.0', '26.9.0')
  const zeroMonth = run(f, '--tag', 'v2026.09.0') // the likely slip: the branch is v2026.09-rc1
  fails(zeroMonth, /tag v2026\.09\.0 is not CalVer/, /git push origin :refs\/tags\/v2026\.09\.0/, /tag v2026\.9\.0/)
  assert.doesNotMatch(zeroMonth.out, /Bump the config/)
  fails(run(f, '--tag', 'v0.7.0'), /tag v0\.7\.0 is not CalVer/)
  // an rc config points the retag at the clean version, after the promotion bump
  const rc = run(conf('2026.9.0-rc.1', '26.9.0'), '--tag', 'v2026.09.0')
  fails(rc, /tag v2026\.9\.0 once the promotion has bumped the config to it/)
})

test('one mode per run: a stray second mode or argument fails instead of passing as the first', () => {
  const f = conf('2026.9.0-rc.1', '26.9.0')
  fails(run(f, '--shape', '--promotion'), /unexpected argument\(s\): --promotion/)
  fails(run(f, '--promotion', 'extra'), /unexpected argument\(s\): extra/)
  fails(run(conf('2026.9.0', '26.9.0'), '--tag', 'v2026.9.0', '--shape'), /unexpected argument\(s\): --shape/)
})

test('unknown mode, unreadable config and a config without a version fail', () => {
  fails(run(conf('2026.9.0', '26.9.0')), /unknown mode ''/)
  fails(run(conf('2026.9.0', '26.9.0'), '--bogus'), /unknown mode '--bogus'/)
  fails(run(join(dir, 'nope.json'), '--shape'), /could not read/)
  const noVersion = join(dir, 'noversion.json')
  writeFileSync(noVersion, JSON.stringify({ productName: 'MEW' }))
  fails(run(noVersion, '--shape'), /has no "version" string/)
})

test('the committed tauri.conf.json passes --shape (version + MSI version agree)', () => {
  passes(run(COMMITTED_CONF, '--shape'), /is CalVer/, /matches/)
})
