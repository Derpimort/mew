/* Google auth, desktop branch — the loopback replaces only HOW the token
   arrives; shape, caching, and the no-secret law are asserted here. The web
   GIS path is untouched (isTauri() === false short-circuits before it). */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const desktopFake = {
  tauri: true,
  redirect: '' as string,
  calls: [] as string[],
}

vi.mock('../../desktop', () => ({
  isTauri: () => desktopFake.tauri,
  oauthLoopback: async (buildAuthUrl: (port: number) => string) => {
    desktopFake.calls.push(buildAuthUrl(17893))
    return desktopFake.redirect
  },
}))

import { googleAccount } from '../google'

beforeEach(() => {
  desktopFake.tauri = true
  desktopFake.redirect = ''
  desktopFake.calls = []
})

/* googleAccount memoizes one account (and its token) per client id — every
   case gets a fresh id so caching is tested deliberately, not by accident */
let seq = 0
const freshId = () => `client-${++seq}`

describe('google authorize via loopback', () => {
  it('builds an implicit-grant URL — token response, exact loopback redirect, no secret anywhere', async () => {
    desktopFake.redirect = 'http://localhost:17893/?access_token=tok&expires_in=3599'
    const id = freshId()
    await googleAccount(id).authorize(true)
    expect(desktopFake.calls).toHaveLength(1)
    const u = new URL(desktopFake.calls[0])
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(u.searchParams.get('client_id')).toBe(id)
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:17893')
    expect(u.searchParams.get('response_type')).toBe('token')
    expect(u.searchParams.get('scope')).toContain('calendar.readonly')
    expect(u.searchParams.get('prompt')).toBe('consent') // interactive
    expect(desktopFake.calls[0]).not.toMatch(/secret/i)
  })

  it('caches the token: a second authorize inside the hour does not reopen the browser', async () => {
    desktopFake.redirect = 'http://localhost:17893/?access_token=tok&expires_in=3599'
    const acct = googleAccount(freshId())
    await acct.authorize(true)
    await acct.authorize(false)
    expect(desktopFake.calls).toHaveLength(1)
  })

  it('silent refresh omits the consent prompt', async () => {
    desktopFake.redirect = 'http://localhost:17893/?access_token=tok&expires_in=3599'
    await googleAccount(freshId()).authorize(false)
    expect(new URL(desktopFake.calls[0]).searchParams.get('prompt')).toBeNull()
  })

  it('reads a fragment-style redirect too (defense against unforwarded hashes)', async () => {
    desktopFake.redirect = 'http://localhost:17893/#access_token=tok2&expires_in=100'
    await expect(googleAccount(freshId()).authorize(true)).resolves.toBeUndefined()
  })

  it('maps access_denied to the human phrase and surfaces other errors factually', async () => {
    desktopFake.redirect = 'http://localhost:17893/?error=access_denied'
    await expect(googleAccount(freshId()).authorize(true)).rejects.toThrow('sign-in cancelled')
    desktopFake.redirect = 'http://localhost:17893/?error=invalid_client'
    await expect(googleAccount(freshId()).authorize(true)).rejects.toThrow(
      'google sign-in: invalid_client'
    )
  })

  it('rejects a token-less redirect instead of pretending', async () => {
    desktopFake.redirect = 'http://localhost:17893/?state=nothing'
    await expect(googleAccount(freshId()).authorize(true)).rejects.toThrow(
      'no access token granted'
    )
  })
})
