/* The @noble CryptoPort — pure TS, ships now. AEAD is Cure53-audited
   (@noble/ciphers); the KEM is self-audited but hybrid, so an ML-KEM bug
   alone can't break it (an attacker must also break X25519). The FIPS path
   (aws-lc-rs via napi) swaps in behind this same port for GA — see #57. */
import { XWing } from '@noble/post-quantum/hybrid.js'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { argon2id } from 'hash-wasm'
import type { CryptoPort } from './types'

/* Argon2id cost — OWASP-ish interactive floor (64 MiB, t=3). Tune per
   platform later; low-end mobile (phase 7) may need a lighter profile. */
const ARGON = { parallelism: 1, iterations: 3, memorySize: 65536, hashLength: 32 } as const

export interface NobleOpts {
  /** Override the CSPRNG for deterministic tests — the seam (coding_principles §18). */
  randomBytes?: (n: number) => Uint8Array
}

export function createNobleCrypto(opts: NobleOpts = {}): CryptoPort {
  const rand = opts.randomBytes ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)))
  return {
    async kdf(passphrase, salt) {
      return (await argon2id({
        password: passphrase,
        salt,
        ...ARGON,
        outputType: 'binary',
      })) as Uint8Array
    },
    seal(key, plaintext) {
      const nonce = rand(24)
      return { nonce, ct: xchacha20poly1305(key, nonce).encrypt(plaintext) }
    },
    open(key, blob) {
      return xchacha20poly1305(key, blob.nonce).decrypt(blob.ct)
    },
    kemKeygen() {
      const { publicKey, secretKey } = XWing.keygen()
      return { publicKey, secretKey }
    },
    kemEncapsulate(publicKey) {
      const { cipherText, sharedSecret } = XWing.encapsulate(publicKey)
      return { kemCt: cipherText, sharedSecret }
    },
    kemDecapsulate(kemCt, secretKey) {
      return XWing.decapsulate(kemCt, secretKey)
    },
    randomBytes: rand,
  }
}
