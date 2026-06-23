/* useLogger — React access to the app-wide LoggerPort (adapters/logger.ts),
   bound to a component's seam. A view that needs to log (an ErrorBoundary, a
   failed-paint handler) calls `const log = useLogger('week')` and gets a logger
   whose labels are auto-tagged `week/…`. The same redaction applies, so the UI
   can never leak a key into the console either.

   It's a thin, stable wrapper: the bound logger is memoized on the tag, so it's
   safe in effect/callback dependency lists. */

import { useMemo } from 'react'
import { logger, type LoggerPort } from '../../adapters/logger'

/** A LoggerPort scoped to `tag` (e.g. component or surface name). Omit `tag` to
    get the root logger. */
export function useLogger(tag?: string): LoggerPort {
  return useMemo(() => (tag ? logger.withContext(tag) : logger), [tag])
}
