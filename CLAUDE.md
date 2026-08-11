# CLAUDE.md

Claude Code (and other agents): the operating manual for this repo is **[AGENTS.md](AGENTS.md)** —
the dev loop, the merge bar, multi-lane orchestration, the release gitflow, the product laws, and
the gbrain vision. Read it before contributing.

Setup + gates: **[CONTRIBUTING.md](CONTRIBUTING.md)**. Locked product laws: **[HANDOFF.md](HANDOFF.md)** (*Product laws*, under Key facts / gotchas).

Fast reminders (the traps that bit us):

- Merge feature PRs into the active `v*-rc` yourself (`gh pr merge --squash`, **never** `--admin`); `main` is the owner's click. (Assumes write access — on a fork, open the PR and a maintainer merges.)
- In the promotion PR, bump `desktop/src-tauri/tauri.conf.json` to the clean release version (from `-rc`) and add the CHANGELOG section **before** tagging — tauri stamps installers from the config, not the tag. Guarded by `desktop/scripts/check-release-version.mjs`.
- Every feature is offer-then-confirm — human-in-the-loop, never autonomous.
- Keep shell commands simple; re-check GitHub before reporting (the owner may have acted between turns).
