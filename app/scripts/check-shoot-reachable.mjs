/* Every shoot proof is reachable by name from package.json, and every name
   points at a file that exists.

   WHY THIS EXISTS (#171). At the RC tip there were SEVENTEEN shoot proofs and
   only FIVE could be run without typing a path: `shoot`, `shoot:overlap`,
   `shoot:onboarding`, `shoot:ritual`, `shoot:scaffold`. Two run in CI, both in
   `ui-overlap.yml`. No script spawns another (zero `child_process`, `spawn(`,
   `execFile` across all seventeen), so nothing else made the rest reachable —
   TWELVE proofs, ~2900 lines, ran only if a human remembered them. Several
   acceptance criteria on #23 and #27 were satisfied by proofs in that set.
   Our own crew gate says "plus shoot and overlap for UI", and that resolved to
   two of seventeen: true, and worth much less than it sounded.

   Evidence that exists and is never consulted decays silently, which is a green
   that means nothing one level up from the tests. Running the twelve (#171 step
   1) found ten still passing and two rotted — one missing the onboarding bypass
   that #160's tour made necessary, one asserting a sentence the product no
   longer says while its own log showed the behaviour it claimed was broken.
   Both were repaired in #173 before this landed, so all seventeen are wired up
   and KNOWN_BROKEN below is empty on purpose.

   What is NOT settled by reachability: nine of the twelve pin no date, so they
   passed on a Thursday and nobody knows about a Sunday (#171 step 3), and a run
   still rewrites tracked canon PNGs in place under a gitignored directory. This
   guard makes the proofs runnable; it does not make them trustworthy.

   BOTH DIRECTIONS, because a guard that checks one is the vacuous half:
     1. a proof with no package.json script pointing at it   → orphan
     2. a script pointing at a scripts/*.mjs that is missing  → dangling
     3. an exemption below that is now reachable, or names a
        file that no longer exists                            → stale exemption

   Rule 3 is the one that keeps this honest. An exemption with no expiry is how
   a known-broken proof becomes a permanently ignored one: the moment someone
   repairs `shoot-dial.mjs` and wires it in, this guard FAILS and tells them to
   delete the excuse. An exemption that outlives its reason is the same defect
   this file exists to catch, so it cannot be allowed to hide here either.

   THE BOUNDARY OF RULE 3, stated rather than left to be discovered: it catches
   an exemption that became REACHABLE and one whose FILE is gone. It cannot
   catch "repaired but still unwired", because nothing static can tell a broken
   proof from a fixed one — that is why the reason beside each entry is a
   written claim and not a check. So a repair must wire its proof up in the
   SAME change, which turns the exemption reachable and makes rule 3 delete it
   for you. A repair that leaves the entry behind leaves a true-looking reason
   that is false, and this guard would pass.

   It does NOT run the proofs. Reachability is cheap and static; running them
   needs a build, a served URL and a browser, and would turn `pnpm lint` into a
   ten-minute job. Which of them belong in CI is a separate decision with the
   owner (#171 step 3).

   Dependency-free and wired into `pnpm lint` beside check-test-structure.mjs —
   no new package, no lockfile change, no new CI job, so the expected check set
   does not move.

   Usage: node scripts/check-shoot-reachable.mjs [appDir]   (default: cwd)
   Exit 0 = every proof reachable and every name resolves, 1 = otherwise.

   The pure piece (findUnreachable) is exported for
   scripts/__tests__/check-shoot-reachable.test.ts. */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** Proofs measured BROKEN and deliberately left unwired, each with the reason
    beside it as a claim someone can check.

    DELIBERATELY EMPTY ON ARRIVAL — read the emptiness as a measurement, not an
    oversight. The two proofs this list was written for (`shoot-dial.mjs`, whose
    hover timed out on #160's concept tour, and `shoot-rescue.mjs`, which
    asserted a sentence MEW had stopped saying) were repaired in #173 and are
    wired up below with the other ten. All seventeen are reachable.

    The machinery stays because the next rotted proof will want it, and because
    of what happened when it nearly shipped populated: an exemption whose reason
    describes a string no longer in the file it describes is a false reasoning
    trail inside the guard against false reasoning trails. coderpa measured that
    window rather than arguing it — copied the repaired proofs onto this branch,
    left them unwired exactly as this PR would have, and the guard reported
    "15 of 17 reachable, 2 exempt" with both proofs passing. Hence the merge
    order, and hence an empty list.

    So, for whoever adds the next entry: write the reason, and wire the proof up
    in the SAME change once it is repaired, because rule 3 can only see an
    exemption that became reachable or lost its file (see the boundary above). */
export const KNOWN_BROKEN = []

