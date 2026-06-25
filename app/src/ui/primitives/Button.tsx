/* The shared button primitive. One machined affordance — mirroring the
   BlockCard click-card buttons (.ca / .ca.pri) the owner likes — so every
   button reads the same instead of being styled per call site. Tokens only;
   theme (carbon/white) and the pet accent ride the CSS vars already wired.
   Behaviour + a11y come free from the native <button> (onClick/disabled/
   type/aria-* all forward through). Styling lives in primitives.css (.btn).

   variant: primary (solid accent) · ghost (outlined secondary) ·
            chip (compact row action) · danger
   size:    sm · md */
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'chip' | 'danger'
  size?: 'sm' | 'md'
  children: ReactNode
  /** React 19 ref-as-prop — lets callers focus/measure the button (e.g. the
      onboarding tour autofocusing its forward action). */
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'ghost',
  size = 'md',
  type,
  className,
  children,
  ref,
  ...rest
}: ButtonProps) {
  const cls = ['btn', `btn-${variant}`, `btn-${size}`, className].filter(Boolean).join(' ')
  return (
    <button ref={ref} type={type ?? 'button'} className={cls} {...rest}>
      {children}
    </button>
  )
}
