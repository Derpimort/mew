# Changelog

All notable changes to MEW are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and MEW's desktop builds adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Voice stays positive by design: this log names what MEW gained and what it learned to do better — never what you failed to do.

Versions track the desktop shell (`desktop/tauri.conf.json`); the web app ships from the
same tree (`app/dist`, dockerized) and rides the same notes. How releases are cut lives in
[`.github/RELEASES.md`](.github/RELEASES.md).

## [Unreleased]

## [0.4.0] — 2026-07-15

### Added

- Claude Sonnet 5 and GPT-5.6 join the model picker, and Sonnet 5 is the new default —
  near-Opus quality at a fraction of the price.
- Settings that are principles, not preferences, now wear a small padlock inside the toggle
  knob — with a tooltip that says, in plain words, why each one is welded on.

### Changed

- The Calendars card breathes: calendars carry their real names (your account address, never a
  generic "Primary"), the visibility chips and buttons grew into their labels, and the
  "what this calendar sees" preview now shows exactly what sync will send — events that came
  *in* from your calendars are counted on their own honest line instead.
- A fresh profile starts with no demo calendars — the connections you make are the only ones
  you see.

### Fixed

- Calendar sync heals itself. Blocks imported from a calendar you later removed are adopted
  back as MEW's own and flow out to your connected calendar again; events you delete on the
  calendar itself are noticed on the next sync and re-created from your week. Your plan in
  MEW stays the source of truth — no more items that exist in MEW but silently never reach
  Google.
- A sync update racing a remote deletion recovers by re-creating the event instead of
  stopping the whole run.
- "Show the plan first" speaks each Claude generation's thinking dialect (adaptive on 4.6+
  and the 5s, explicit budget before that) — reasoning turns no longer fail over silently on
  current models.
- Dial callouts never clip at the face's edge. At rest a long task trims tidily into the room
  it has; on hover or keyboard focus the full title wraps into stacked lines — nudging inward
  at 3 and 9 o'clock where the edge is tight — so the reveal actually reads.

## [0.3.0] — 2026-07-14

### Added

