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
//   --shape           Nothing more. Run on every desktop PR and on dry-run builds.
//   --promotion       Fail if the committed version is a prerelease (-rc.N). Run on
//                     a v*-rc* → main promotion PR: main must always carry a clean
//                     release version, and the bump to it belongs in the promotion,
//                     before any tag.
//   --tag vX.Y.Z      Fail unless the committed version === the tag (sans leading
//                     'v'). Run on a release tag push: the artifacts build from the
//                     config, so the tag they publish under must match it exactly.
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
const [mode, arg] = rest

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
    `${conf} version "${version}" is not CalVer. Expected YYYY.M.PATCH or YYYY.M.PATCH-rc.N ` +
      `with no leading zeros — 2026.9.0 or 2026.9.0-rc.1, never 2026.09.0 (semver rejects it) ` +
      `and never SemVer like 0.7.0. The installers + updater manifest are stamped from this field.`,
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
  const tag = (arg ?? '').replace(/^v/, '')
  if (!tag) fail('--tag needs the tag name, e.g. --tag v2026.9.0')
  if (version !== tag) {
    fail(
      `tag v${tag} does not match ${conf} (${version}). ` +
        `Bump the config to ${tag} and re-tag: the installers + updater manifest are ` +
        `versioned from the config, so a mismatch ships mislabeled artifacts.`,
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
