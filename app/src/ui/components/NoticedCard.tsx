/* "what mew's noticed" — the insights card (#287): read-only rows from the
   domain presenter (insightsCard), each value traceable to a computed
   Insights field via its data-claim attribute. Pure skin over props — the
   store wiring lives in SettingsPage — so this renders headless in tests.
   Under the data floor (card = null) it stays kind: still learning, never
   thin-data science. Tokens only; the card observes, it never awards. */

import type { CSSProperties } from 'react'
import { INSIGHTS_CARD_TITLE, type InsightsCardData } from '../../domain/insights'

const LABEL: CSSProperties = {
  fontSize: 10,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '.12em',
}

export function NoticedCard({ card }: { card: InsightsCardData | null }) {
  return (
    <div className="set-card">
      <h2>{card?.title ?? INSIGHTS_CARD_TITLE}</h2>
      <div className="sub">
        Weekly patterns from your own history — computed on this device, nothing sent anywhere.
      </div>
      {card ? (
        card.rows.map((r) => (
          <div key={r.claim} data-claim={r.claim} style={{ marginTop: 10 }}>
            <div className="mono" style={LABEL}>
              {r.label}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, marginTop: 3, color: 'var(--ink)' }}>
              {r.value}
            </div>
          </div>
        ))
      ) : (
        <div className="sub" style={{ marginTop: 8 }}>
          still learning your week — check back friday
        </div>
      )}
    </div>
  )
}
