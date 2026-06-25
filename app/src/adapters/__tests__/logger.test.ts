/* The logger's job is two things at once: structure (level · label · context)
   and the privacy law (keys never leave the device — not even into the console).
   These drive a console logger through an injected sink + fixed clock, and pin
   the redaction the acceptance criteria name exactly. */

import { afterEach, describe, expect, it } from 'vitest'
import {
  createConsoleLogger,
  filterContext,
  logger,
  redactValue,
  setLoggerSink,
  type LogLevel,
} from '../logger'

/** A console stand-in that records every level's args. */
function fakeSink() {
  const calls: { level: LogLevel; args: unknown[] }[] = []
  const rec =
    (level: LogLevel) =>
    (...args: unknown[]) =>
      calls.push({ level, args })
  return {
    error: rec('error'),
    warn: rec('warn'),
    info: rec('info'),
    debug: rec('debug'),
    calls,
  }
}

const FIXED = () => new Date('2026-06-19T09:40:00.000Z')

describe('filterContext — redaction (the privacy law)', () => {
  it('redacts a secret-named field whole, keeps an ordinary field (acceptance example)', () => {
    expect(filterContext({ anthropicKey: 'sk-123', title: 'foo' })).toEqual({
      anthropicKey: '[redacted:key]',
      title: 'foo',
    })
  })

  it('redacts every secret-named key shape MEW uses', () => {
    expect(
      filterContext({
        openaiKey: 'x',
        brainToken: 'y',
        apiKey: 'z',
        password: 'p',
        authorization: 'a',
      })
    ).toEqual({
      openaiKey: '[redacted:key]',
      brainToken: '[redacted:key]',
      apiKey: '[redacted:key]',
      password: '[redacted:key]',
      authorization: '[redacted:key]',
    })
  })

  it('redacts a Bearer token by value, even under an innocent key name', () => {
    expect(filterContext({ header: 'Bearer abc.def-123' })).toEqual({ header: '[redacted:bearer]' })
  })

  it('redacts an http(s) URL by value (model endpoint / brain sidecar)', () => {
    expect(filterContext({ note: 'POST https://api.anthropic.com/v1/messages failed' })).toEqual({
      note: 'POST [redacted:url] failed',
    })
    // `url` is not a secret-named key, so the value gets the URL redactor
    expect(filterContext({ url: 'http://localhost:11434/api/chat' })).toEqual({
      url: '[redacted:url]',
    })
  })

  it('redacts an sk- style secret embedded in a value', () => {
    expect(filterContext({ msg: 'using sk-ant-api03-XYZ_abc-456 now' })).toEqual({
      msg: 'using [redacted:key] now',
    })
  })

  it('recurses into nested objects and arrays', () => {
    expect(
      filterContext({
        settings: { model: { anthropicKey: 'sk-1', location: 'remote' } },
        urls: ['https://x.test/a'],
      })
    ).toEqual({
      settings: { model: { anthropicKey: '[redacted:key]', location: 'remote' } },
      urls: ['[redacted:url]'],
    })
  })

  it('leaves non-secret primitives untouched', () => {
    expect(filterContext({ count: 3, ok: true, name: 'Q3 deck', missing: null })).toEqual({
      count: 3,
      ok: true,
      name: 'Q3 deck',
      missing: null,
    })
  })

  it('redactValue scrubs a bare string and passes through plain values', () => {
    expect(redactValue('see https://x.test/p')).toBe('see [redacted:url]')
    expect(redactValue(42)).toBe(42)
  })
})

