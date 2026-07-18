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
// Modes:
//   --promotion       Fail if the committed version is a prerelease (contains a
//                     `-…` suffix like -rc/-beta). Run on a v*-rc → main promotion
//                     PR: main must always carry a clean release version, and the
//                     bump to it belongs in the promotion, before any tag.
//   --tag vX.Y.Z      Fail unless the committed version === the tag (sans leading
//                     'v'). Run on a release tag push: the artifacts build from the
//                     config, so the tag they publish under must match it exactly.
//
// Reads the config relative to the repo root (CI runs from there).

import { readFileSync } from 'node:fs'

const CONF = 'desktop/src-tauri/tauri.conf.json'

function fail(msg) {
  console.error(`✗ release-version guard: ${msg}`)
  process.exit(1)
}

let version
try {
  version = JSON.parse(readFileSync(CONF, 'utf8')).version
} catch (e) {
  fail(`could not read ${CONF}: ${e.message}`)
}
if (typeof version !== 'string' || version.length === 0) {
  fail(`${CONF} has no "version" string`)
}

const [mode, arg] = process.argv.slice(2)

if (mode === '--promotion') {
  if (version.includes('-')) {
    fail(
      `${CONF} is a prerelease version (${version}) on a promotion to main. ` +
        `Bump it to a clean release version (${version.split('-')[0]}) before promoting — ` +
        `the installers + updater manifest are stamped from this file, not the git tag.`,
    )
  }
  console.log(`✓ ${CONF} is a clean release version (${version})`)
} else if (mode === '--tag') {
  const tag = (arg ?? '').replace(/^v/, '')
  if (!tag) fail('--tag needs the tag name, e.g. --tag v1.2.3')
  if (version !== tag) {
    fail(
      `tag v${tag} does not match ${CONF} (${version}). ` +
        `Bump the config to ${tag} and re-tag: the installers + updater manifest are ` +
        `versioned from the config, so a mismatch ships mislabeled artifacts.`,
    )
  }
  console.log(`✓ ${CONF} (${version}) matches tag v${tag}`)
} else {
  fail(`unknown mode '${mode ?? ''}'. Usage: check-release-version.mjs --promotion | --tag vX.Y.Z`)
}
