/* The crypto factory — selection lives here (coding_principles §7/§9); clients
   just call createCrypto() and use the port. Swapping noble → aws-lc (FIPS) is
   one edit here, zero edits at every call site. */
import { createNobleCrypto } from './noble'
import type { CryptoPort } from './types'

export type CryptoKind = 'noble' | 'aws-lc'

export function createCrypto(kind: CryptoKind = 'noble'): CryptoPort {
  switch (kind) {
    case 'noble':
      return createNobleCrypto()
    case 'aws-lc':
      // GA target: FIPS-validated ML-KEM via a napi-rs addon — wired once
      // native packaging lands (#57 follow-up). Same port, swappable seam.
      throw new Error('aws-lc CryptoPort not built yet — see #57 (napi-rs follow-up)')
  }
}

export type { CryptoPort, SealedBlob, KemKeyPair } from './types'
export { createNobleCrypto } from './noble'
export * from './envelope'
