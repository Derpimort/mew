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

## Cutting a release (maintainer)

1. **Move `[Unreleased]` into a version.** In `CHANGELOG.md`, rename the `[Unreleased]` heading
   to the new version with today's date (`## [0.1.10] — 2026-06-19`), then open a fresh empty
   `[Unreleased]` above it. Update the link-reference block at the bottom: add the new version's
   `compare` link and re-point `[Unreleased]` to `vX.Y.Z...HEAD`.
2. **Bump the shell version** to match in `desktop/tauri.conf.json` and `desktop/package.json`.
3. **Tag and push:**
   ```sh
   git tag v0.1.10
   git push origin v0.1.10
   ```
   The tag triggers the `release` matrix (installers + updater manifest into a draft) and the
   live model-contract `smoke` job.
4. **Set the GitHub Release description.** CI names the release `MEW vX.Y.Z`. Paste that
   version's `CHANGELOG.md` section as the release body so users see the same story everywhere:
   ```sh
   # after `publish` flips the draft live (or against the draft, before)
   awk '/^## \[0.1.10\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md \
     | gh release edit v0.1.10 --repo Derpimort/mew --notes-file -
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
