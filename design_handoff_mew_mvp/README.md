# Handoff: MEW — MVP (FINAL design round)

## Overview
MEW ("My Entire Week") is an AI companion that runs your week with you. One main page with two views (**Focus** dial ⇄ **Week** columns) plus a persistent right column (Pixie's den + chat session), and a settings page. A research-grounded nudge engine delivers everything through chat; browser notifications only mirror chat. **Start with `PRD.md`**, then `DESIGN_LANGUAGE.md` (final "Carbon & Pet White" system).

## About the Design Files
The HTML/JSX files are **design references created in HTML** — prototypes showing intended look and behavior, **not production code to copy**. Recreate them in the target codebase's stack (they were authored in React; React + Vite is the lowest-friction match).

**`MEW Final System.html` is the canonical design.** Open it in a browser: the main page and settings are live (toggle Focus/Week; in Settings click a pet to re-theme the whole page). It supersedes `MEW Final.html` (which lacked per-pet theming + the companion stage). Earlier canvases remain only for nudge-library content; their warm-cream style is superseded.

## Fidelity
High-fidelity. Tokens, type, spacing and copy in `DESIGN_LANGUAGE.md` are final intent. Exceptions:
1. **The companion is a placeholder.** `pixie-poly-face.svg` (low-poly portrait from the real photo) sits in the **companion stage** with a slow float. Production = an animated 3D/vector slow-motion rig per pet (Rive `*.riv`, state machine `PixieMachine`) per PRD §6. The stage box + input contract are final; the art is not.
2. **Theme follows pet.** Per-pet accent theming is final (PRD §3b, DESIGN_LANGUAGE §0a). Cat ships first; other pets need their art/rig.
3. Settings is rebuilt on Carbon with a live pet picker (`mew-v22-settings.jsx`). The old warm `mew-v4-settings.jsx` is superseded — keep it only for the routing-matrix/notification content if useful.

## Screens
### Main page (final): `SurfaceMain` in `mew-v21-system.jsx`
1280×840 reference, grid `1fr | 452px`, on `.stl.nx.ns.sys[data-pet]` (+ `.sys--light`).
- **Left stage**: wordmark, agent status line, Focus/Week segmented toggle.
  - **Focus** = `NxFocus` (mew-v16-noir.jsx): bezel dial, hover-reveal, block detail cards. Geometry: next-12h `deg = (h−now)/12 × 360`, now at top; rings ro=268/ri=226 in an 824-wide SVG (viewBox -110).
  - **Week** = `NxbColumns` styleClass `nxs1` (mew-v18-weekstyles.jsx): 7 columns, today `2.3fr`, H=540, solid S1 material.
- **Right** = `RightColumn` (mew-v21-system.jsx): **`CompanionStage`** (reserved animated-3D space, §3a) above `SessionLog` (tty chat + nudge cards + prompt).
- **Tokens/theming**: `SystemStyles` (mew-v21-system.jsx) — carbon + pet-white + per-pet accent derivation + stage + settings controls. Base noir vars/cards/fades `NxStyles` (mew-v16-noir.jsx); steel detailing `NsStyles` (mew-v19-steel.jsx).

### Settings (final): `SurfaceSettings` in `mew-v22-settings.jsx`
Live pet picker (re-themes page) · Your companion (locked principles) · Calendars & visibility matrix · Appearance (mode + accent) · Nudges & notifications (chat-first locked, quiet hours) · Privacy & model (local-first, BYO key, remote/local).

### Supporting content specs
- `mew-v4-research.jsx` — the 8-nudge library (content source of truth for PRD §5), day moments, memory/truth model.
- Notification toast anatomy: `NotifToast` in `mew-v3-parts.jsx` (re-skin).

## Interactions (final)
- Focus dial: minimal at rest → hover near dial fades in labels/marks/telemetry (.5s) → hover/click block thickens arc + opens detail card (actions: Start now / Done — a mew / Move / Hold / Release).
- Week: click a day column → it becomes the wide selected column; today default. Block click → same detail card. Checkbox/Done = a mew (celebrate trigger, counter, chat line).
- Chat: talk-to-schedule; nudges as chat cards with action chips; browser notifications mirror chat only when tab unfocused; quiet hours suppress.
- All other behavior: PRD §§2–10 (unchanged and current).

## State management, calendars, nudges, memory, model
See PRD — fully current. The visual system change does not alter any behavioral spec.

## Files
- `PRD.md` — product requirements. **Start here.**
- `DESIGN_LANGUAGE.md` — FINAL tokens/materials/type/views spec.
- `MEW Final System.html` — canonical live design (open in browser). `MEW Final.html` is the prior (pre-theming) snapshot.
- Final-system JSX (load order = the order in `MEW Final System.html`): `surfaces.jsx`, `mew-v5-calendar.jsx` (data: DAYBLOCKS/DAY_META/NOW_H/fmtH), `mew-v8-core.jsx`, `mew-v9-den.jsx`, `mew-v10-dev.jsx` (session/TUI styles), `mew-v11-final.jsx`, `mew-v12-clock.jsx`, `mew-v13-rings.jsx`, `mew-v14-bezel.jsx`, `mew-v15-spotlight.jsx`, `mew-v16-noir.jsx` (NxFocus, NxStyles), `mew-v17-week.jsx` (nxwY), `mew-v18-weekstyles.jsx` (S1 columns), `mew-v19-steel.jsx` (steel), **`mew-v21-system.jsx`** (SystemStyles, PETS, CompanionStage, RightColumn, SurfaceMain), **`mew-v22-settings.jsx`** (SurfaceSettings).
- Settings + content: `MEW v4.html`, `mew-v4-settings.jsx`, `mew-v4-research.jsx`, `mew-v3-parts.jsx` (+ `MEW v3.html`, `mew-v2-parts.jsx` for history).
- Assets: `pixie-poly-face.svg`, `tools/lowpoly-generator.js`.
- `design-canvas.jsx` — canvas viewer shell only; **not** part of the product.
