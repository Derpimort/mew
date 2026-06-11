# MEW — Design Language (FINAL · "Carbon & Pet White")
*Supersedes the earlier warm-cream system. Values match `mew-v20-final.jsx` / `MEW Final.html` exactly.*

## 0. The one rule
The interface is **monochrome carbon (or warm white)** — only the **pet** carries color. The pet's primary accent (`--pa`) = work & attention; its secondary (`--pb`) = life & rest. Nothing else is colored, ever. No translucent color fills; hierarchy comes from **size, weight, and solid materials**. The default pet is **Pixie** (cat): gold fur `--pa`, cream chest `--pb`.

## 0a. Per-pet theming (theme follows pet)
One structure, many pets. The pet type is a setting; it swaps **only the accent pair** — the carbon/white structure, layout, type, motion are invariant. Implement as derived tokens:
```
--ice: var(--pa); --gold: var(--pa);
--ice-soft: rgba(var(--pa-rgb), .13); --ice-bd: rgba(var(--pa-rgb), .5);
--glow: 0 0 14px rgba(var(--pa-rgb), .45); --glowc: rgba(var(--pa-rgb), .8);
--teal: var(--pb); --teal-soft: rgba(var(--pb-rgb), .12); --teal-bd: rgba(var(--pb-rgb), .46);
```
A pet supplies four source values × 2 (hex + `r,g,b`): a **dark** pair and a **light/deep** pair (light mode uses deeper, more saturated accents). Registry (`mew-v21-system.jsx` `PETS` + `.nx.sys[data-pet=…]`):
| Pet | dark `--pa` / `--pb` | light `--pal` / `--pbl` |
|---|---|---|
| cat (default) | `#e9b96b` / `#d4c8a8` | `#a4761f` / `#7e7250` |
| dog | `#e0975a` / `#cbb091` | `#b56a28` / `#8a7556` |
| fox | `#e8825a` / `#d8a98f` | `#c25a2e` / `#94705a` |
| bunny | `#dd9ab8` / `#c6b4d2` | `#b15a86` / `#836a96` |
| bird | `#5fb6c0` / `#9fc9b2` | `#2f8a96` / `#5a8a72` |

Pet White is *accented* white: a faint `radial-gradient(rgba(var(--acc-rgb),.10), transparent)` wash tints the warm-white surface so light mode also reads as that pet's.

## 0b. Companion stage
The right column's top ~330px is a fixed-size **stage** reserved for the animated 3D/vector companion (placeholder: `pixie-poly-face.svg`, slow 7s float). Anatomy: ambient accent glow + elliptical floor shadow + companion (188px box, accent ring + glow + inner bottom shadow to seat it) + mono slot tag `companion · 3D · animated` (top-left) + `live` pulse (top-right) + bottom info strip (name / condition / pace bar `linear-gradient(--teal→--gold)`). Size the stage as a container so the rig animates within it without reflowing the session below.

## 1. Color tokens

### Carbon (dark, default)
| Token | Value | Use |
|---|---|---|
| `--bg` | `#060708` | pitch-black stage |
| `--panel` | `#14161a` | steel component surface |
| `--panel2` | `#1a1d22` | elevated steel (cards, prompts, today column) |
| `--glass` | `rgba(20,22,26,.94)` | floating cards (block detail) |
| `--ink` | `#ecedef` | primary text |
| `--muted` | `#8f97a3` | secondary text (cool steel gray) |
| `--faint` | `#555c66` | tertiary/labels |
| `--line` | `#23272e` | key-line borders |
| `--line2` | `#15171b` | hairlines |
| `--ice` / `--gold` | `var(--pa)` (cat `#e9b96b`) | pet primary — work, attention, now, mews, primary actions |
| `--teal` | `var(--pb)` (cat `#d4c8a8`) | pet secondary — life, rest, wellbeing |
| `--glowc` | `rgba(var(--pa-rgb),.8)` | the only glow (now-dot, current block) |

