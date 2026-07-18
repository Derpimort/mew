/* The Inbox surface (#348) — captured intents that hold NO time, and gbrain's
   fitting-slot offers the owner confirms. Pure + presentational: it takes rows +
   handlers and renders; all state and the executor live in the store wrapper
   (InboxPage), so this stays string-pinnable in the headless test. Voice is
   positive — an item WAITS, it never "overdue"; a mew is only its completion,
   once placed. Tokens only (no invented color); actions use the Button primitive. */

import type { InboxItem } from '../../domain/types'
import type { InboxOffer } from '../../domain/inbox'
import { fmtDowLong, fmtTime } from '../../domain/time'
import { Button } from '../primitives'

/** A waiting item paired with its current fitting-slot offer (null ⇒ the horizon
    holds no slot that fits yet — it simply waits). */
export interface InboxRow {
  item: InboxItem
  offer: InboxOffer | null
}

function durWord(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

/** the item's own hints, as a quiet meta line (no offer involved) */
function metaLine(item: InboxItem): string {
  const parts: string[] = []
  if (item.tag) parts.push(item.tag)
  if (item.durationMin != null) parts.push(durWord(item.durationMin))
  if (item.energy) parts.push(item.energy)
  return parts.length ? parts.join(' · ') : 'no time yet'
}

export function InboxView({
  rows,
  draft,
  todayKey,
  onDraftChange,
  onCapture,
  onPlace,
  onDismiss,
  onRemove,
  onBack,
}: {
  rows: InboxRow[]
  draft: string
  todayKey: string
  onDraftChange: (v: string) => void
  onCapture: () => void
  /** the owner CONFIRMS the offered slot — the only path to the week from here */
  onPlace: (itemId: string, offer: InboxOffer) => void
  /** "not now" — keep it waiting, don't re-nag today */
  onDismiss: (itemId: string) => void
  onRemove: (itemId: string) => void
  onBack: () => void
}) {
  return (
    <div className="inbox-page">
      <div className="inbox-head">
        <div>
          <h1 className="disp inbox-title">Inbox</h1>
          <p className="inbox-sub">
            Captured intents that hold no time. gbrain offers a slot when one fits — you say when.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onBack} aria-label="back to the week">
          ← week
        </Button>
      </div>

      <form
        className="inbox-capture"
        onSubmit={(e) => {
          e.preventDefault()
          onCapture()
        }}
      >
        <input
          className="inbox-input"
          type="text"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Capture a thought — “call the bank”"
          aria-label="Capture an intent"
        />
        <Button type="submit" variant="primary" size="md" disabled={!draft.trim()}>
          add
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="inbox-empty">Your inbox is clear.</p>
      ) : (
        <ul className="inbox-list">
          {rows.map(({ item, offer }) => (
            <li key={item.id} className="inbox-item">
              <div className="inbox-item-main">
                <span className="inbox-item-title">{item.title}</span>
                <span className="inbox-item-meta">{metaLine(item)}</span>
              </div>
              {offer ? (
                <div className="inbox-offer">
                  <span className="inbox-offer-when">
                    {offer.dayKey === todayKey ? 'today' : fmtDowLong(offer.dayKey)} ·{' '}
                    {fmtTime(offer.startMin)} · {durWord(offer.durationMin)}
                  </span>
                  <span className="inbox-offer-why">{offer.reason}</span>
                  <span className="inbox-item-acts">
                    <Button variant="primary" size="sm" onClick={() => onPlace(item.id, offer)}>
                      place at {fmtTime(offer.startMin)}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onDismiss(item.id)}>
                      not now
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`remove ${item.title}`}
                      onClick={() => onRemove(item.id)}
                    >
                      ×
                    </Button>
                  </span>
                </div>
              ) : (
                <div className="inbox-offer">
                  <span className="inbox-offer-when inbox-offer-none">
                    no free slot yet — it waits here
                  </span>
                  <span className="inbox-item-acts">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`remove ${item.title}`}
                      onClick={() => onRemove(item.id)}
                    >
                      ×
                    </Button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