- Ask MEW about past weeks — "how much time did gym take last week" answers with real sums
  from your own history, with or without a brain connected (#251).
- Clickable choices in chat: when MEW asks which block you mean or offers options, it shows
  them as buttons you tap instead of typing — one surface for both its questions and its
  suggestions (#254).
- Notification click-to-focus: clicking a nudge toast brings MEW to the front and lands you on
  that nudge (#216).

### Changed

- The model layer now runs on the Vercel AI SDK — Ollama joins Anthropic and OpenAI through one
  unified adapter, the hand-rolled provider code is retired, and model failures explain
  themselves honestly per failure class (a rejected key points at Settings, a busy model reads
  "busy" only when a retry truly ran). Anthropic prompt caching trims cost and latency on the
  stable prompt prefix, and long tool chains end gracefully instead of stopping mid-step
  (#152, #153).
- Long chat histories stay fast: the session log renders the newest messages and pages older
  ones in on scroll ("· earlier ·"), boot hydrates only the newest page, and a streaming reply
  no longer re-renders history — typing stays smooth on months-old profiles. Old conversations
  condense into durable brain facts so the raw log can be pruned without losing what it meant
  (#255, #250).
- The built-in brain's state is visible end-to-end: Settings shows connected / starting /
  unavailable truthfully (sidecar included), and when the brain is off MEW says so plainly
  instead of implying recall ran. On connect it backfills recent history so past sessions
  become recallable, and a recall that times out reads as "didn't answer," never as empty
  (#252, #249).
- Pattern insights are presented as what they are — on-device analyses of your own history —
  and "brain recall" language is reserved for the brain (#252).

### CI / build

- The dial's keyboard-accessibility contract (arrow-key navigation, roving focus) now gates
  every release promotion, with failure screenshots shipped as artifacts (#256; resolves #253
  — the dial was never broken, the old check raced its own read).
- macOS joins the desktop release matrix, so the app + its bundled brain build for macOS
  alongside Linux and Windows (#249).

### Dependencies

- Routine refresh across the tree (Tauri toolchain, Vite, Dexie, lucide-react, tailwind,
  typescript-eslint, and a tauri-plugin-oauth security bump), and the motion family is pinned
  to the vendor chunk after its 12.41 re-export change moved code between bundles.

## [0.2.1] — 2026-07-09

### Changed

- The companion is now a serene static orb — it still wears mood (color), attention (glow) and
  rest (a gentle dim), with mood shifts easing smoothly; the always-on WebGL aurora and blob
  loops are gone, so typing stays cool and quiet and ~880 kB of three.js never ships (#231).
- Typing in the chat composer is calm: focus reads through the caret and a soft border lift —
  the thick focus ring (both of them: the card's and the app-wide one that out-specificed the
  composer's quiet styling) no longer paints (#231).

### Fixed

- The focus dial's inner ring sits further out, so the centre readout — countdown, meta and
  even long wrapped titles — always clears the drawn ring, and the dial's two rings sit closer
  for a fuller face (#232).
- The UI overlap gate now also proves the dial's centre text stays inside the drawn inner ring
  (and that the check itself engaged), so this class of overlap can't ship again (#232).

## [0.2.0] — 2026-06-25

### Added

- Accessibility, WCAG 2.2: the focus dial speaks ARIA and is fully keyboard-drivable; the chat
  announces MEW's replies via aria-live; focus moves predictably with visible rings throughout.
- Drag a block to reschedule it directly on the dial.
- A first-run onboarding flow that introduces MEW's positive, completion-only model.
- In-app API-key setup, so a key can be added without leaving the app (and still never leaves
  the device).
- Undo for AI actions — reverse a tool-driven change to the week in one step (#162, #213).
- Recurring blocks via RFC 5545 (rrule) (#159, #214).
- Native OS notifications for upcoming focus blocks.
- A command palette with global search and quick-capture (#215).

### Changed

- Lazy-load three.js: the main bundle drops from ~658KB to ~371KB, so first paint is quicker.
- Pet White theme tuned to meet AA contrast.
- README now links to the changelog under *Run it*.

### Security

- Tightened Content-Security-Policy on web and desktop (#198).
- A standing test asserts API keys never leave the device.
- Signed self-updater artifacts; `SECURITY.md` and a `security.txt` for responsible
  disclosure (#189).
- Dependabot plus a dependency-audit gate.

### Developer experience & infrastructure

- Two-tier gitflow CI: a fast typecheck + unit + lint gate on every PR, with the heavy
  build/e2e/Lighthouse/UI-overlap/audit suites gated to develop→main release promotions.
- Full-tree ESLint + Prettier are now a hard gate; husky pre-commit mirrors it.
- Playwright end-to-end smoke tests and Lighthouse CI.
- A bundle-size budget and vitest coverage thresholds.
- A structured logger replacing ad-hoc logging; Dexie schema migrated to v3.
- CONTRIBUTING and CODE_OF_CONDUCT guides (#197).
- Release notes: this `CHANGELOG.md` (Keep a Changelog format) seeded with v0.1.7–v0.1.9,
  plus [`.github/RELEASES.md`](.github/RELEASES.md) documenting how desktop and web releases
  are cut, and a maintainer hook to feed the `[Unreleased]` entry into each GitHub Release.

## [0.1.9] — 2026-06-19

### Added

- Unified model layer on the Vercel AI SDK: one `aiAdapter` serving both Anthropic and OpenAI
  behind `ModelPort`, so every provider speaks the same tool registry and the keyless
  deterministic parser floor stays intact (#151, #156).
- Live model-contract smoke gate in CI: hits the real provider APIs on release tags to catch
  request-shape drift (the kind of wrong parameter that mocked unit tests pass right over),
  and skips cleanly with a logged notice when no key secret is present (#149).

### Changed

- Per-provider adapter contract centralized, with default-config assertions guarding each
  provider's shipped request shape (#149).
- Dial polish from the image-#7 review: a larger, more visible inner ring, AM band that reads
  as filled, the full event title on hover, and a word-break fix for long titles (#155).
- Desktop shell bumped to 0.1.9 (#157).

## [0.1.8] — 2026-06-18

### Changed

- Focus dial redrawn as two rings (PM outer, AM inner) with a ring-aligned fill and a bottom
  readout, so today reads at a glance (#147).
- Honest model-failure copy: when a turn can't complete, MEW says so plainly instead of
  pretending it worked (#147).

### Fixed

- CI now guards the PR check against filename case-collisions — two paths that differ only in
  case coexist on case-sensitive Linux but collide on Windows, the class of break that hit the
  v0.1.7 release (#146).

## [0.1.7] — 2026-06-17

### Added

- Cancellable turns: a stop control (■ / Esc) while MEW is working, with the `AbortController`
  threaded through both the Anthropic and OpenAI adapters so cancelling actually stops the
  in-flight request (#136, #141).
- Transient-error resilience: model adapters retry with backoff on 429 / 5xx / network errors,
  wired through both providers for parity (#123, #134).
- Sanitized markdown rendering for MEW's replies — a safe subset, with MEW told it may use
  light markdown (the stale "literal asterisks" claim is gone) (#124, #133).
- Week-view side hover preview: a mini focus-clock with name and time that auto-sides so it
  never covers your blocks (#121).
- Self-hosted fonts plus a customizable interface-font setting, with tightened typography (#126).
- Error boundaries around the chat and stage panels so one failure can't take the view down (#125).
- Day-shaping help: a pacing rest auto-inserted into a long continuous work run (#111).

### Changed

- Chat turn UX overhaul: typing indicator, live working status, sticky / snap-to-stream
  scrolling, and a more robust composer (#128, #142).
- Scheduling honors explicit times — place first, then offer drift — ending the per-clash
  reactive loop (#107).
- Dial readout restacked: date over time, centred, with the time as the hero; legible on hover
  and clear of events (#106, #109).
- Overnight blocks lane by their drawn arc rather than raw end-minute, and cross-midnight blocks
  clip to today's wedge with a continuation cue (#108, #137).
- Dial AM/PM bands tiered by commitment: confirmed inside, background and rest outside (#135).
- `remove_blocks` drops the named block and asks before touching other same-titled blocks,
  rather than nuking them all (#110).
- Event nudges deferred until the assistant turn completes, and the loose-threads box stays
  open when a row acts (#113, #127).

### Fixed

- Renamed `markdown.ts` → `markdownParser.ts` to clear a Windows case-collision that broke the
  release build (#144).
- "Update later" no longer silently restores a backup; the retime `startMin` is now `const` (#138).

[Unreleased]: https://github.com/Derpimort/mew/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Derpimort/mew/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/Derpimort/mew/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Derpimort/mew/compare/v0.1.9...v0.2.0
[0.1.9]: https://github.com/Derpimort/mew/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/Derpimort/mew/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/Derpimort/mew/compare/v0.1.6...v0.1.7
