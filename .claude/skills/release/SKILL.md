---
name: release
description: Build and publish a MEW desktop release locally (no GitHub Actions) — version bump, tag, gbrain sidecar, app bundle, host installer, and a GitHub Release — as individually selectable steps. HOST-PLATFORM ONLY (Tauri does not cross-compile); the .github/workflows/desktop.yml matrix stays the source of truth for full cross-platform releases. Use for fast local iteration (~3–5 min on a capable host vs ~20 min CI) — redos, re-tags, re-publishes. Trigger when the user says "/release", "build a local release", "build the exe/msi locally", "cut a desktop build without CI", "rebuild and republish the installer".
---

# /release — local desktop build + publish (no CI)

Build and ship a MEW desktop release from your own machine, each step independently runnable, so iterating on the installer doesn't burn ~20 min of GitHub Actions per spin. Tracks issue #75.

**Hard constraint — host platform only.** A local `tauri build` produces only the **host OS's** installer (Tauri can't cross-compile Windows↔Linux out of the box). On Windows you get `.msi`/`.nsis`; on Linux `.deb`/`.rpm`/`.AppImage`. This skill **says which platform it is producing and never pretends to make the others.** For a full cross-platform release, push a `v*` tag and let `desktop.yml` run the matrix — that remains the source of truth.

**Use local when:** fast host-platform iteration, redoing a broken build, re-publishing artifacts, testing the updater feed shape.
**Use CI (`git push origin v<version>`) when:** you need all OSes, or signed/notarized artifacts (signing secrets live in CI).

## Constants

```
REPO=Derpimort/mew
ROOT=<repo root>                      # the directory containing app/ and desktop/
TAURI_CONF=desktop/src-tauri/tauri.conf.json
DESK_PKG=desktop/package.json
BUNDLE=desktop/src-tauri/target/release/bundle
```

All `gh`/`git`/`curl` on this box: prefix with `RES_OPTIONS=use-vc` if DNS is flaky (WSL2).

## Invocation

`/release` with no args → interactive: confirm the target version, then run all steps.
Flagged form (any subset, any order of steps):

```
/release --version 0.1.5 --steps version,tag,sidecar,app,installers,release --push --publish --latest
```