### Pet White (light)
Warm accented white — paper washed by the pet accent, **not** cool steel:
`--bg #fdfbf6 · --panel #f6f1e8 · --panel2 #fffefb · --ink #1b160d · --muted #766a58 · --faint #b0a48d · --line #e7dfcd · --line2 #f1ebde`, accents from the pet's light pair (`--pal`/`--pbl`).

### Steel material (both modes)
- Panels: `linear-gradient(180deg, var(--panel2), var(--panel))` + 1px `--line` key-line.
- Buttons: 1px top highlight `rgba(255,255,255,.04)` + small drop shadow; primary = solid gold, dark text (white in light mode).
- Inputs: inset shadow `inset 0 1.5px 4px rgba(0,0,0,.35)` (lighter in Pet White).
- No backdrop-blur, no translucent color fills.

## 2. Typography
| Role | Font | Spec |
|---|---|---|
| Display (countdown, tasks, day names) | **Space Grotesk** 600–700 | countdown 92px/-0.035em; task 27px; titles 13–22px |
| UI body | **Hanken Grotesk** 400–800 | block titles 10.5px/700, body 13–15px |
| Technical (times, telemetry, labels, session) | **JetBrains Mono** 400–700 | 8.5–12px; caps labels 10px/.12em tracking |

## 3. The two views
### Focus — the bezel dial (signature)
- Rolling **next-12h dial**, *now pinned at top* (glowing gold dot + `now · 9:40`).
- Twin rings: **work outer, life inner**. Arcs solid color; current block 22px stroke + gold glow; future 8px (full color, never ghosted). Rest = dashed.
- A faint gold **wedge** sweeps from now to the current block's end (animates opacity 6.5s).
- Center: giant countdown → mono caps meta (`remaining · held until 11:30`) → task name.
- **Minimal at rest**: only rings, arcs, now, countdown, task.
- **Hover anywhere near the dial** → fade in (.5s): hour marks (+3h/+6h/+9h), task labels at their hour (gold/cream, mono time), telemetry (`★ 5 mews · guard on · 2 switches`).
- **Hover/click a block or label** → arc thickens (8→15px) and a **detail card** opens at its position: title, time range/duration, `held`, tag chip, actions (`Start now`/`Done — a mew`, `Move`, `Hold`/`Release`).

### Week — pure columns
- Seven time-true columns (8:00–19:00), hour ruler left.
- **Today/selected day is 2.3× wider**, ringed gold (`inset 0 0 0 1.4px var(--ice-bd)` on steel gradient), with full labels, time ranges, `held`, and the glowing now-line. Other days: shapes only (titles ≥1h at 9px).
- **S1 Solid material**: blocks are *fully solid* gold (work) / cream (life) with dark text (white in light mode). Done = outline + strikethrough, no ghosting. Rest = cream outline, dashed feel. Now = solid gold + double ring + glow.
- Past days at .45 opacity (whole column only). Heavy day flagged in its header (`· 8h`).
- Mono summary line below: `32h planned · rest kept 4/5 · wednesday wants a kinder shape — nudge in chat`.

## 4. The right column — den + session (392–452px)
- **Pixie's den** (top): 132–148px low-poly portrait, gold ring + warm glow (the only warm light), name in Space Grotesk, pulsing gold status (`healthy · mewing away`), one-line note, **pace meter** (cream→gold gradient).
- **Session** (`mew session — tty1`): terminal title bar (steel gradient), log lines `you ❯` (gold prompt for mew, user text ink), `# comments` faint, `★ mew #N` gold.
- **Nudges** = steel cards with gold caps header (`▸ nudge/drift — 09:40`), body, faint research line, machined buttons (primary solid gold).
- Prompt: steel inset field with blinking gold cursor.

## 5. Motion
- Reveal fade .5s ease; arc thicken .25s; wedge breath 6.5s; status dots pulse 3s.
- Honor `prefers-reduced-motion` (all off).

## 6. Voice
Unchanged from v1 system: lowercase-friendly, brief, factual, care-not-blame, positive-only; vocabulary (mew/mews/mewing away/resting/healthy/run-down) is law. No emoji.