describe('createConsoleLogger — structure & levels', () => {
  it('writes ISO timestamp · LEVEL · label, then the redacted context', () => {
    const sink = fakeSink()
    const log = createConsoleLogger({ sink, now: FIXED, minLevel: 'debug' })
    log.error('calendar/sync', { calendars: 2, anthropicKey: 'sk-secret' })
    expect(sink.calls).toHaveLength(1)
    const [head, ctx] = sink.calls[0].args
    expect(sink.calls[0].level).toBe('error')
    expect(head).toBe('2026-06-19T09:40:00.000Z ERROR calendar/sync')
    expect(ctx).toEqual({ calendars: 2, anthropicKey: '[redacted:key]' })
  })

  it('appends a redacted error object when one is passed', () => {
    const sink = fakeSink()
    const log = createConsoleLogger({ sink, now: FIXED, minLevel: 'debug' })
    log.error(
      'model/adapter',
      { adapter: 'anthropic' },
      new Error('401 at https://api.anthropic.com')
    )
    const [, ctx, err] = sink.calls[0].args
    expect(ctx).toEqual({ adapter: 'anthropic' })
    expect(err).toMatchObject({ name: 'Error', message: '401 at [redacted:url]' })
  })

  it('omits the context arg when empty', () => {
    const sink = fakeSink()
    const log = createConsoleLogger({ sink, now: FIXED, minLevel: 'debug' })
    log.warn('close-hook/unavailable')
    expect(sink.calls[0].args).toEqual(['2026-06-19T09:40:00.000Z WARN close-hook/unavailable'])
  })

  it('filters below the minimum level (prod: warn+ drops info/debug)', () => {
    const sink = fakeSink()
    const log = createConsoleLogger({ sink, now: FIXED, minLevel: 'warn' })
    log.error('a')
    log.warn('b')
    log.info('c')
    log.debug('d')
    expect(sink.calls.map((c) => c.level)).toEqual(['error', 'warn'])
  })

  it('dev minimum lets every level through', () => {
    const sink = fakeSink()
    const log = createConsoleLogger({ sink, now: FIXED, minLevel: 'debug' })
    log.error('a')
    log.warn('b')
    log.info('c')
    log.debug('d')
    expect(sink.calls.map((c) => c.level)).toEqual(['error', 'warn', 'info', 'debug'])
  })
})

describe('withContext — auto-tagging at a seam', () => {
  it('prefixes the label with the adapter name', () => {
    const sink = fakeSink()
    const log = createConsoleLogger({ sink, now: FIXED, minLevel: 'debug' }).withContext('brain')
    log.warn('unreachable', { note: 'running without it' })
    expect(sink.calls[0].args[0]).toBe('2026-06-19T09:40:00.000Z WARN brain/unreachable')
  })

  it('nests prefixes and still redacts', () => {
    const sink = fakeSink()
    const log = createConsoleLogger({ sink, now: FIXED, minLevel: 'debug' })
      .withContext('calendar')
      .withContext('google')
    log.error('push', { brainToken: 'secret' })
    expect(sink.calls[0].args[0]).toBe('2026-06-19T09:40:00.000Z ERROR calendar/google/push')
    expect(sink.calls[0].args[1]).toEqual({ brainToken: '[redacted:key]' })
  })

  it('a child keeps the parent min-level (no leak of a filtered level)', () => {
    const sink = fakeSink()
    const log = createConsoleLogger({ sink, now: FIXED, minLevel: 'warn' }).withContext('store')
    log.debug('noisy')
    expect(sink.calls).toHaveLength(0)
  })
})

describe('setLoggerSink — redirect the app-wide logger (test/remote-sink seam)', () => {
  afterEach(() => setLoggerSink(null))

  it('routes the shared `logger` (captured at import) to an installed sink', () => {
    const sink = fakeSink()
    setLoggerSink(sink)
    // a child created BEFORE the sink was installed must still honor it
    logger.withContext('store').error('calendar/sync', { calendars: 1 })
    expect(sink.calls).toHaveLength(1)
    expect(sink.calls[0].level).toBe('error')
    expect(String(sink.calls[0].args[0])).toMatch(/ ERROR store\/calendar\/sync$/)
    expect(sink.calls[0].args[1]).toEqual({ calendars: 1 })
  })

  it('null restores the default (no throw, no capture on the recorder)', () => {
    const sink = fakeSink()
    setLoggerSink(sink)
    setLoggerSink(null)
    logger.warn('after-restore')
    expect(sink.calls).toHaveLength(0)
  })
})