/** every shoot proof ENTRY POINT in a scripts dir: `scripts/shoot*.mjs`, but
    not `scripts/lib/*` — `lib/shootClock.mjs` is a helper five proofs import,
    not a proof, and counting it would inflate the total by one. */
export function proofEntryPoints(scriptsDir) {
  let entries
  try {
    entries = readdirSync(scriptsDir)
  } catch {
    return []
  }
  return entries.filter((n) => /^shoot.*\.mjs$/.test(n)).sort()
}

/** Every `scripts/<name>.mjs` a package.json script command mentions. */
function referencedScripts(scripts) {
  const refs = new Map() // file → [script names]
  for (const [name, cmd] of Object.entries(scripts)) {
    for (const m of String(cmd).matchAll(/scripts\/([\w.-]+\.mjs)/g)) {
      const file = m[1]
      refs.set(file, [...(refs.get(file) ?? []), name])
    }
  }
  return refs
}

/**
 * The whole policy, with no filesystem of its own beyond `fileExists`.
 * @param proofs basenames of shoot proof entry points (from proofEntryPoints)
 * @param scripts the package.json `scripts` map
 * @param fileExists (basename) => boolean, for `scripts/<basename>`
 * @param exempt basenames allowed to be unreachable (KNOWN_BROKEN)
 */
export function findUnreachable(proofs, scripts, fileExists, exempt = KNOWN_BROKEN) {
  const refs = referencedScripts(scripts)
  const reachable = (f) => refs.has(f)

  const orphans = proofs.filter((p) => !reachable(p) && !exempt.includes(p))
  const dangling = [...refs.keys()].filter((f) => !fileExists(f)).sort()
  const staleExemptions = exempt
    .map((e) =>
      !fileExists(e)
        ? { file: e, why: 'no such file — the proof was renamed or deleted' }
        : reachable(e)
          ? { file: e, why: `now reachable via ${refs.get(e).join(', ')} — repaired?` }
          : null
    )
    .filter(Boolean)

  return { orphans, dangling, staleExemptions, scanned: proofs.length }
}

/* CLI only when run directly, the same main-guard the other checks use: a test
   importing the pure piece must not scan the tree or exit the run. */
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (isMain) {
  const appDir = process.argv[2] ?? '.'
  const scriptsDir = join(appDir, 'scripts')
  const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))
  const proofs = proofEntryPoints(scriptsDir)
  const { orphans, dangling, staleExemptions, scanned } = findUnreachable(
    proofs,
    pkg.scripts ?? {},
    (f) => existsSync(join(scriptsDir, f))
  )

  /* THE ANTI-VACUOUS CHECK, and it comes first. Every finding below is a filter
     over `proofs`; if the reader ever finds nothing — the dir moved, the naming
     convention changed — all three lists come back empty and this guard reports
     a green it never computed. That is the exact defect it was written to catch,
     so it cannot be allowed to happen here. */
  if (!scanned) {
    console.error(
      `check-shoot-reachable: found NO shoot proofs in ${scriptsDir}.\n` +
        `That is not a pass — the reader is looking in the wrong place, or the\n` +
        `naming convention moved. Every check here filters the set it just failed\n` +
        `to build, so an empty set would report a green that means nothing.`
    )
    process.exit(1)
  }

  const fail = orphans.length + dangling.length + staleExemptions.length
  if (fail) {
    console.error(`check-shoot-reachable: ${fail} problem${fail === 1 ? '' : 's'}.\n`)
    if (orphans.length) {
      console.error(
        `  Unreachable proof${orphans.length === 1 ? '' : 's'} — no package.json script runs ${orphans.length === 1 ? 'it' : 'them'}:`
      )
      for (const o of orphans) console.error(`    scripts/${o}`)
      console.error(
        `  Add "shoot:<name>": "node scripts/<file>" so it can be run, and deleted when obsolete.\n` +
          `  A proof nobody can run is evidence nobody consults (#171).\n`
      )
    }
    if (dangling.length) {
      console.error(`  Script name${dangling.length === 1 ? '' : 's'} pointing at a missing file:`)
      for (const d of dangling) console.error(`    scripts/${d}`)
      console.error(`  Fix the path or drop the entry.\n`)
    }
    if (staleExemptions.length) {
      console.error(`  Stale entr${staleExemptions.length === 1 ? 'y' : 'ies'} in KNOWN_BROKEN:`)
      for (const s of staleExemptions) console.error(`    ${s.file} — ${s.why}`)
      console.error(`  Delete the exemption; it has outlived its reason.\n`)
    }
    process.exit(1)
  }

  const exempt = KNOWN_BROKEN.length
  console.log(
    `✓ check-shoot-reachable: ${scanned - exempt} of ${scanned} shoot proofs reachable by name` +
      (exempt ? `, ${exempt} exempt and named in KNOWN_BROKEN (#171)` : '')
  )
}
