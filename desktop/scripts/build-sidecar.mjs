#!/usr/bin/env node
/* Compile the pinned gbrain into the Tauri sidecar binary.
 *
 * `bun build --compile` is gbrain's own ship path (its build:all does exactly
 * this, and its CI guards that PGLite/tree-sitter WASM ride embedded), so the
 * sidecar is byte-for-byte the upstream distribution mode — just pinned.
 *
 * The pin lives in desktop/gbrain.version as `owner/repo#ref`; bumping the
 * sidecar is editing that one line. Output lands where tauri.conf.json's
 * externalBin expects it: src-tauri/binaries/gbrain-<target-triple>[.exe].
 *
 *   node scripts/build-sidecar.mjs                 # host target (rustc-detected)
 *   node scripts/build-sidecar.mjs --target x86_64-pc-windows-msvc
 */
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pin = readFileSync(join(desktop, 'gbrain.version'), 'utf8').trim()

/* rust triple → bun compile target; extend when a platform actually ships */
const TARGETS = {
  'x86_64-unknown-linux-gnu': { bun: 'bun-linux-x64', ext: '' },
  'x86_64-pc-windows-msvc': { bun: 'bun-windows-x64', ext: '.exe' },
  'aarch64-apple-darwin': { bun: 'bun-darwin-arm64', ext: '' },
  'x86_64-apple-darwin': { bun: 'bun-darwin-x64', ext: '' },
}

function hostTriple() {
  try {
    return /host: (\S+)/.exec(execSync('rustc -vV', { encoding: 'utf8' }))[1]
  } catch {
    /* no Rust toolchain — fall back to a platform map */
    const { platform, arch } = process
    if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-gnu'
    if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc'
    if (platform === 'darwin') return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
    throw new Error(`no target mapping for ${platform}/${arch}`)
  }
}

const argIdx = process.argv.indexOf('--target')
const triple = argIdx >= 0 ? process.argv[argIdx + 1] : hostTriple()
const target = TARGETS[triple]
if (!target) throw new Error(`unsupported target triple: ${triple} (known: ${Object.keys(TARGETS).join(', ')})`)

/* a scratch install of the pinned gbrain — gitignored, reused across runs */
const work = join(desktop, '.sidecar-build')
mkdirSync(work, { recursive: true })
writeFileSync(
  join(work, 'package.json'),
  JSON.stringify({ name: 'mew-sidecar-build', private: true, dependencies: { gbrain: `github:${pin}` } }, null, 2),
)
console.log(`[sidecar] installing gbrain (${pin})…`)
execSync('bun install', { cwd: work, stdio: 'inherit' })

/* PGLite resolves its WASM payloads as `new URL('./pglite.data',
   import.meta.url)` — a pattern bun's bundler does NOT lift into the
   compiled binary's vfs (gbrain #1340: every PGLite command ENOENTs on
   /$bunfs/root/pglite.data, official builds included). The wrapper entry
   force-embeds the payloads, and --asset-naming pins them to their EXACT
   runtime names so the URL math lands on them. */
writeFileSync(
  join(work, 'sidecar-entry.ts'),
  [
    "import './node_modules/@electric-sql/pglite/dist/pglite.data' with { type: 'file' }",
    "import './node_modules/@electric-sql/pglite/dist/pglite.wasm' with { type: 'file' }",
    "import './node_modules/@electric-sql/pglite/dist/initdb.wasm' with { type: 'file' }",
    "import './node_modules/@electric-sql/pglite/dist/vector.tar.gz' with { type: 'file' }",
    "import './node_modules/@electric-sql/pglite/dist/pg_trgm.tar.gz' with { type: 'file' }",
    "import './node_modules/gbrain/src/cli.ts'",
    '',
  ].join('\n'),
)

/* The two extension bundles gbrain loads (vector, pg_trgm) are referenced
   as `new URL('../<name>.tar.gz', import.meta.url)` — after bundling, the
   chunk lives at /$bunfs/root/<bin>, so `../` escapes the vfs root. Repoint
   to `./` so they resolve beside the other embedded assets. Idempotent
   (the scratch install persists across runs); loud when the pinned pglite
   layout drifts so the smoke test never chases a silent miss. */
for (const rel of [
  'node_modules/@electric-sql/pglite/dist/vector/index.js',
  'node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js',
]) {
  const file = join(work, rel)
  const before = readFileSync(file, 'utf8')
  if (before.includes('new URL("./')) continue // already patched
  const after = before.replaceAll('new URL("../', 'new URL("./')
  if (after === before) throw new Error(`[sidecar] no ../*.tar.gz URL found to patch in ${rel} — pglite layout changed?`)
  writeFileSync(file, after)
}

/* PGLite's node-path extension loader streams the tarball through
   fs.createReadStream — a kernel-syscall path bun's embedded vfs does NOT
   intercept (existsSync passes, the read ENOENTs). readFileSync IS
   intercepted, so swap stream+gunzip for readFileSync+gunzipSync. Byte-exact
   match on the pinned pglite dist; loud when it drifts. */
{
  const file = join(work, 'node_modules/@electric-sql/pglite/dist/index.js')
  const before = readFileSync(file, 'utf8')
  const streamRead =
    'let _=r.createGunzip(),s=[];return await o(t.createReadStream(e),_,new a({write(n,l,d){s.push(n),d()}})),new Blob(s)'
  const syncRead = 'return new Blob([r.gunzipSync(t.readFileSync(e))])'
  if (!before.includes(syncRead)) {
    if (!before.includes(streamRead)) throw new Error('[sidecar] pglite extension loader changed — update the patch')
    writeFileSync(file, before.replace(streamRead, syncRead))
  }
}

const outDir = join(desktop, 'src-tauri', 'binaries')
mkdirSync(outDir, { recursive: true })
const outfile = join(outDir, `gbrain-${triple}${target.ext}`)
console.log(`[sidecar] compiling ${target.bun} → ${outfile}`)
execSync(
  `bun build --compile --target=${target.bun} --asset-naming=[name].[ext] sidecar-entry.ts --outfile ${outfile}`,
  { cwd: work, stdio: 'inherit' },
)
console.log('[sidecar] done')
