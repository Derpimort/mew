# Releases

How MEW ships, and how a release entry becomes a GitHub Release.

## Two surfaces, one set of notes

- **Desktop** (the Tauri shell in `desktop/`) is the versioned artifact. A git tag matching
  `v*` drives [`.github/workflows/desktop.yml`](workflows/desktop.yml): each platform in the
  matrix (Linux, Windows) builds its installer and an updater manifest into a shared **draft**
  release, then the `publish` job flips that draft live once every platform's assets are in.
- **Web** (`app/dist`) ships from the same tree, dockerized and deployed separately — the
  multi-stage image runs tests and typecheck inside the build, then serves the static bundle on
  unprivileged nginx with a strict CSP. See the `Makefile` (`make image` / `make up` /
  `make refresh`) and `docker-compose.yml`. The web build carries no version of its own; it
  rides the same [`CHANGELOG.md`](../CHANGELOG.md) story as the matching desktop tag.

Both surfaces share one source of release notes: the [`CHANGELOG.md`](../CHANGELOG.md) at the
repo root, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## Versioning: CalVer (since 2026.9.0)

MEW's desktop version is the **calendar**: `YYYY.M.PATCH`. It is still a valid semver, so the
updater keeps ordering releases correctly (`2026.9.0` > `0.7.0`).

| Piece | Shape | Example: first release of September 2026 |
|---|---|---|
| RC branch | `vYYYY.MM-rcN` — month zero-padded, `N` counts the RCs | `v2026.09-rc1` |
| `version` in `desktop/src-tauri/tauri.conf.json` on the RC | `YYYY.M.PATCH-rc.N` | `2026.9.0-rc.1` |
| `version` after the promotion PR (on `main`) | `YYYY.M.PATCH` | `2026.9.0` |
| Release tag | `vYYYY.M.PATCH`, must equal the config | `v2026.9.0` |
| `bundle.windows.wix.version` (the MSI's version) | `(YYYY-2000).M.PATCH`, prerelease dropped | `26.9.0` |
| `version` in `desktop/package.json` | mirrors the config, same string | `2026.9.0-rc.1` → `2026.9.0` |

- **No leading zero in the version's month** (`2026.9.0`, never `2026.09.0`): semver forbids
  leading zeros in numeric identifiers and Tauri parses the field as semver. The RC *branch* keeps
  the zero-padded month because it is a label, not a version.
- **`PATCH` counts the releases within the month.** The second September release is `2026.9.1`
  (RC branch `v2026.09-rc2`, MSI `26.9.1`); the first October release resets to `2026.10.0`.
- **The MSI needs its own version.** WiX's ProductVersion caps the major and minor at 255, so a
  bare `2026` fails the Windows build. `bundle.windows.wix.version` overrides it with
  `(YYYY-2000).M.PATCH` — bump it together with `version`; the guard fails on a mismatch. NSIS,
  deb and dmg take the full CalVer version.

`desktop/scripts/check-release-version.mjs` enforces all of it: `--shape` on every desktop PR and
dry-run build (CalVer shape + MSI mapping), `--promotion` on the `v*-rc*` → `main` PR (also rejects
a prerelease), `--tag vYYYY.M.PATCH` on the tag push (also requires tag == config). Its cases live in
`desktop/scripts/__tests__/check-release-version.test.mjs` (`pnpm --dir desktop test`).

Releases before 2026.9.0 (`v0.1.1` … `v0.7.0`) were SemVer; their tags and changelog sections stand.

## Cutting a release (maintainer)

1. **Move `[Unreleased]` into a version.** In `CHANGELOG.md`, rename the `[Unreleased]` heading
   to the new version with today's date (`## [2026.9.0] — 2026-09-18`), then open a fresh empty
   `[Unreleased]` above it. Update the link-reference block at the bottom: add the new version's
   `compare` link and re-point `[Unreleased]` to `vYYYY.M.PATCH...HEAD`.
2. **Bump the shell version to the clean `YYYY.M.PATCH`** in the promotion PR, before any tag:
   `version` **and** `bundle.windows.wix.version` (`(YYYY-2000).M.PATCH`) in
   `desktop/src-tauri/tauri.conf.json`, plus `version` in `desktop/package.json`. Then
   `node desktop/scripts/check-release-version.mjs --promotion` must pass — the installers and
   the updater manifest are stamped from the config, not the tag.
3. **Tag and push** (the tag must equal the config; `--tag` re-checks it before building):
   ```sh
   git tag v2026.9.0
   git push origin v2026.9.0
   ```
   The tag triggers the `release` matrix (installers + updater manifest into a draft) and the
   live model-contract `smoke` job.
4. **Set the GitHub Release description.** CI names the release `MEW vX.Y.Z`. Paste that
   version's `CHANGELOG.md` section as the release body so users see the same story everywhere:
   ```sh
   # after `publish` flips the draft live (or against the draft, before)
   awk '/^## \[2026.9.0\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md \
     | gh release edit v2026.9.0 --repo Derpimort/mew --notes-file -
   ```
   The `awk` slices out just that version's block (everything between its `## [version]` heading
   and the next `## [`), which is exactly the GitHub Release body.

## Automation hook (future)

The manual paste above is the contract; the natural next step is to do it in CI. After the
`publish` job in `desktop.yml`, a small step can read the just-tagged version's section out of
`CHANGELOG.md` (the same `awk` slice) and `gh release edit "$TAG" --notes-file -`, so the
release body is filled from the changelog with no hand edits. This is intentionally deferred to
keep release cuts auditable by hand first; when added, it does not change the maintainer's job —
the source of truth stays the `CHANGELOG.md` entry. [Conventional Commits](https://www.conventionalcommits.org/)
would let the `[Unreleased]` section itself be drafted from history.
