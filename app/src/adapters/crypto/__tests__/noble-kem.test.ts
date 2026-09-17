/* X-Wing wire-format pin. @noble/post-quantum 0.7 renamed the 0.6 `XWing` export to
   `ml_kem768_x25519`; this file proves the construction underneath did not move. The known
   answers were produced with @noble/post-quantum 0.6.1's `XWing` (what MEW v0.7.0 shipped)
   from a fixed seed and fixed encapsulation randomness — a future bump that changes the key
   layout, the ciphertext layout or the combiner fails here, before it can strand a paired
   device's KEM key or a stored device wrap. WebCrypto SHA-256 keeps the long pk/ct answers
   short and the file browser-lib clean (no Buffer). */
import { ml_kem768_x25519 } from '@noble/post-quantum/hybrid.js'
import { describe, expect, it } from 'vitest'
import { createNobleCrypto } from '../noble'

const seed = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 255)
const encapsRandomness = Uint8Array.from({ length: 64 }, (_, i) => (i * 13 + 5) & 255)
const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('')
// copy into a fresh ArrayBuffer-backed view: WebCrypto's BufferSource rejects ArrayBufferLike
const sha256 = async (u: Uint8Array) =>
  hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(u))))

/* Recorded with @noble/post-quantum@0.6.1: XWing.keygen(seed), XWing.encapsulate(pk, encapsRandomness). */
const KNOWN = {
  pkLen: 1216,
  skLen: 32,
  ctLen: 1120,
  ssLen: 32,
  pkSha256: 'b7a3e7bec87968b9aa86e0e03b38f471f01f255fa42cbf91e57f5fd8f2358696',
  skHex: '030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dc', // X-Wing's sk IS the seed
  ctSha256: 'eb2e8508fa8a397c71ac0f1809ab74b3d02f9d13ad1c9ebd2f31ce029d866115',
  ssHex: '81a2b7cc4b53feced9dd85f5cd16051c58d1f2e7aebee31259bafd422ed0d5c1',
}

describe('X-Wing KEM (ml_kem768_x25519) keeps the 0.6.1 wire format', () => {
  it('seeded keygen reproduces the 0.6.1 keypair', async () => {
    const { publicKey, secretKey } = ml_kem768_x25519.keygen(seed)
    expect(publicKey.length).toBe(KNOWN.pkLen)
    expect(secretKey.length).toBe(KNOWN.skLen)
    expect(await sha256(publicKey)).toBe(KNOWN.pkSha256)
    expect(hex(secretKey)).toBe(KNOWN.skHex)
  })

  it('deterministic encapsulation reproduces the 0.6.1 ciphertext + shared secret and decapsulates', async () => {
    const { publicKey, secretKey } = ml_kem768_x25519.keygen(seed)
    const { cipherText, sharedSecret } = ml_kem768_x25519.encapsulate(publicKey, encapsRandomness)
    expect(cipherText.length).toBe(KNOWN.ctLen)
    expect(sharedSecret.length).toBe(KNOWN.ssLen)
    expect(await sha256(cipherText)).toBe(KNOWN.ctSha256)
    expect(hex(sharedSecret)).toBe(KNOWN.ssHex)
    expect(hex(ml_kem768_x25519.decapsulate(cipherText, secretKey))).toBe(KNOWN.ssHex)
  })

  it('the port exposes exactly this KEM: fresh keys round-trip with the X-Wing sizes', () => {
    const port = createNobleCrypto()
    const { publicKey, secretKey } = port.kemKeygen()
    const { kemCt, sharedSecret } = port.kemEncapsulate(publicKey)
    expect([publicKey.length, secretKey.length, kemCt.length, sharedSecret.length]).toEqual([
      1216, 32, 1120, 32,
    ])
    expect(hex(port.kemDecapsulate(kemCt, secretKey))).toBe(hex(sharedSecret))
  })
})
