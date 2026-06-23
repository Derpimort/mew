/* LoggerPort — one typed, privacy-preserving logging seam for the whole app.
   MEW had console.error/console.warn scattered across store.ts, desktop.ts and
   gbrainHttp.ts with no shape and no privacy boundary. This replaces them with
   four leveled methods that each carry a label (e.g. `calendar/sync`), a
   structured context object, and an optional error — so a failure is greppable
   and diagnosable in devtools.

   The product law "keys never leave the device" binds even the console: a key,
   token or model endpoint that lands in a log line is one screenshot or one
   pasted bug report away from leaving. So every context object and every error
   is run through `filterContext`/`redactValue` before it reaches the console —
   `sk-…` keys, `Bearer …` headers and `https://…` URLs become
   `[redacted:type]`. Logging stays decoupled behind `LoggerPort`, exactly like
   StoragePort/NotifierPort, so a remote-sink adapter can satisfy it later
   without touching a single call site. */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

/** Structured, redactable fields attached to a log line. */
export type LogContext = Record<string, unknown>

export interface LoggerPort {
  error(label: string, ctx?: LogContext, error?: unknown): void
  warn(label: string, ctx?: LogContext, error?: unknown): void
  info(label: string, ctx?: LogContext, error?: unknown): void
  debug(label: string, ctx?: LogContext, error?: unknown): void
  /** A logger that prefixes every label with `adapter/`, so call sites at one
      seam auto-tag without repeating the adapter name. */
  withContext(adapter: string): LoggerPort
}

/* ── redaction ──────────────────────────────────────────────────────────
   Two independent gates, because secrets hide in both places:
   1. the KEY name (`anthropicKey`, `openaiKey`, `brainToken`, `apiKey`, …) —
      redact the whole value regardless of what it looks like, so an empty or
      oddly-shaped key never slips through on shape alone;
   2. the VALUE itself (a `Bearer …` header, an `sk-…`/`sk-ant-…` secret, or
      any `https://…`/`http://…` URL) — redact wherever it appears, including
      inside an error message string, since errors routinely embed the request
      URL or the Authorization header. */

const SECRET_KEY = /(key|token|secret|password|authorization|bearer|credential)/i

const REDACTORS: Array<{ type: string; re: RegExp }> = [
  // Bearer tokens, with or without the value glued on
  { type: 'bearer', re: /Bearer\s+[\w.\-~+/=]+/gi },
  // Anthropic / OpenAI style secret keys
  { type: 'key', re: /\bsk-[A-Za-z0-9_-]{6,}/g },
  // any absolute URL (model endpoints, brain sidecar, OAuth redirects)
  { type: 'url', re: /https?:\/\/[^\s'"]+/gi },
]

/** Redact secrets found *inside* a string value (URLs, bearer tokens, keys). */
function redactString(s: string): string {
  let out = s
  for (const { type, re } of REDACTORS) out = out.replace(re, `[redacted:${type}]`)
  return out
}

/** Redact one context value: by string-pattern, and recursively for nested
    objects/arrays so a key buried under `settings.model.anthropicKey` is caught
    too. The key-name gate is applied by the caller (`filterContext`). */
export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === 'object') return filterContext(value as LogContext)
  return value
}

/** Acceptance: `filterContext({ anthropicKey: 'sk-123', title: 'foo' })` →
    `{ anthropicKey: '[redacted:key]', title: 'foo' }`. A secret-named field is
    redacted whole (type `key`); every other field has its value scrubbed for
    embedded secrets and is recursed into. */
export function filterContext(ctx: LogContext): LogContext {
  const out: LogContext = {}
  for (const [k, v] of Object.entries(ctx)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted:key]' : redactValue(v)
  }
  return out
}

/** An unknown thrown value, made loggable and redacted. Errors keep their name
    and a scrubbed message + stack; anything else is scrubbed as a value. */
function redactError(error: unknown): unknown {
  if (error instanceof Error) {
    const out: LogContext = { name: error.name, message: redactString(error.message) }
    if (error.stack) out.stack = redactString(error.stack)
    return out
  }
  return redactValue(error)
}

/* ── console adapter ──────────────────────────────────────────────────── */

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 }

/** Vite/Vitest set `import.meta.env.DEV`; default to verbose if it's somehow
    absent so we never silently drop logs in an unknown environment. */
function isDev(): boolean {
  try {
    return import.meta.env?.DEV !== false
  } catch {
    return true
  }
}

interface ConsoleLike {
  error: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
}

export interface ConsoleLoggerOptions {
  /** Lowest level to emit. Defaults to `debug` in dev, `warn` in prod. */
  minLevel?: LogLevel
  /** Injectable sink + clock for tests; defaults to the global console/Date. */
  sink?: ConsoleLike
  now?: () => Date
  /** Prefix carried by a `withContext` child; not part of the public API. */
  prefix?: string
}

const NOOP_SINK: ConsoleLike = { error() {}, warn() {}, info() {}, debug() {} }

/* The default sink for loggers created without an explicit one. It's module
   state (the same pattern as setSidecarBrain) so the app-wide `logger` — which
   adapters/state capture at import — can be pointed at a test recorder or, in
   future, a remote-log adapter, without rebuilding it. `null` ⇒ live console. */
let defaultSink: ConsoleLike | null = null

/** Override the sink every console logger uses by default. Pass `null` to
    restore the live console. Intended for tests and a future remote sink. */
export function setLoggerSink(sink: ConsoleLike | null): void {
  defaultSink = sink
}

function liveConsole(): ConsoleLike {
  return typeof console !== 'undefined' ? console : NOOP_SINK
}

/** A LoggerPort backed by the console: ISO timestamp · LEVEL · label, then the
    redacted context object and (for errors) the redacted error — the dev-tools
    output stays readable and the structure stays machine-greppable. */
export function createConsoleLogger(opts: ConsoleLoggerOptions = {}): LoggerPort {
  const now = opts.now ?? (() => new Date())
  const minLevel = opts.minLevel ?? (isDev() ? 'debug' : 'warn')
  const threshold = ORDER[minLevel]
  const prefix = opts.prefix ?? ''

  /* Resolve the sink at emit time, not at construction: an explicitly injected
     sink wins (tests of createConsoleLogger itself); otherwise the module-level
     override, if set; otherwise the live console. Reading per-emit is what lets
     the long-lived `logger` honor a sink installed after module init. */
  const sinkAt = (): ConsoleLike => opts.sink ?? defaultSink ?? liveConsole()

  const emit = (level: LogLevel, label: string, ctx?: LogContext, error?: unknown) => {
    if (ORDER[level] > threshold) return
    const tag = prefix ? `${prefix}/${label}` : label
    const head = `${now().toISOString()} ${level.toUpperCase()} ${tag}`
    const args: unknown[] = [head]
    if (ctx && Object.keys(ctx).length) args.push(filterContext(ctx))
    if (error !== undefined) args.push(redactError(error))
    sinkAt()[level](...args)
  }

  return {
    error: (label, ctx, error) => emit('error', label, ctx, error),
    warn: (label, ctx, error) => emit('warn', label, ctx, error),
    info: (label, ctx, error) => emit('info', label, ctx, error),
    debug: (label, ctx, error) => emit('debug', label, ctx, error),
    withContext: (adapter) =>
      createConsoleLogger({ ...opts, prefix: prefix ? `${prefix}/${adapter}` : adapter }),
  }
}

/** The app-wide logger. Adapters/state import this and call `.withContext()` at
    their seam (e.g. `logger.withContext('calendar')`). */
export const logger: LoggerPort = createConsoleLogger()
