# Changelog

All notable changes to MEW are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and MEW's desktop builds use [Calendar Versioning](https://calver.org/) — `YYYY.M.PATCH`, a valid
[semver](https://semver.org/spec/v2.0.0.html) so the updater keeps ordering releases — from 2026.9.0
on (releases up to 0.7.0 used SemVer). The scheme is spelled out in [`.github/RELEASES.md`](.github/RELEASES.md).
Voice stays positive by design: this log names what MEW gained and what it learned to do better — never what you failed to do.

Versions track the desktop shell (`desktop/src-tauri/tauri.conf.json`); the web app ships from the
same tree (`app/dist`, dockerized) and rides the same notes. How releases are cut lives in
[`.github/RELEASES.md`](.github/RELEASES.md).

## [Unreleased]

### The dial on any day
- The Focus dial shows any day, not just today: step through the days from the date line above the
  clock and see that day's blocks on the same calm face — a lived day wears its full wash, a day
  ahead stays clear, and the centre names the day with its blocks, committed hours and mews. One
  click brings you back to today, where the live countdown belongs, and a day picked in Week carries
  across. On a lived day the card keeps Done, Hold and Remove; a day ahead keeps Hold and Remove, so
  a mew is only ever counted once it's done.
- The date above the dial opens a day picker: a small month calendar that lands on the day you're
  viewing, with today marked. Pick with a click or from the keyboard alone — arrows move by day and
  week, Page Up and Page Down by month, Enter shows the day — and Escape simply closes the calendar,
  leaving the dial exactly as it was.
- The day-progress wash now holds when half the day is complete: the morning disk stays filled from
  noon on, and a lived day shows its whole wash.

### Toward dragging on the dial
- The Focus dial can now read any point on its face back as a time of day, to the minute, on either
  half of the clock, and a drop there lands on the same five-minute grid the week uses. It's the
  groundwork for sliding a block around the clock; nothing on screen changes yet.

### All-day entries are labels on the day
- Holidays, time off and birthdays now arrive from Google and ICS calendars as all-day entries, a
  fact about the day rather than a 0:00–23:59 block on it; a span covers every day it names.
- The Week shows them on a strip above 0:00 — one continuous chip for a Monday-to-Wednesday
  out-of-office, packed neatly when several share a day.
- The Focus dial shows today's all-day entries as pill badges above the centre; a holiday labels the
  day and never becomes a wedge or takes the countdown.

### The evening exists
- MEW now plans inside the hours you actually keep: placement, suggestions and free-slot searches
  read your **plannable hours** rather than stopping at 18:30, and when nothing fits inside them MEW
  says so plainly and names the free time past them. Its own morning scaffold and the weekly ritual
  keep the classic day.
- **Plannable hours** have their own row in Settings → Nudges & notifications, independent of quiet
  hours: two 24h fields on a five-minute grid, steppable from the keyboard and named for screen
  readers.
- Auto-placement lands on human times: a slot asked for at 10:07 opens at 10:30, or at the next
  quarter that still fits, and every placement path stays on the five-minute grid. Times you name
  yourself are kept exactly.
- A time MEW picks for you is always still ahead of you. When what you ask for no longer fits in
  today's hours, MEW says so, names the free time past them and offers tomorrow's first opening as
  a choice, and a breather is only ever tucked into time still to come.
- Say "tonight", "this evening" or "after dinner" and MEW places it in the evening: from 18:30,
  inside your plannable hours, and after your dinner when you said so. The title keeps only the
  task, and when the evening is full MEW offers tomorrow evening.

### Placing from your inbox leaves a receipt
- When you place something from your inbox or the loose-threads rail, the conversation now shows its
  receipt like any other placement, and "undo that" right after takes the block back and returns
  the item to your inbox. Where it lands is exactly as before.

### Your stated lengths hold through the plan picker
- A length you say in your own words ("block 90 min for the quarterly report") now stays exactly
  that length when you pick a plan from the picker. MEW only offers to give room to the blocks you
  didn't size yourself, and a plan it re-offers after the week moved keeps the lengths it already
  showed you.
- Asking again for a block you already have ("block 30 min for a walk") moves it at the length you
  said, into a slot that fits that length, so it never lands over the next block. Without a length it
  keeps its own.

### The room offer says what it would change
- When MEW offers to give your work more room, it now names the blocks it would resize ("(inbox
  sweep, errands)") and calls the kind what it is: hour-plus work. The count that comes with a new
  block uses the same words ("That's your 2nd hour-plus work block this week"), so a routine inbox
  sweep isn't called a deep-work block one message before the offer. "Give them room" changes
  exactly the blocks it named, and the confirmation names them too.

### Overlap on your say-so
- Tell MEW an overlap is fine ("put the email sweep at 2, it's fine to overlap gaming") and it
  places the block exactly there, leaves your flexible block where it is, and says the two share
  that time. Meetings, calls and calendar events are still never covered: MEW names them and asks
  for another time.

### Split a block around a meeting
- Say "split the deck around the 1pm call" (or give the time, "around 13:00-13:45") and the block
  becomes two with that time free between them, keeping its whole length: the first part ends as
  the call starts and part 2 picks up when it ends. A calendar event is never split itself, a
  repeating block asks this one, the ones after or the whole series first, and part 2 lands only
  where it fits: a fixed or protected block there leaves everything as it is, and MEW names it.
- The "split around it" choice MEW offers when a meeting lands on your work now runs the same
  split, and part 2 keeps the block's own flexibility.
- A split choice picked after midnight checks its day first, like every other choice: one named for
  a weekday ("… on thursday") still splits that day's block, and one for "today" leaves everything
  as it is and says when it was offered.

### Merge two blocks into one
- Say "merge my two deck blocks" (or "join the writing blocks tomorrow") and MEW joins them into one
  block, from the first start to the last end, and one "undo that" brings both back. MEW merges
  only your own blocks with the same tag, across free time: when a call, a calendar event, a done
  block or any other block sits between them, MEW names it and everything stays as it is, and
  calendar events, done blocks, repeating blocks and blocks with different tags keep their shape.
  Two different blocks that share a word ("Deck polish" and "Deck review") stay as they are too,
  and MEW names both, so a merged block never loses one of its names.
- A block you split merges back: "merge my two deck polish blocks" joins Deck polish and Deck
  polish (part 2) into one Deck polish again. While the meeting you split around still sits between
  them, MEW names it and both pieces stay.

### Change several blocks at once, with a yes first
- Say "push everything after 3pm back an hour" or "move all of today's work to tomorrow" and MEW
  lines it up in one go. When it touches three or more blocks, or moves anything to another day,
  MEW first shows the day, exactly which blocks move where, which stay put and what they would share
  time with, and nothing changes until you say yes. Your yes moves exactly that list: if the week
  changes first, MEW shows you the new one. One "undo that" puts them all back. Calendar events,
  fixed calls and done blocks keep their place, and so does any block whose new time would sit over
  one.
- Retag a set of blocks the same way: "tag all of tomorrow's calls as work" shows the list first and
  changes only the tags, never a time. Calendar events and done blocks keep their tags. "Between 2
  and 5pm" picks the blocks that start in that window, for any of these changes.
- A repeating block is asked about rather than assumed: a change that reaches one asks which
  occurrences you mean — just this one, this and the ones after, or the whole series — and nothing
  moves until you answer, not even the one-off blocks beside it. Your answer travels with your yes,
  so confirming acts instead of asking again. Moving a run onto a single day is the one thing it
  won't do, since a series keeps its own days: there, "just this one" moves that occurrence and the
  rest stay where they are.

### A real choice when a block can't make way
- When new work lands on one of your own flexible blocks and that block has nowhere clean to go, MEW
  now asks with up to three tappable choices: move the work to its next clean slot, drop the
  flexible block, or keep both. Nothing moves until you pick, and every choice does exactly what it
  says, with or without a model key.

### The drop choice names its day
- When a block can't make way and MEW offers to drop it, that choice now names the day ("remove the
  Groceries today at 14:00"). So it shows up even when the same block sits at the same time on
  another day, and picking it removes only the one you're looking at. A drop picked on a later day
  (after midnight, "today" is a new day) checks again first: it runs only while it still points at
  the block it was offered for, and otherwise MEW names that block and everything stays as it is.

### Removing one block removes one block
- "Remove the lunch at 12:00" now takes off exactly one Lunch. When the same block sits at the same
  time on several days, MEW asks which day with tappable choices ("today 12:00", "thursday 12:00")
  and changes nothing until you pick. Naming the day ("remove the lunch on thursday at 12:00") goes
  straight to that one, and "all" still means all.
- The question names its all-choice in the choice's own words: "both" for two blocks, "all of
  them" for three or more.
- Answer that question in words too: typing "all of them", "both", "the thursday one" or a choice's
  own label does exactly what tapping that choice does, and never lands in your inbox. A count that
  doesn't fit — "both" when three are ahead — changes nothing and asks again, choices and all, so the
  next word you say still lands.

### Say the day your way when removing
- "Remove the lunch this thursday", "remove thursday's lunch" and "remove the lunch next thursday at
  12:00" now find the block. The day phrase is read as the day, so only the title is looked up, and
  when the same time repeats across days MEW still asks which with day choices.

### Undo takes back what MEW just did
- Say "undo that" right after MEW changes your week (something you typed, asked a connected model
  for, or picked from a choice) and that change comes back: a moved block returns, a split block is
  whole again, a removed lunch is back. It works without a connected model too, and "undo that"
  never lands in your inbox as a thought. Undo takes back the latest change, in your very next
  message.
- And MEW now tells you what it put back, in the words of the thing that changed: a block that moved
  goes back where it was, a length you changed comes back as a length, a name as a name, and a tag as
  a tag. Tagging a few blocks and taking it back reads "put two tags back" — never "back where they
  were", for blocks that never moved.

### Ask about any stretch of time
- Ask MEW about any stretch of your history, not just one week: "since August 1", "the last three
  weeks", "this month", "in March", "between Aug 3 and Aug 17" or "yesterday" all answer with real
  sums from your own blocks, on this device, with or without the brain connected. A very long
  stretch is answered for its most recent year, and "last week" reads just as before.

### What you tell MEW sticks
- A standing rule you tell MEW while its brain is away keeps applying once the brain is back, and
  MEW passes it along to the brain exactly once. A rule you forget stays forgotten with the brain
  on. And "what I've picked up about you" now shows your rhythm by energy: where your deep work,
  admin and health blocks actually get finished.

### Rules from your brain are yours to see and let go
- The memory console now lists every standing rule MEW applies, including ones that live only in
  your brain (told on another device, or seeded there), each with a quiet "from your brain" mark.
  Forget works on them like any other rule, and it sticks. With the brain off, the list is exactly
  what's on this device.

### The loose-threads rail holds your own work
- The rail beside your week lists your own loose ends only: once its time has passed, a lunch or a
  breather MEW placed for you never turns up there as something that slipped, waiting for you to
  tick it off or pick it back up. A meal you asked for yourself still does.

### The weekly review's roll really moves your work
- Rolling carried work forward now moves it: the block lands on the same weekday next week and
  leaves this week's carried list, so it's never offered twice, and one "undo that" brings the whole
  roll back. A repeating block rides with its own series instead of doubling, a block already
  planned next week stays exactly where it is, and a day with no room keeps the work carried and
  says so.
- The review offers only your own unfinished work to roll: the breathers MEW tucks in for pacing and
  the meals it places for you stay out of the list, since next week gets its own. A meal or a rest
  you asked for yourself still rolls.
- The evening's close-the-loop works the same way: a lunch or dinner MEW placed for you never counts
  as unfinished work, so it doesn't keep your day from clearing and MEW never offers to move it to
  tomorrow. A meal you named yourself still does.

### Midnight means the same day to every part of a turn
- In the first seconds after midnight, "remove the Groceries on thursday" removes Thursday's
  Groceries. Each turn, typed or tapped, now starts from one clock, so the words you use, the choice
  checks, the tools that act and the model's view of your week all agree on what today is.

### Type what a choice says, or tap it — either way it does the same thing
- The question MEW asks when several blocks share a name now reads exactly what its choices read:
  "2 'lunch' blocks ahead — tomorrow 12:00 or thursday 12:00?" instead of describing them in words
  the choices did not carry. Each choice names its day whenever the blocks sit on different days, so
  you can tell which one you are answering about, and typing any of those words works.
- And typed the way you would say it: when MEW asks which of two blocks you mean, the answer can be
  the time on its own — the same words the question used — or the choice without the day it carries
  in brackets. If the words fit more than one choice, MEW asks again rather than guessing.
- Whatever MEW puts on screen as choices, typing one of them word for word now does exactly what
  tapping it does: "roll to tomorrow" when a meeting lands on your work, "tomorrow 9:15" when today
  has no room left, "do it" on a change MEW is about to make, "just this one" when a repeating block
  is split. Before, only a remove question read typed answers; elsewhere the words on screen did
  nothing, and some of them quietly became thoughts in your inbox. A typed choice goes through the
  same checks as a tap, so one offered yesterday still says so instead of acting on the wrong day,
  and it only counts while those choices are still live and the words are the whole message.

### Every choice keeps the day it was offered
- The one-tap choices MEW offers (shift, split or roll around a meeting, trim a heavy day, shift new
  work to its next clean slot, pick which of two same-named blocks you meant, or apply an edit to
  just this one of a repeating block) keep the day they were offered. Picked after midnight, a
  choice checks first: it acts while it still reaches the same block on the same day and time, and
  otherwise MEW says which day it was offered on and everything stays as it is. A choice named for a
  weekday ("move it to thursday") keeps working the next day.

### Recurring events keep their own clock
- Weekly and fortnightly ICS series now walk their event's own time zone, so "every Monday 09:00"
  stays a Monday wherever you are, a clock-change night never doubles an occurrence, and a date-only
  UNTIL keeps the series' last day.

### Straight talk when a reply drops
- When the connection to the model drops after a reply has begun, MEW names it for what it is — "the
  connection to the model hiccuped" — and answers the turn itself. Whatever already streamed stays
  exactly as it arrived, and nothing is sent twice behind your back.

### Replies written for you
- Every reply MEW speaks without a connected model is written for you alone: a captured thought
  reads just `Captured "call the bank".`, and an overlap a batch change leaves names the block and
  that it's flexible. A connected model still gets its own guidance behind the scenes.

### Each rest gets its one gentle ask
- When work is set to run over a walk, a lunch or an evening off, MEW asks once about that rest
  and remembers it, across a restart too. A second rest that day still gets its own ask, even
  while the first one's question stands, and tomorrow starts fresh.
- When you place work over a rest, the reply names the time it runs over ("it runs over your
  evening walk 18:00–18:45"), so a rest you chose to keep is never covered without a word. The
  rest stays where it is.
- Moving several blocks at once, changing a block and copying one say it the same way: work that
  lands on a protected rest names that rest ("it runs over your evening walk"), and only a truly
  flexible block is called flexible.

### Versioning by the calendar
- MEW's desktop now names its releases by the calendar: `YYYY.M.PATCH`, so this cycle ships as
  `2026.9.0` from the `v2026.09-rc1` branch. The Windows installer carries the matching MSI-safe
  `26.9.0`, and the release guard checks the shape, the MSI mapping and the tag before any build or
  tag — documented in `.github/RELEASES.md`.
- The release guard now names a tag exactly as it was given, and when a tag and the config disagree
  it spells out both ways forward: re-tag from the config, or bump the config (and the MSI version)
  to the tag. It also runs as its own workflow, so a desktop-only change no longer waits on the
  app's typecheck, tests and lint.

### A bundle budget every PR can see
- The size budgets now run on every PR into `develop` and the release candidate: the quick gate
  builds the app and checks each chunk against its ceiling, so a heavier download shows up on the PR
  that caused it, long before release day.

### Screenshots that hold on any weekday
- The canonical screenshot gate now runs on one pinned calendar day, so it passes the same way on a
  Monday as on a Wednesday, and the canon screenshots regenerate identically whenever it runs.
  `SHOOT_DATE` probes another day when you want to look.
- The day view, day picker and all-day proofs run on that same pinned day too, and keep passing on
  whatever date `SHOOT_DATE` probes — month ends and a four-week February included.

### Feature proofs that run again
- The desktop self-update, desktop backup and restore, loose-threads rail, and Google sign-in proofs
  run green again with no API key, on the same pinned day and shared harness as the canon gate.
  Their screenshots are current, and the Google sign-in proof runs fully offline.

### Under the hood
- The two newest things in this release are now held together with everything else: a sweep over a
  repeating run is asked about before anything moves, its list is read back row by row against the
  week, and taking it back says what actually came back — a length, a name or a move, each in its
  own words. Two journeys, each proven to fail if the fix it guards is removed.
- A test that sits outside its group now fails the lint gate instead of running quietly: such a
  test still passes, it just reports without the name that tells you which behaviour broke. The
  check is a small script with no new dependency, so the release's proven set of packages is
  untouched.
- One more detail of a change that spans days is held by tests: when the blocks that STAY put are
  the ones on other days, each still reads with its own day, so the list you approve can be checked
  against your week afterwards.
- Tonight's newest features are now held together, not only one at a time: four journeys run a split
  pair through a batch shift, answer a remove ask in words, retag a day holding a calendar event and
  a repeating block, and take a week MEW helped build through the weekly review — each step checking
  both the week and what MEW said. The one thing they found that reads wrong is filed as #149.
- Two more details of the loose-threads rail are held by tests: a lunch or breather MEW placed for
  you can never be carried forward, so it never turns up in the rail as a follow-up waiting on you,
  and a follow-up you have finished leaves the rail instead of sitting there.
- Six more details of tonight's work are now held by tests: a breather MEW tucks in for pacing
  still reads as flexible, a rest you said never moves reads as fixed, a day holding nothing but
  MEW's own meals never reads as clear, a re-planned lunch keeps the length you said and stays
  inside its window, a block you allowed to share time is judged on that same length, and a reply
  carrying both a note and a question puts the statement first and the question last.
- A reply that ends by asking you something ends with its question mark, never "?.", and a question
  stands as its own sentence after the notes before it.
- Every dependency lockfile is clean of known advisories: vitest 4.1, the post-quantum X-Wing key
  exchange under noble 0.7.1, the current ai-sdk providers and the patched Rust crates — with the
  same wire behaviour as before, held by pinned tests.
- The bundle gate now measures everything MEW loads eagerly — the entry plus the chunks it pulls in
  at start — as one sum against one ceiling, and the gate's own policy tests run in CI, so a heavier
  start can't hide in a side chunk.
- Two quiet details are now held by tests: the day picker keeps the dial's day selected while the
  arrow keys move through the month, and a remembered rule with none of your words shows just where
  it came from.
- MEW opens on about 43 KB less code: the connected-model instructions and the class-merging helper
  used by Settings now load only when those are used, not with every start.
- The check that keeps the connected-model instructions off the start-up path now has the time it
  needs on a busy test runner, so it can only fail for a real reason.
- The release notes guard themselves: a check in CI fails any change that repeats a section or a
  bullet in these notes, so what you read here is written once.
- Three more midnight details are held by tests: a choice picked in the first seconds after
  midnight, before MEW's clock catches up, checks against the new day, a choice that lengthens a
  block checks its day too, and a "done" choice keeps pointing at the block it was offered for even
  once that block is done.
- An item you place from your inbox is saved the way it shows, now held by tests: after a reload its
  block is still in your week, and after "undo that" the item is back in your inbox with no block
  left behind.
- Tonight's changes are now proven together, not only one by one: journey tests walk one week
  through an out-of-office label, an evening plan, a block split around a meeting, lunches removed
  across midnight, the room offer, rolling forward and the dial on a past day. The gaps they found
  are filed, each held by a test that flips when it's fixed.

## [0.7.0] — 2026-08-12

**Calm connections.** The first release cut from the open repo. The connected calendar
stops stealing attention: nothing opens your browser except your own click, a paused sync
says so kindly, and the pixels you see — in the app and in this repo — are the current truth.

### A calmer Google connection
- Silent re-auth never opens the system browser again. When the desktop sign-in expires,
  sync pauses honestly — one kind line in chat, a `sync paused — google needs a fresh
  sign-in` state in Settings — and resumes the moment you click **reconnect**. The browser
  opens only as the direct result of that click.
- Disconnecting a calendar while signed out no longer pops a browser either; the cleanup
  waits politely and the events stay safe on the remote calendar.

### Steadier under the pointer
- A week-grid press now claims the pointer properly: a stray text selection can no longer
  hijack drag-to-reschedule mid-gesture (the drag used to freeze armed), and click-to-focus
  for the keyboard's roving tab stop is preserved.

### The open house
- MEW is open source (MIT). The repo's public face was rebuilt for it: README with live
  screenshots, an agent operating guide (AGENTS.md/CLAUDE.md), and a history scrubbed for
  publication.
- Supply chain trued up: all OSV advisories cleared from the lockfile, the playwright
  toolchain aligned end to end, Rust security patches landed, and the CI gates run green
  from a cold public clone — keylessly.
- The screenshot canon is current-UI only: the living set regenerates deterministically,
  the sync-pause state is pinned visually in the gate, and every retired shot left the tree.

## [0.6.0] — 2026-07-18

**gbrain, working.** v0.5 made MEW the daily companion; v0.6 makes the memory earn its keep —
it learns you and stops making you repeat yourself — and grows a full calendar command surface
and a weekly rhythm around it. Every new capability offers first and waits for your yes.

### gbrain, working
- Learns your task rules from repetition and offers once, then remembers forever.
- A confirmed rule resolves the full task spec deterministically on every placement path — keyless too.
- On-device memory is the always-on floor; the brain sidecar self-heals and reports its status honestly.
- A memory console to see — and correct or forget — everything MEW knows about you.

### The weekly rhythm
- Energy-aware scheduling learned from what you actually finish (never a textbook curve); admin batched; your stated rules always win.
- Estimate correction: MEW notices the kinds of work you book short and offers to give them room — one calm voice per placement.
- A weekly review that celebrates your mews and rolls the unfinished flexible work *you pick* into next week.
- Week-scaffolding: MEW drafts next week the way your weeks usually go — a proposal you accept, tweak, or discard, never auto-filled.

### Calendar command surface
- Read-only `list_blocks` — MEW's eyes on the calendar.
- Surgical single-block edits by name + time, and propose-then-confirm deletion of done blocks instead of refusing.
- Recurring-edit scope — just this one / this & following / the whole series.
- Granular ops: resize, duplicate, relative-move.
- Drag-to-reschedule on the week grid — move and edge-resize, routed through the executor.
- Quick-capture inbox: capture intents that hold no time; gbrain offers to place them when a slot fits.
- Conversational context across turns — referents, positional and relative edits, keyless too.

### Calmer under real use
- Meals stay sane when a reshape places them at an explicit time.
- Your own flexible blocks drift out of the way of new explicit work in the same pass.
- A correction is one acknowledgment and one reshape sweep — no flailing.
- The protect-rest nudge reads clean and fires once.

### Under the hood
- Onboarding, the plan picker, Settings, and the inbox lazy-load off the entry chunk.

## [0.5.0] — 2026-07-17

**The daily companion.** v0.3 made MEW smart; v0.4 made it trustworthy; v0.5 makes it the
thing that actually runs your day — desktop-native presence, daily rituals, and an
intelligence layer that earns its keep every morning.

### Added

- **Plan mode.** Braindump a big week and MEW lays out two or three named ways to hold it —
  *protected mornings*, *spread even*, *front-loaded* — as compact mini-week cards you pick
  from. What you pick is exactly what lands: a preview is a quote, never re-guessed.
- **Morning brief & evening wrap.** A three-line brief opens the day (its shape, the first
  block, the one thing to watch); a kind wrap closes it (what got done, what's waiting for
  tomorrow, one thing worth noticing). Once a day, restart-proof, and it never keeps a guilt
  list — rolled work is *waiting*, not failed.
- **Weekly planning ritual.** Sunday evening (or "plan my week" anytime) MEW pulls your
  calendar, asks two or three quick questions, and shapes the week around your meetings using
  your own best hours — through the same picker, so you choose the shape.
- **Rescue my afternoon.** When an inbound meeting lands on planned work, MEW says so and
  offers one-tap chips — *shift*, *split around it*, *roll to tomorrow*. Your meeting never
  moves; MEW's own block does.
- **Fed and paced, without asking.** MEW now knows what a meal is: lunch lands at lunchtime,
  dinner in the evening, a real stretch apart — and each morning it quietly places the meals
  and breathers your day was missing, so you stop re-typing them.
- **System-tray companion.** A state dot, a live tooltip showing your current block, quick
  actions, and closing the window minimizes to the tray — the hourly calendar sync keeps
  running while MEW is hidden.
- **Global quick-capture hotkey.** ⌘/Ctrl+Shift+C from anywhere drops a thought into MEW
  without switching windows; rebinds are shell-validated and a taken key stays kind.
- **Notification actions.** Native nudges carry *Done* and *+15 min*; clicking a nudge lands
  on its card where the same two actions live, so the loop closes on every platform.
- **The insights card.** "What MEW's noticed" surfaces the science it already computes — your
  best deep-work hours, your kindest day, one habit worth keeping — from local memory alone.
- **Meeting buffers.** An optional prep/decompress margin keeps MEW's own blocks off your
  meetings' edges (off by default; your calendar events never move).
- **The day-load meter.** When a day runs past your demonstrated throughput, MEW says so
  kindly at plan time and offers to keep it kind — a meter, never a red bar.
- **Keyboard-first week.** Focus, move, day-hop, and resize blocks entirely from the
  keyboard, through the same executor path as drag.
- **Tool-call activity cards.** Every action MEW takes shows as a small live card in the
  chat — a receipt of what actually changed, replayable on reload.
- **Onboarding v2 — the first five minutes.** A guided first run: paste keys (with test
  buttons), connect your calendar (loopback explained, redirect URIs copyable), then one
  guided "plan today." Every step is skippable and everything works keyless.

### Changed

- **Streaming that's actually alive.** Replies paint word by word as they arrive, and MEW
  shows an honest "thinking it through…" state instead of dead air before the first token.
- **The composer never locks.** Type mid-turn any time — Enter queues your message to send
  when the turn settles, and the stop button becomes *stop & send* when something's waiting.

### Fixed

- **The desktop sign-in page tells the truth.** After connecting your calendar, the loopback
  page is MEW-voiced, closes itself, and brings MEW back — and it no longer claims success
  when you decline consent.

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

[Unreleased]: https://github.com/Derpimort/mew/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/Derpimort/mew/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Derpimort/mew/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Derpimort/mew/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Derpimort/mew/compare/26024e7...v0.4.0
[0.3.0]: https://github.com/Derpimort/mew/compare/v0.2.1...26024e7
[0.2.1]: https://github.com/Derpimort/mew/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Derpimort/mew/compare/v0.1.9...v0.2.0
[0.1.9]: https://github.com/Derpimort/mew/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/Derpimort/mew/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/Derpimort/mew/compare/v0.1.6...v0.1.7
