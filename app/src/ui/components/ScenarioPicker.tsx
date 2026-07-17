/* Plan mode's scenario picker (#293) — the cards under a propose_scenarios
   message. Each scenario renders as name + rationale line + a 7-column
   mini-week strip (proposed places as slivers over a per-day density tint,
   item 12's cue, computed locally from the stored dayLoad) + one pick button.

   Liveness is EXACTLY the ChoiceChips grammar (#254): inert after any pick,
   after a newer user message (`superseded`, derived list-side), or while a
   turn is mewing (`thinking`) — what looks pickable is pickable, and the
   store's pickScenario re-derives the same law from the live chat, so a
   stale click can never act. Rendering is a pure function of props (the
   SSR-testable seam SessionWindow set); the strip's pure logic lives in
   scenarioStrip.ts. Windowing survival (#250) comes free: the cards ride
   the message row. Static by design — the only entrance motion is the
   message row's own, which already honors reduced motion. */

import { useMew } from '../../state/store'
import { Button } from '../primitives/Button'
import { scenarioPicked } from '../../domain/choices'
import type { ChatMessage, StoredScenario } from '../../domain/types'
import { addDaysKey } from '../../domain/time'
import { loadClass, sliverRect, STRIP_DAYS, stripSummary } from './scenarioStrip'

/** One day column: the density tint carries the class; the slivers are the
    proposed places, positioned by clock time. Decorative — the strip's own
    aria-label speaks the summary, so the geometry stays presentation-only. */
function DayColumn({ sc, dayOffset }: { sc: StoredScenario; dayOffset: number }) {
  const key = addDaysKey(sc.todayKey, dayOffset)
  const places = sc.places.filter((p) => p.dayOffset === dayOffset)
  return (
    <div className={`scn-day ${loadClass(sc.dayLoad[key] ?? 0)}`}>
      {places.map((p, i) => {
        const { top, height } = sliverRect(p.startMin, p.durationMin)
        return (
          <span
            key={i}
            className={`scn-slv ${p.tag}`}
            style={{ top: `${top}%`, height: `${height}%` }}
          />
        )
      })}
    </div>
  )
}

function ScenarioCard({
  sc,
  active,
  onPick,
}: {
  sc: StoredScenario
  active: boolean
  onPick: () => void
}) {
  return (
    <article className="scn-card" aria-label={`plan option — ${sc.name}`}>
      <div className="scn-head">
        <span className="scn-name">{sc.name}</span>
        <Button
          variant="chip"
          size="sm"
          disabled={!active}
          aria-label={sc.picked ? `${sc.name} — picked` : `pick ${sc.name}`}
          onClick={onPick}
        >
          {sc.picked && <span className="ok">✓ </span>}
          {sc.picked ? 'picked' : 'pick'}
        </Button>
      </div>
      <div className="cm scn-line"># {sc.line}</div>
      <div className="scn-strip" role="img" aria-label={stripSummary(sc)}>
        {Array.from({ length: STRIP_DAYS }, (_, d) => (
          <DayColumn key={d} sc={sc} dayOffset={d} />
        ))}
      </div>
    </article>
  )
}

/** The picker row on a mew message — same seam shape as ChoiceChips: pure
    props in, one store action out. The picked card keeps its ✓ forever. */
export function ScenarioCards({
  msg,
  superseded = false,
  thinking = false,
}: {
  msg: ChatMessage
  /** #254 grammar: a newer user message landed after this row. */
  superseded?: boolean
  /** #254 grammar: a turn is mewing — picks park while it runs. */
  thinking?: boolean
}) {
  const pickScenario = useMew((s) => s.pickScenario)
  const active = !superseded && !thinking && !scenarioPicked(msg)
  return (
    <div className="scn-cards" role="group" aria-label="plan options">
      {msg.scenarios!.map((sc) => (
        <ScenarioCard
          key={sc.id}
          sc={sc}
          active={active}
          onPick={() => pickScenario(msg.id, sc.id)}
        />
      ))}
    </div>
  )
}
