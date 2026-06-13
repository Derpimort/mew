import { describe, expect, it } from 'vitest'
import { createNobleCrypto } from '../noble'
import { addDeviceWrap, openProfile, openWithDevice, sealProfile } from '../envelope'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)
/* byte-subsequence search — no Buffer dep (this stays browser-lib clean) */
const contains = (hay: Uint8Array, needle: Uint8Array) => {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

const crypto = createNobleCrypto()
const PROFILE = enc(JSON.stringify({ blocks: [{ title: 'Finish Q3 deck' }], calendarToken: 'ya29.SECRET-TOKEN' }))

describe('envelope — local passphrase path', () => {
  it('seals, then opens with the right passphrase', async () => {
    const { envelope } = await sealProfile(crypto, PROFILE, 'correct horse')
    const { plaintext } = await openProfile(crypto, envelope, 'correct horse')
    expect(dec(plaintext)).toBe(dec(PROFILE))
  })

  it('the at-rest envelope leaks no cleartext secret', async () => {
    const { envelope } = await sealProfile(crypto, PROFILE, 'correct horse')
    expect(contains(envelope.data.ct, enc('ya29.SECRET-TOKEN'))).toBe(false)
  })

  it('rejects the wrong passphrase', async () => {
    const { envelope } = await sealProfile(crypto, PROFILE, 'correct horse')
    await expect(openProfile(crypto, envelope, 'wrong')).rejects.toThrow()
  })

  it('rejects tampered ciphertext', async () => {
    const { envelope } = await sealProfile(crypto, PROFILE, 'correct horse')
    envelope.data.ct[0] ^= 1
    await expect(openProfile(crypto, envelope, 'correct horse')).rejects.toThrow()
  })
})

describe('envelope — PQ device path (sync / zero-knowledge host)', () => {
  it('a paired device unlocks via the hybrid KEM', async () => {
    const { envelope, dek } = await sealProfile(crypto, PROFILE, 'correct horse')
    const device = crypto.kemKeygen()
    const shared = addDeviceWrap(crypto, envelope, dek, device.publicKey)
    const { plaintext } = openWithDevice(crypto, shared, device.secretKey)
    expect(dec(plaintext)).toBe(dec(PROFILE))
  })

  it("another device's key cannot open it", async () => {
    const { envelope, dek } = await sealProfile(crypto, PROFILE, 'correct horse')
    const device = crypto.kemKeygen()
    const shared = addDeviceWrap(crypto, envelope, dek, device.publicKey)
    const intruder = crypto.kemKeygen()
    expect(() => openWithDevice(crypto, shared, intruder.secretKey)).toThrow()
  })
})

describe('CryptoPort seam — deterministic via an injected RNG', () => {
  it('uses the injected randomBytes (the test seam)', async () => {
    let calls = 0
    const fixed = createNobleCrypto({
      randomBytes: (n) => {
        calls++
        return new Uint8Array(n).fill(7)
      },
    })
    const { envelope } = await sealProfile(fixed, PROFILE, 'pw')
    expect(calls).toBeGreaterThan(0)
    expect([...envelope.salt]).toEqual(new Array(16).fill(7))
  })
})
