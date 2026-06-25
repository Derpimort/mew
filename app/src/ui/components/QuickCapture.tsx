/* Quick-capture pane (#171) — the compact, no-form capture the command
   palette shows in 'capture' mode. The input itself lives in the palette
   (one shared field across modes); this pane renders the mode-aware help line
   and the two actions ('keep open' / 'place now'). Enter is wired by the
   palette: it uses the user's default mode, Shift+Enter forces place-now.

   The capture never writes a chat turn (it lives in parallel data); the
   palette toasts the result. Empty input disables both buttons. */

export function QuickCapture({
  mode,
  hasText,
  onSubmit,
}: {
  /** the user's default from Settings — drives the help copy + which action
      the bare Enter takes */
  mode: 'open' | 'auto-place'
  /** is there a non-blank title to capture? gates the buttons */
  hasText: boolean
  /** true = auto-place in today's first free 30-min slot; false = keep open */
  onSubmit: (autoPlace: boolean) => void
}) {
  return (
    <div className="cmdk-capture">
      <p className="cmdk-capture-help">
        {mode === 'auto-place'
          ? 'Enter drops it in today’s first free 30 minutes. No free slot? It waits as an open capture.'
          : 'Enter jots it as an open capture — no interruption, find it later in the rail or search.'}
      </p>
      <div className="cmdk-capture-acts">
        <button
          type="button"
          className="tui-btn"
          disabled={!hasText}
          onClick={() => onSubmit(false)}
        >
          keep open
        </button>
        <button
          type="button"
          className="tui-btn pri"
          disabled={!hasText}
          onClick={() => onSubmit(true)}
        >
          place now
        </button>
      </div>
      <p className="cmdk-capture-foot">
        <span className="k">↵</span> {mode === 'auto-place' ? 'place now' : 'keep open'} ·{' '}
        <span className="k">shift+↵</span> place now
      </p>
    </div>
  )
}
