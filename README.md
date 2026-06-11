# MEW — My Entire Week

An AI companion that runs your week with you — and keeps you well while you run it.

| Where | What |
|---|---|
| `app/` | **The product** — local-first React SPA (MVP per the PRD) |
| `design_handoff_mew_mvp/` | The design handoff (reference; new drops replace this folder wholesale) |
| `ARCHITECTURE.md` | Platform alternatives, the recommendation, the hexagonal core, decision log |
| `IMPLEMENTATION_PLAN.md` | Phases, acceptance-criteria mapping, design-iteration workflow |

## Run it

```sh
cd app
pnpm install
pnpm dev          # → http://localhost:5173
```

First run seeds a lived-in week anchored to today (plus three weeks of memory so MEW
has honest numbers from day one). Talk to it:

> block thursday morning for the deck, keep friday afternoon free

Works with **no API key** (deterministic parser). Add your Anthropic key in
Settings → *Privacy & model* for full natural language (model: `claude-opus-4-8`,
key stays on-device, sent only to the model endpoint), or switch to *Fully local*
for an Ollama endpoint.

## Google Calendar (live two-way sync)

MEW has no server, so it talks to Google as *you* — one-time setup:

1. [Google Cloud Console](https://console.cloud.google.com) → create/pick a project
   → enable the **Google Calendar API**
2. APIs & Services → Credentials → **Create OAuth client ID (Web application)**
   → add your app origin (e.g. `http://localhost:5173`) under *Authorized JavaScript origins*
3. In MEW: Settings → *Calendars* → **+ Connect a calendar** → paste the client ID
   → sign in → pick calendars

Then: your blocks appear on each calendar exactly as its routing-matrix row allows
(real titles, an opaque **Busy**, or nothing — private stays private), and their
events flow into your week tagged by the calendar's default tag. Matrix edits apply
on the next sync (~5 min, or "sync now" in a row's edit panel). MEW-pushed events
carry no reminders — MEW is the notifier. External events are never rolled or moved
by MEW: not ours to move.

## Make targets

`make help` lists everything. The everyday ones:

```sh
make dev          # local vite + HMR          make up       # docker, port 3000
make check        # tests + typecheck         make debug    # docker + HMR, port 5173
make build        # check + production bundle make refresh  # git pull + rebuild + restart
make shoot        # Playwright screenshots    make image    # build the prod image
```

## Docker

Multi-stage `app/Dockerfile`: pnpm-cached deps → **tests + typecheck run inside
the build** (`--build-arg SKIP_CHECKS=1` to skip) → static bundle on
**unprivileged nginx** (non-root, port 8080, read-only rootfs in compose,
`/healthz` endpoint, immutable caching for hashed assets, SPA fallback). The
image is **config-free** — the Anthropic key and Google client ID are entered at
runtime in Settings and never touch the image — so one image deploys anywhere.

nginx ships a strict CSP (`app/docker/security-headers.conf`) enumerating the
app's only legitimate origins (Anthropic API, Google Calendar/Identity, Google
Fonts, localhost Ollama). If you point MEW at a non-localhost Ollama URL, add
that origin to `connect-src`. COOP is `same-origin-allow-popups` — required for
the Google sign-in popup.

## Deploying on an aisquare-ec2-dev box

The repo follows the `bootstrap-docker` contract directly — compose files at the
root, no `container_name`, repo commands in `.aisquare/app.conf`:

```sh
# on the box (SSM session):
git clone https://github.com/<org>/mew.git /opt/app
cd /opt/app
app refresh        # build + start — that's the whole deploy
app debug          # hot-reload build in the foreground
app test           # repo command from .aisquare/app.conf (dockerized, no node needed)
app logs mew       # tail
```

Terraform `services` entry for the stack (MEW publishes host port 3000):

```hcl
services = {
  mew = {
    host_port         = 3000
    host_headers      = [var.app_domain]
    health_check_path = "/healthz"
  }
}
default_service = "mew"
```

Notes:
- Per-dev stacks must not rebind the ALB port: `MEW_PORT=3100 app -p alice up`,
  or reach them via SSM port-forwarding (the debug override binds 5173 only).
- Add the deployed origin (`https://<app_domain>`) to your Google OAuth client's
  *Authorized JavaScript origins* or calendar connect won't open.
- `docker-compose.debug.yml` uses the `!override` YAML tag → needs compose ≥ 2.24.

## The brain (GBrain)

`domain/insights.ts` computes patterns from the append-only memory — follow-through
by time band ("mornings hold 15/15; late afternoons 6/15"), weekday load, chronic
rollers, completion lateness (implied booking correction), drift clusters — and
feeds them to chat context, the keyless floor, and the **concrete kinder-plan
proposer** (real moves, weekdays only, applied only on accept). Overnight
consolidation compacts raw events older than 8 weeks into weekly summaries.
The nudge library is **10 research-validated entries** (citations audited; the
folk "23-minute" figure replaced with the published Mark/González/Harris 2005
finding), and the engine **learns from outcomes**: declining a nudge type
stretches its cooldown up to 3×; accepting restores it.

## Dev tools

```sh
pnpm test         # 86 tests: domain + adapters + full scenario suite
pnpm typecheck    #   (scenario suite simulates whole days through the real store)
pnpm build
pnpm shoot        # Playwright screenshots of the canonical frames → app/shots/
node scripts/journey.mjs   # live conversational journeys (needs OPENAI_API_KEY
                           # or use the in-app Anthropic key) — prints transcript
```

Remote brain is selectable in Settings → *Privacy & model*: **Anthropic**
(`claude-opus-4-8`, streaming agentic loop) or **OpenAI** (BE dev creds path,
same shared tool registry) — plus fully-local Ollama and the keyless floor.

- **`?t=HH:MM`** on any URL shifts the app clock — preview the 9:40 now-line,
  the end-of-day close-the-loop, quiet hours, any moment. (`?t=9:40` is the
  design's canonical frame.)
- `window.__mewReset()` in the console wipes local data and re-seeds.

## Where things live (design-iteration contract)

Design drops land **only** in `app/src/ui/`:

1. `ui/tokens.css` — every color/radius/shadow/type value (light + dark)
2. `ui/primitives/` — chips, toggles, checks, bubbles, composer (1:1 with DESIGN_LANGUAGE §4)
3. `ui/components/`, `ui/pages/` — layout composition

`src/domain/` (week model, liveNow, nudge engine, pixie state, memory) and
`src/adapters/` (storage, model, notifications) are off-limits to design changes —
see ARCHITECTURE §7.

The companion is a slot: drop the finished `pixie.riv` into `app/public/` and wire
`PixieRive` per PRD §6 — the input contract (`mood, resting, celebrate, drift,
attention, pace`) is already computed live.
