#!/usr/bin/env node
// Deterministic release-version guard.
//
// Added after the v0.6.0 incident: v0.6.0 was nearly tagged while
// desktop/src-tauri/tauri.conf.json still read "0.6.0-rc.1". tauri-action stamps
// the installers AND the updater manifest (latest.json) from that file — NOT from
// the git tag — so tagging as-is would have published a "v0.6.0" GitHub Release
// full of artifacts labeled 0.6.0-rc.1, and existing installs would never see the
// update. This guard makes that impossible to ship silently.
//
// Since 2026.9.0 MEW versions by the calendar (CalVer, still a valid semver so the
// updater's ordering keeps working — 2026.9.0 > 0.7.0):
//
//   YYYY.M.PATCH[-rc.N]     2026.9.0-rc.1 on the RC branch, 2026.9.0 on main
//
// - M is the month WITHOUT a leading zero: semver forbids leading zeros in numeric
//   identifiers and Tauri parses this field as semver (2026.09.0 would not build).
//   PATCH counts the releases within the month (the second September release is
//   2026.9.1). RC branches are labels, not versions, so they keep the zero-padded
//   month: vYYYY.MM-rcN (v2026.09-rc1).
// - Windows MSI: WiX caps ProductVersion's major and minor at 255, so a 2026 major
//   fails the MSI build. bundle.windows.wix.version overrides the MSI version and
//   MUST equal the derived (YYYY-2000).M.PATCH — 2026.9.0[-rc.N] -> 26.9.0 (MSI
//   versions are numeric only, so the prerelease is dropped). Bump both together.
//
// Every mode first checks that shape + the MSI mapping, then:
//   --shape           Nothing more. The `release-guard` workflow runs it (with this
//                     file's own cases) on every PR that touches the config or the
//                     guard; desktop.yml runs it before every build (tag or dry-run).
//   --promotion       Fail if the committed version is a prerelease (-rc.N). Run on
//                     a v*-rc* → main promotion PR: main must always carry a clean
//                     release version, and the bump to it belongs in the promotion,
//                     before any tag.
//   --tag vX.Y.Z      Fail unless the tag is itself CalVer (a zero-padded month gets
//                     delete-and-retag advice, never "bump the config") AND equals the
//                     committed version (sans leading 'v'). Run on a release tag push:
//                     the artifacts build from the config, so the tag they publish
//                     under must match it exactly. A mismatch names both fixes.
// Options:
//   --conf <path>     Config to check (default: desktop/src-tauri/tauri.conf.json,
//                     relative to the repo root — CI runs from there). The cases in
//                     __tests__/check-release-version.test.mjs use it.

import { readFileSync } from 'node:fs'

const DEFAULT_CONF = 'desktop/src-tauri/tauri.conf.json'
// YYYY.M.PATCH with an optional -rc.N — no leading zeros in any numeric identifier.
const CALVER = /^(20\d\d)\.(1[0-2]|[1-9])\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/

function fail(msg) {
  console.error(`✗ release-version guard: ${msg}`)
  process.exit(1)
}

// --conf <path> may sit anywhere in the arguments; everything else is mode + argument.
const argv = process.argv.slice(2)
let conf = DEFAULT_CONF
const rest = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--conf') {
    conf = argv[++i]
    if (!conf) fail('--conf needs a path, e.g. --conf desktop/src-tauri/tauri.conf.json')
  } else {
    rest.push(argv[i])
  }
}
const [mode, arg, ...extra] = rest
// one mode per run — `--shape --promotion` must not pass as `--shape`
const stray = mode === '--tag' ? extra : rest.slice(1)
if (stray.length) {
  fail(
    `unexpected argument(s): ${stray.join(' ')}. One mode per run: ` +
      `--shape | --promotion | --tag vYYYY.M.PATCH`,
  )
}

let config
try {
  config = JSON.parse(readFileSync(conf, 'utf8'))
} catch (e) {
  fail(`could not read ${conf}: ${e.message}`)
}
const version = config.version
if (typeof version !== 'string' || version.length === 0) {
  fail(`${conf} has no "version" string`)
}