| Flag | Default | Meaning |
|---|---|---|
| `--version X.Y.Z` | current `tauri.conf.json` version | target version for the bump/tag/release |
| `--steps a,b,c` | `version,tag,sidecar,app,installers,release` | which steps to run (comma list) |
| `--push` | off | push the tag to origin (CI would then ALSO run — see note) |
| `--draft` / `--publish` | `--publish` | create the GitHub Release as draft or published (matches `desktop.yml`'s draft? no — CI drafts; choose deliberately) |
| `--latest` | on when publishing | mark the release "latest" |
| `--yes` | off | skip confirmation prompts |

Parse the args; if `--version` is omitted, read the current version and ask (or assume current for build-only step subsets like `installers`).

> **`--push` caveat:** pushing `v<version>` triggers `desktop.yml` to build the FULL matrix in CI too. For pure local iteration, **do NOT push** — keep the tag local, or tag a local-only suffix. Only push when you actually want the CI cross-platform release as well.

## Step 0 — preflight (ALWAYS runs first; fail loud, not deep)

Run these and STOP with a clear, actionable message on any failure — never let the user hit a deep Rust/Tauri error:

```bash
# at repo root
test -f "$TAURI_CONF" || { echo "run from the repo root (no $TAURI_CONF)"; exit 1; }

# clean-ish tree + on main (tag/version steps assume main)
git rev-parse --abbrev-ref HEAD                      # warn if not 'main'
git status --short                                   # warn if dirty (version/tag commit will include stray changes)

# gh authed with repo scope (release step needs it)
RES_OPTIONS=use-vc gh auth status >/dev/null 2>&1 || { echo "gh not authed — run: gh auth login"; exit 1; }

# host platform → which installer this run produces
case "$(uname -s)" in
  Linux*)  HOST="linux (.deb/.rpm/.AppImage)";  HOST_KIND=linux ;;
  Darwin*) HOST="macOS (.dmg/.app)";            HOST_KIND=mac ;;
  MINGW*|MSYS*|CYGWIN*) HOST="windows (.msi/.nsis)"; HOST_KIND=windows ;;
  *) HOST="unknown"; HOST_KIND=unknown ;;
esac
echo "this run builds the **$HOST** installer only — other platforms come from CI (desktop.yml)"

# Cargo.lock 'time' pin: 0.3.48 breaks tauri-utils (E0119). The local build must
# NOT regenerate the lock off this pin — never run `cargo update` here.
grep -A1 'name = "time"' "$ROOT/desktop/src-tauri/Cargo.lock" | grep -q '0.3.47' \
  || echo "⚠ Cargo.lock 'time' is not pinned 0.3.47 — do NOT run cargo update; restore the pin first"
```

**Linux host-dep preflight** (the current WSL dev box lacks these and has no passwordless sudo — fail here with the fix, not inside `tauri build`):

```bash
if [ "$HOST_KIND" = linux ] && echo installers app | grep -qw "$STEPS_INCLUDE_INSTALLERS"; then
  miss=""
  for pc in webkit2gtk-4.1 gtk+-3.0 dbus-1 libsoup-3.0; do
    pkg-config --exists "$pc" 2>/dev/null || miss="$miss $pc"
  done
  if [ -n "$miss" ]; then
    cat <<MSG
✗ missing Linux build deps:$miss
  install (Debian/Ubuntu):
    sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev \\
      libdbus-1-dev libsoup-3.0-dev librsvg2-dev libssl-dev build-essential \\
      curl wget file libxdo-dev libayatana-appindicator3-dev
  then re-run /release.
MSG
    exit 1
  fi
fi
```

Also preflight the build toolchains the chosen steps need: `node`/`pnpm` (app), `bun` (sidecar), `rustc`/`cargo` (installers). Missing → name the one to install.

## The steps (run only those in `--steps`)

### 1 · version — bump in sync
Tauri reads the bundle version from `tauri.conf.json`; keep `desktop/package.json` identical.

```bash
V=<target>
# edit the single top-level "version" in each file (verify the diff after)
sed -i.bak 's/"version": *"[^"]*"/"version": "'"$V"'"/' "$TAURI_CONF" && rm "$TAURI_CONF.bak"
sed -i.bak 's/"version": *"[^"]*"/"version": "'"$V"'"/' "$DESK_PKG"  && rm "$DESK_PKG.bak"
git --no-pager diff -- "$TAURI_CONF" "$DESK_PKG"          # confirm ONLY the version moved
```
Optional commit (only if the tree was clean): `git commit -am "desktop: bump to $V"`. Match CI's bump shape so local and CI releases are interchangeable.

### 2 · tag — `v<version>` on main
```bash
git tag -l "v$V" | grep -q . && echo "⚠ v$V already exists — reusing it; will NOT clobber a published release" \
  || git tag -a "v$V" -m "MEW v$V"
# push ONLY if --push (this also triggers the CI matrix):
[ "$PUSH" = 1 ] && RES_OPTIONS=use-vc git push origin "v$V"
```

### 3 · sidecar — compile the pinned gbrain for the host triple
Required before `tauri build` (the installer bundles it).
```bash
node desktop/scripts/build-sidecar.mjs        # → desktop/src-tauri/binaries/gbrain-<host-triple>[.exe]
```

### 4 · app — build the web bundle the shell wraps
```bash
pnpm --dir app install --frozen-lockfile      # --frozen-lockfile: never drift the lock
pnpm --dir app build                          # tsc -b && vite build → app/dist
```

### 5 · installers — `tauri build` (host platform only)
```bash
pnpm --dir desktop install --frozen-lockfile
pnpm --dir desktop build                      # = tauri build; do NOT pass cargo update
# print the artifact paths so the user can grab them:
ls -lh "$BUNDLE"/{deb,rpm,appimage,msi,nsis,dmg}/* 2>/dev/null
```
Report the exact files produced and restate the host platform. If the build wants to touch `Cargo.lock` (the `time` pin), stop — do not regenerate.

### 6 · release — create/upload the GitHub Release
Default published (deliberate choice — CI drafts; pick what you want). Don't clobber a published release: if `v<version>` already has a published release, **upload** to it (`--clobber` only the host artifacts you rebuilt) rather than recreating.
```bash
ARTIFACTS=$(ls "$BUNDLE"/{deb,rpm,appimage,msi,nsis,dmg}/* 2>/dev/null)
if RES_OPTIONS=use-vc gh release view "v$V" --repo $REPO >/dev/null 2>&1; then
  RES_OPTIONS=use-vc gh release upload "v$V" $ARTIFACTS --repo $REPO --clobber
else
  RES_OPTIONS=use-vc gh release create "v$V" $ARTIFACTS --repo $REPO \
    --title "MEW v$V" --generate-notes \
    ${DRAFT:+--draft} ${LATEST:+--latest}
fi
RES_OPTIONS=use-vc gh release view "v$V" --repo $REPO --json url --jq .url
```

## Safety / idempotency

- **Re-runnable.** Re-tagging an existing version warns and reuses; re-publishing uploads (`--clobber`) the host artifacts onto the existing release rather than wiping it. Never silently destroy a published release.
- **Never `cargo update`** in this flow (the `time` 0.3.47 pin). Use `--frozen-lockfile` for pnpm.
- **Host-honest.** Always print which platform's installer was produced; a partial (host-only) release is normal here — the CI matrix fills the rest.
- **Don't push the tag** unless `--push` — a local build is for not-burning-CI; pushing re-invokes CI.

## Output

One line per run: `RELEASED: <release url> · <host platform> · <artifact files>` · or `STEPS DONE: <which> (no release)` for build-only subsets · or `PREFLIGHT FAIL: <what + fix>`.

## Out of scope
Cross-compiling other platforms (CI matrix owns that) · code signing / the auto-updater feed (needs the signing secret, CI-only) · any app/product behavior.
