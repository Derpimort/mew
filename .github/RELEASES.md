# Releases

How MEW ships, and how a release entry becomes a GitHub Release.

## Two surfaces, one set of notes

- **Desktop** (the Tauri shell in `desktop/`) is the versioned artifact. A git tag matching
  `v*` drives [`.github/workflows/desktop.yml`](workflows/desktop.yml): each platform in the
  matrix (Linux, Windows, macOS) builds its installer and an updater manifest into a shared **draft**
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
| RC branch | `vYYYY.MM-rcN` — month zero-padded; `N` counts the month's release cycles (the second September release is `v2026.09-rc2`) | `v2026.09-rc1` |
| `version` in `desktop/src-tauri/tauri.conf.json` on the RC | `YYYY.M.PATCH-rc.N` — `N` counts the candidate builds within that cycle (a re-spun candidate is `-rc.2`; the branch stays) | `2026.9.0-rc.1` |
| `version` after the promotion PR (on `main`) | `YYYY.M.PATCH` | `2026.9.0` |
| Release tag | `vYYYY.M.PATCH`, must equal the config | `v2026.9.0` |
| `bundle.windows.wix.version` (the MSI's version) | `(YYYY-2000).M.PATCH`, prerelease dropped | `26.9.0` |
| `version` in `desktop/package.json` | mirrors the config, same string | `2026.9.0-rc.1` → `2026.9.0` |

- **No leading zero in the version's month** (`2026.9.0`, never `2026.09.0`): semver forbids
  leading zeros in numeric identifiers and Tauri parses the field as semver. The RC *branch* keeps
  the zero-padded month because it is a label, not a version.
- **`PATCH` counts the releases within the month.** The second September release: RC branch
  `v2026.09-rc2`, config `2026.9.1-rc.1` → promotion `2026.9.1`, tag `v2026.9.1`, MSI `26.9.1`.
  The first October release resets to `2026.10.0` (branch `v2026.10-rc1`, MSI `26.10.0`).
- **The MSI needs its own version.** WiX's ProductVersion caps the major and minor at 255, so a
  bare `2026` fails the Windows build. `bundle.windows.wix.version` overrides it with
  `(YYYY-2000).M.PATCH`. NSIS, deb and dmg take the full CalVer version.
- **When an RC is cut** — a new month's `-rc1` or a same-month PATCH like `v2026.09-rc2` — set
  `version` = `YYYY.M.PATCH-rc.1` **and** `bundle.windows.wix.version` = `(YYYY-2000).M.PATCH`
  together (the guard fails on a mismatch); a PATCH moves the MSI version too (`26.9.1`).
  Both stay through the RC; the promotion PR only strips `-rc.N` from `version` — the MSI
  version already has no prerelease, so it does not move at promotion.

`desktop/scripts/check-release-version.mjs` enforces all of it, and every mode first checks the
CalVer shape + the MSI mapping: `--shape` runs in the `release-guard` workflow
(`.github/workflows/release-guard.yml`, its own so a desktop-only change skips the app's gates) on every PR that
touches `tauri.conf.json`, `desktop/package.json` or the guard (together with the guard's own
cases), and before every desktop build (tag or dry-run); `--promotion` on the `v*-rc*` → `main` PR
(also rejects a prerelease); `--tag vYYYY.M.PATCH` on the tag push (also requires a well-formed tag
equal to the config, and on a mismatch names both fixes: re-tag from the config, or bump the
config to the tag). Its cases live in `desktop/scripts/__tests__/check-release-version.test.mjs`
(`pnpm --dir desktop test`).

`desktop/scripts/check-changelog.mjs` guards the release notes in the same workflow. It runs on every
PR that touches `CHANGELOG.md`, and it checks two families:

- **No repeats inside `[Unreleased]`** — never the same section heading or bullet twice. Every PR adds
  its own line and squash merges make the others re-sync with a keep-both, which once re-introduced
  seven whole sections; that body becomes the release body at promotion, so a duplicate is a release
  defect rather than a nit.
- **The link-reference block stays in step with the headings** (#186) — every `## [X.Y.Z]` has a
  matching `[X.Y.Z]:` line, every version reference has a heading above it, `[Unreleased]:` compares
  `v<newest released version>...HEAD`, and no version label is defined twice. This is step 1's third
  part, the one that used to be guarded by nothing: skip it and the new version renders as plain text
  where every other version is a link while every gate passes. Only each version link's *existence* is
  checked, not its range — the ranges are history and do not all read `v<prev>...v<this>` (`[0.3.0]`
  ends at a bare sha), so a stricter rule would fail on the committed file.

Both families read the file with **fenced code blocks removed**, the way a renderer does: a link block
inside a fence must not satisfy the existence check, and an example `## [X.Y.Z]` shown in a fence — as
this document does — must not be counted as a release. Its cases live beside the version guard's
(`pnpm --dir desktop test`).

That file is **hand-edited, never formatted.** `pnpm format:check` is `prettier . --check` run from
`app/`, so the root `CHANGELOG.md` sits outside the format gate on purpose. Running prettier over it
rewrites the whole file — a blank line after every heading, `*emphasis*` into `_emphasis_`, re-wrapped
continuation lines — which collides with every other open PR's bullet and, worse, edits the sections
of releases that already shipped. Their text is what every audit of these notes rests on, so it stays
byte-identical once a version is cut. Match the surrounding style by hand (a `###` heading followed
straight by its bullets) and check the edit with `node desktop/scripts/check-changelog.mjs CHANGELOG.md`.

Releases before 2026.9.0 (`v0.1.1` … `v0.7.0`) were SemVer; their tags and changelog sections stand.

## Closing keywords: put them where the COMMIT can see them

`Closes #N` in a pull request body does nothing on a PR **into the RC**, and is the whole mechanism
on the **promotion** PR. The difference is the base branch, and conflating the two is what made this
section wrong until #192:

| PR base | does the description link issues? |
|---|---|
| `v*-rc*` — every feature PR | **No.** GitHub links closing keywords only for the default branch, so the body is inert and the keyword has to reach the commit. Everything below applies. |
| `main` — the promotion | **Yes, and it is the mechanism.** GitHub links them when the body is *saved*, before any merge and with nothing to remember at the click. |

Measured on the v2026.9.0 promotion (#185): twenty-five issues were listed to close, the squash box
was **not** cleared — its body is 3,915 lines of un-replaced commit messages carrying exactly four
closing keywords — and all twenty-five closed anyway, **twenty-one of them on the description
alone**. So on the promotion the description is the mechanism and the squash box is the redundancy,
not the other way round.

It only works **un-fenced**. GitHub does not read closing keywords inside a code fence: `totalCount`
was 0 while the block was fenced and 25 after un-fencing, with promotion #32 (one bare `Closes`, one
linked issue) as the control. A fenced block and an un-fenced one are byte-identical to every other
gate we run, which is why `desktop/scripts/check-promotion-closes.mjs` exists (#192).

For a PR into the RC, the rest of this section stands. `gh pr merge --squash` builds the squash
message from GitHub's default — the PR title plus a bullet per commit carrying that commit's **whole
message, body and all** — or from exactly the text you pass with `--body`. The PR body never reaches
it. Three merges on the 2026.9.0 RC proved it the hard way: one kept its keyword only because the
merger happened to retype it into `--body`, and two lost theirs, so shipped fixes were left looking
unfinished.

**And it fires in the other direction too.** GitHub reads no context, so a keyword anywhere in a
commit message closes that issue — including inside ordinary prose. This RC closes one issue purely
by accident, from the sentence *"the comment says whoever **fixes #161** deletes the skip"* buried in
a commit body. On a crew that writes thorough commit messages that is a live foot-gun both ways: we
nearly lost a close we wanted and got one we never asked for. Write `issue #161` or `for #161` when
you mean to reference rather than close.

So, per merge:

```sh
gh pr merge <n> --squash --body "… Closes #N."
git show -s --format=%B <merge-sha> | grep -c Closes     # verify in the COMMIT, not the PR
```

And note **when** the keyword fires: GitHub auto-closes only from the **default branch**, so a
keyword merged into a `v*-rc*` branch does nothing until that commit reaches `main` at promotion.
That is the behaviour you want — the issue closes when the fix actually ships — but it means a
missing keyword is invisible for the whole RC and only bites at promotion.

**Recovering a keyword you already lost:** do not force-push an amended commit onto a shared RC to
fix bookkeeping — that trades a wrong list for a rewritten history everyone has already pulled. Put
the missing `Closes #N` lines in the **promotion PR's** own squash body instead; they fire from
`main` exactly the same way.

## Cutting a release (maintainer)

0. **Put every closing keyword in the promotion PR's DESCRIPTION, un-fenced.** A plain list, not a
   code fence — that is what actually closes the issues, and it needs nothing of you at the click.
   Pasting the same block into the squash body as well is *also fine and not required*: it buys a
   readable commit message on `main`, not the closes. List **every** issue the RC fixes, not only
   the ones missing a keyword today: the keywords an RC already has live inside individual commit messages, and a
   **squashed** promotion carries none of those messages to `main` (78 of them on 2026.9.0), so they
   evaporate. The whole list is the only form that is correct under a squash *and* a merge commit,
   and a redundant `Closes` is a no-op.

   **The list itself lives on an issue, not in this file.** For 2026.9.0 that is
   [#168](https://github.com/Derpimort/mew/issues/168), kept current by whoever holds the RC; a new
   cycle opens its own checklist issue and this step points at that one. The reason is not filing
   preference: the list **moved twice in two ticks** while this paragraph was being written (sixteen
   → seventeen when an audit found a missed fix, and an open audit could have moved it again). A
   moving list inside a durable doc is wrong between edits, and two copies means nobody can say which
   is canonical. So this file carries the **rule and the check**, which do not move; the issue carries
   the **list**, which does — and the owner meets the issue at promotion anyway, where it survives
   scrolling.

   **The block has two kinds of line, and the issue labels them.** Most are **fixes that shipped in
   this RC** — their issues close because the work is done. One is a **working artefact consumed by
   the promotion itself**, the checklist issue the owner is pasting from, which finishes at the moment
   the promotion lands and nowhere else:

   ```
   Closes #168   (the promotion checklist itself — consumed by this promotion, not a fix)
   ```

   Same mechanism, different claim. The trailing comment is inert to GitHub — the keyword matches
   wherever it sits in the line — and it keeps *"how many fixes did this RC close"* answerable from
   the block. That line is also the one kind the method below **cannot** produce, so it is added by
   hand: no commit mentions the checklist issue, because the promotion is what finishes it.

   **Build the list by subtraction, not from memory.** The first pass at this block was assembled
   by reading the merge log and it missed `#149` — a fix that shipped in `75501a2`, mentioned in
   that commit's subject, and simply not noticed. Intersect instead:

   ```sh
   git log --format=%B origin/main..origin/<rc branch> | grep -oE '#[0-9]+' | tr -d '#' | sort -u > /tmp/ref
   gh issue list --state open --limit 200 --json number --jq '.[].number' | sort -u > /tmp/open
   comm -12 /tmp/ref /tmp/open      # every open issue this RC touched — the candidates
   ```

   (Both sides use plain `sort -u`: `comm` compares lexically, so a `sort -n` on one side makes it
   report the files as unsorted and silently drop rows.)

   Then justify each candidate OUT of the list, **in writing, on the issue**: an issue stays open on
   purpose when it is slice-style with slices still open, when the RC only referenced it, or when the
   owner is still deciding. That direction cannot lose a fix by inattention; reading the log for
   things to add can, and did. The written exclusions are the half that makes the list checkable —
   a number nobody can audit is just a claim, while a named exclusion can be disagreed with.

   **Check it BEFORE the click — that is the advantage of this path.** The link set is readable on
   the still-open PR, so a fenced or short block is fixable while it costs nothing:

   ```sh
   gh api repos/Derpimort/mew/pulls/<n> --jq .body > /tmp/body.md
   gh api graphql -f query='query{repository(owner:"Derpimort",name:"mew"){
     pullRequest(number:<n>){closingIssuesReferences(first:100){nodes{number}}}}}' \
     --jq '[.data.repository.pullRequest.closingIssuesReferences.nodes[].number]|join(",")'
   node desktop/scripts/check-promotion-closes.mjs /tmp/body.md --linked <that list>
   ```

   It fails on the **difference**, not on zero: a fenced block, an issue GitHub has not linked, and
   one linked that the body never claimed each name themselves. A promotion whose description closes
   **nothing** fails too, rather than passing on an empty set. Read the exit code from the command —
   through a pipe you get the pipe's.

   **Do not count lines.** `grep -c "Closes #"` read 3 on the v2026.9.0 promotion commit, `grep -c
   "^Closes #"` read 2, and the truth was 4: keywords appear at line start, mid-prose (*"… Closes
   #139 — the second of …"*) and lowercase (*"fixes #161"*). Compare the **set** against the
   checklist issue's block, never a count:

   ```sh
   git log -1 --format=%B <the promotion commit on main> \
     | grep -oiE '\b(clos(e|es|ed)|fix(es|ed)?|resolve[sd]?) #[0-9]+' \
     | grep -oE '[0-9]+' | sort -un
   ```

   If something is short, nothing about the code is affected — the remaining issues just need
   closing by hand.
1. **Move `[Unreleased]` into a version.** In `CHANGELOG.md`, rename the `[Unreleased]` heading
   to the new version with today's date (`## [2026.9.0] — 2026-09-18`), then open a fresh empty
   `[Unreleased]` above it. Update the link-reference block at the bottom: add the new version's
   `compare` link and re-point `[Unreleased]` to `vYYYY.M.PATCH...HEAD`.
2. **Bump the shell version to the clean `YYYY.M.PATCH`** in the promotion PR, before any tag:
   `version` in `desktop/src-tauri/tauri.conf.json` and in `desktop/package.json` (strip the
   `-rc.N`). `bundle.windows.wix.version` was set at the RC cut and stays. Then
   `node desktop/scripts/check-release-version.mjs --promotion` must pass — the installers and
   the updater manifest are stamped from the config, not the tag.
3. **Tag and push** (the tag must equal the config; `--tag` re-checks it before building):
   ```sh
   git tag v2026.9.0
   git push origin v2026.9.0
   ```
   The tag triggers the `release` matrix (installers + updater manifest into a draft) and the
   live model-contract `smoke` job.
4. **Set the GitHub Release description.** CI names the release `MEW vYYYY.M.PATCH`. Paste that
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
