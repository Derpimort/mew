/* The Inbox page (#348) — the routed surface. It wires the store to the pure
   InboxView: captures + their live fitting-slot offers in, capture/place/dismiss
   /remove out. The offers are computed by the store's pure fitOffers (keyless);
   placement happens ONLY on the owner's confirm here, through the executor —
   nothing on this page auto-schedules. */

import { useState } from 'react'
import { useMew } from '../../state/store'
import { dayKey } from '../../domain/time'
import { InboxView, type InboxRow } from '../components/InboxView'

export function InboxPage() {
  const captures = useMew((s) => s.captures)
  const nowMs = useMew((s) => s.nowMs)
  // subscribe to blocks so a placement (or any week change) refreshes the offers
  useMew((s) => s.blocks)
  const inboxOffers = useMew((s) => s.inboxOffers)
  const capture = useMew((s) => s.capture)
  const placeFromInbox = useMew((s) => s.placeFromInbox)
  const dismissInboxOffer = useMew((s) => s.dismissInboxOffer)
  const removeInboxItem = useMew((s) => s.removeInboxItem)
  const setPage = useMew((s) => s.setPage)
  const [draft, setDraft] = useState('')

  const offerFor = new Map(inboxOffers().map((o) => [o.itemId, o]))
  const rows: InboxRow[] = captures
    .filter((c) => c.status === 'open')
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt) // newest capture first
    .map((item) => ({ item, offer: offerFor.get(item.id) ?? null }))

  return (
    <InboxView
      rows={rows}
      draft={draft}
      todayKey={dayKey(new Date(nowMs))}
      onDraftChange={setDraft}
      onCapture={() => {
        const t = draft.trim()
        if (!t) return
        capture(t)
        setDraft('')
      }}
      onPlace={(id, offer) =>
        placeFromInbox(id, {
          dayKey: offer.dayKey,
          startMin: offer.startMin,
          durationMin: offer.durationMin,
        })
      }
      onDismiss={(id) => dismissInboxOffer(id)}
      onRemove={(id) => removeInboxItem(id)}
      onBack={() => setPage('week')}
    />
  )
}
