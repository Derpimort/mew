/* #80 headroom: the boot curtain joins its classes with clsx alone, which keeps
   tailwind-merge (~26 KB) off the first-load path. That is only safe while
   every class set MEW renders there is conflict-free, so a merge would leave
   it untouched. Rendered headlessly with the props App.tsx passes (keep them
   in step), and on both sides of hydration. No jsdom. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { twMerge } from 'tailwind-merge'
import Preloader from '../preloader'

/** App.tsx's boot curtain, prop for prop */
const render = (loading: boolean) =>
  renderToStaticMarkup(
    <Preloader
      loading={loading}
      variant="slide"
      position="fixed"
      duration={600}
      zIndex={300}
      bgColor="var(--bg)"
      loadingText="MEW"
      textClassName="!text-[var(--ink)] !font-mono !text-2xl !font-bold tracking-[0.28em]"
      respectReducedMotion
      ariaLabel="MEW loading"
    >
      <main>app</main>
    </Preloader>
  )

const classSets = (html: string) =>
  [...html.matchAll(/\sclass="([^"]*)"/g)].map((m) => m[1].replaceAll('&amp;', '&'))

describe('the boot curtain’s classes need no merge (#80 headroom)', () => {
  it('while loading: every class set, the MEW text included, is already what a merge would give', () => {
    const sets = classSets(render(true))
    expect(sets).toContain(
      'text-4xl font-bold !text-[var(--ink)] !font-mono !text-2xl !font-bold tracking-[0.28em]'
    )
    expect(sets.length).toBeGreaterThanOrEqual(5)
    for (const set of sets) expect(twMerge(set), set).toBe(set)
  })

  it('once hydrated: the wrapper and the app’s own box need no merge either', () => {
    const sets = classSets(render(false))
    expect(sets).toEqual(['relative w-full h-full', 'w-full h-full'])
    for (const set of sets) expect(twMerge(set), set).toBe(set)
  })

  it('the curtain never imports tailwind-merge, directly or through cn', () => {
    const src = readFileSync(new URL('../preloader.tsx', import.meta.url), 'utf8')
    const imports = [...src.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(imports).toEqual(['react', 'motion/react', 'clsx'])
  })
})
