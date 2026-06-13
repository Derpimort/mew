/* CryptoPort — the seam between MEW Core and a crypto implementation.
   Two impls are a real, present force: @noble (pure TS, ships now) and a
   FIPS-validated aws-lc-rs napi addon (GA). Only the primitives vary here;
   the envelope *policy* (envelope.ts) is one stable scheme and lives above
   this port. Ratified in the #54 spike. */

/** XChaCha20-Poly1305 output: a 24-byte nonce + (ciphertext || 16-byte tag). */
export interface SealedBlob {
  nonce: Uint8Array
  ct: Uint8Array
}

/** A hybrid X25519 + ML-KEM-768 (X-Wing) key pair. */
export interface KemKeyPair {
  publicKey: Uint8Array
  secretKey: Uint8Array
}

export interface CryptoPort {
  /** Argon2id: passphrase + salt → a 32-byte key-encryption key. */
  kdf(passphrase: string, salt: Uint8Array): Promise<Uint8Array>
  /** AEAD seal (XChaCha20-Poly1305). */
  seal(key: Uint8Array, plaintext: Uint8Array): SealedBlob
  /** AEAD open — throws if the key is wrong or the blob was tampered. */
  open(key: Uint8Array, blob: SealedBlob): Uint8Array
  /** Hybrid KEM key generation (X-Wing). */
  kemKeygen(): KemKeyPair
  /** Encapsulate to a public key → a transportable ciphertext + shared secret. */
  kemEncapsulate(publicKey: Uint8Array): { kemCt: Uint8Array; sharedSecret: Uint8Array }
  /** Decapsulate with a secret key → the shared secret (implicit-rejection on
      a wrong key, so callers MUST verify via the AEAD that wraps it). */
  kemDecapsulate(kemCt: Uint8Array, secretKey: Uint8Array): Uint8Array
  /** CSPRNG — a seam: tests inject a deterministic source. */
  randomBytes(n: number): Uint8Array
}