const match = CALVER.exec(version)
if (!match) {
  fail(
    `${conf} version "${version}" is not CalVer. Expected YYYY.M.PATCH or YYYY.M.PATCH-rc.N: ` +
      `a four-digit year, month 1–12 without a leading zero, PATCH ≥ 0, rc N ≥ 1 — ` +
      `2026.9.0 or 2026.9.0-rc.1, never 2026.09.0 (semver rejects it) and never SemVer like ` +
      `0.7.0. The installers + updater manifest are stamped from this field.`,
  )
}
const [, year, month, patch, rc] = match
const expectedWix = `${Number(year) - 2000}.${month}.${patch}`
const wix = config.bundle?.windows?.wix?.version
if (typeof wix !== 'string' || wix.length === 0) {
  fail(
    `${conf} is missing bundle.windows.wix.version. WiX caps the MSI major/minor at 255, so a ` +
      `${year} major fails the Windows build: set it to "${expectedWix}" ` +
      `((YYYY-2000).M.PATCH, prerelease dropped).`,
  )
}
if (wix !== expectedWix) {
  fail(
    `${conf} bundle.windows.wix.version is "${wix}" but version ${version} maps to ` +
      `"${expectedWix}" ((YYYY-2000).M.PATCH, prerelease dropped). Bump both together.`,
  )
}
const shapeOk = `✓ ${conf} version ${version} is CalVer (YYYY.M.PATCH); MSI version ${wix} matches`

if (mode === '--shape') {
  console.log(shapeOk)
} else if (mode === '--promotion') {
  if (rc !== undefined) {
    fail(
      `${conf} is a prerelease version (${version}) on a promotion to main. ` +
        `Bump it to the clean release version (${version.split('-')[0]}; bundle.windows.wix.version ` +
        `stays ${expectedWix}) before promoting — the installers + updater manifest are stamped ` +
        `from this file, not the git tag.`,
    )
  }
  console.log(shapeOk)
  console.log(`✓ ${conf} is a clean release version (${version})`)
} else if (mode === '--tag') {
  // the tag exactly as given: the delete command must name the real ref, and a wrong
  // prefix (V2026.9.0) is reported as the tag it is, not rebuilt as vV2026.9.0
  const raw = arg ?? ''
  if (!raw || raw.startsWith('--')) fail('--tag needs the tag name, e.g. --tag v2026.9.0')
  const tag = raw.replace(/^v/, '')
  const clean = version.split('-')[0]
  const retag = `tag v${clean}${rc !== undefined ? ' once the promotion has bumped the config to it' : ''}`
  // the tag's own shape first: a zero-padded month (v2026.09.0, after the branch name
  // v2026.09-rc1) is the likely slip, and "bump the config to 2026.09.0" would be wrong advice
  if (!CALVER.test(tag)) {
    fail(
      `tag ${raw} is not CalVer (vYYYY.M.PATCH — month 1–12 without a leading zero; the RC ` +
        `branch is vYYYY.MM-rcN but the tag is not). Delete it — git push origin ` +
        `:refs/tags/${raw} — and ${retag}.`,
    )
  }
  if (version !== tag) {
    const [, tYear, tMonth, tPatch] = CALVER.exec(tag)
    const tagWix = `${Number(tYear) - 2000}.${tMonth}.${tPatch}`
    fail(
      `tag ${raw} does not match ${conf} (${version}): the installers + updater manifest are ` +
        `versioned from the config, so a mismatch ships mislabeled artifacts. Either fix works — ` +
        `if the config is right, delete the tag (git push origin :refs/tags/${raw}; git tag -d ${raw}) ` +
        `and ${retag}; if the tag is right, bump the config to ${tag}` +
        `${tagWix !== wix ? ` (and bundle.windows.wix.version to ${tagWix})` : ''}, then re-tag ${raw}.`,
    )
  }
  console.log(shapeOk)
  console.log(`✓ ${conf} (${version}) matches tag v${tag}`)
} else {
  fail(
    `unknown mode '${mode ?? ''}'. Usage: check-release-version.mjs [--conf <path>] ` +
      `--shape | --promotion | --tag vYYYY.M.PATCH`,
  )
}
