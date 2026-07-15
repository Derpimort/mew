export { Button, type ButtonProps } from './Button'

export function Tgl({
  on,
  lock,
  cap,
  onToggle,
  title,
}: {
  on?: boolean
  lock?: boolean
  cap?: string
  onToggle?: () => void
  title?: string
}) {
  return (
    <div className="rc" style={{ display: 'flex', alignItems: 'center' }}>
      {lock && cap && <span className="lockcap">{cap}</span>}
      {/* a real keyboard switch: tabbable and flipped by Space/Enter (WCAG §2.1.1).
          A locked principle is inert — there is nothing to change (ARCHITECTURE D7,
          acceptance #9) — so it's not in the tab order and takes no key handler. */}
      <div
        className={'tg' + (on ? ' on' : '') + (lock ? ' lock' : '')}
        onClick={lock ? undefined : onToggle}
        role={lock ? undefined : 'switch'}
        aria-checked={lock ? true : !!on}
        tabIndex={lock ? undefined : 0}
        onKeyDown={
          lock
            ? undefined
            : (e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault()
                  onToggle?.()
                }
              }
        }
        title={
          title ??
          (lock ? 'This one does not toggle. It is a principle, not a preference.' : undefined)
        }
      >
        <span className="kn">
          {lock && (
            <svg className="knlock" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M8 10V7a4 4 0 0 1 8 0v3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <rect x="5.5" y="10" width="13" height="9.5" rx="2.2" fill="currentColor" />
            </svg>
          )}
        </span>
      </div>
    </div>
  )
}

export function Segc({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[]
  value: string
  onChange?: (id: string) => void
}) {
  return (
    <span className="segc">
      {options.map((o) =>
        onChange ? (
          <button
            key={o.id}
            type="button"
            className={value === o.id ? 'on' : ''}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ) : (
          <span key={o.id} className={value === o.id ? 'on' : ''}>
            {o.label}
          </span>
        )
      )}
    </span>
  )
}
