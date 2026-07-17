/* Tool-card collapse rule (#282) — pure logic, the sessionWindow/sessionAnnounce
   precedent: SessionLog owns the React wiring, this module owns the rule so it
   is unit-testable without a DOM.

   A turn that ran many steps would otherwise stack a wall of settled receipts;
   more than two CONSECUTIVE settled cards fold into one expandable "▸ n steps"
   summary row. A running card never folds — its shimmer is live signal — and
   it breaks the run around it. Two or fewer stay as individual cards. */

import type { ChatMessage } from '../../domain/types'

/** Runs longer than this fold. The canonical shot (2 settled + 1 running)
    deliberately sits at the boundary and stays unfolded. */
export const FOLD_OVER = 2

/** Settled = the card reached a terminal state (done/error/interrupted).
    Only settled cards fold; `running` must stay visible where it shimmers. */
export function isSettledToolCard(m: ChatMessage): boolean {
  return m.role === 'tool' && m.tool != null && m.tool.state !== 'running'
}

/** One renderable unit of the log: a plain message row, or a folded run of
    settled tool cards. `idx` is the unit's first index within the SOURCE slice,
    so the window can keep addressing rows by their chat-global position. */
export type LogItem =
  | { kind: 'msg'; msg: ChatMessage; idx: number }
  | { kind: 'steps'; msgs: ChatMessage[]; idx: number }

/** Group a window slice for rendering: runs of >FOLD_OVER consecutive settled
    tool cards become one `steps` item; everything else passes through in
    order. Pure — a fresh array per call, input untouched. */
export function collapseToolRuns(msgs: readonly ChatMessage[]): LogItem[] {
  const out: LogItem[] = []
  let run: ChatMessage[] = []
  let runStart = 0
  const flush = () => {
    if (!run.length) return
    if (run.length > FOLD_OVER) out.push({ kind: 'steps', msgs: run, idx: runStart })
    else run.forEach((m, k) => out.push({ kind: 'msg', msg: m, idx: runStart + k }))
    run = []
  }
  msgs.forEach((m, i) => {
    if (isSettledToolCard(m)) {
      if (!run.length) runStart = i
      run.push(m)
      return
    }
    flush()
    out.push({ kind: 'msg', msg: m, idx: i })
  })
  flush()
  return out
}
