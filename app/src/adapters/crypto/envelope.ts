/* The at-rest envelope — one stable scheme (so it's concrete, not abstracted:
   coding_principles §3). Bulk profile sealed with a random DEK; the DEK wrapped
   two ways — under a passphrase key (local unlock) and, per paired device, under
   a hybrid-KEM shared secret (sync / recovery). A host that holds an Envelope
   learns nothing: it never sees the DEK, the KEK, or the passphrase. */
import type { CryptoPort, SealedBlob } from './types'

/** A device that can unlock via the PQ KEM (sync / zero-knowledge host). */
export interface DeviceWrap {
  kemCt: Uint8Array
  wrap: SealedBlob // the DEK, sealed under the KEM shared secret
}

/** Everything that lands at rest. This is the whole on-disk / on-host shape. */
export interface Envelope {
  salt: Uint8Array // Argon2id salt for the passphrase path
  data: SealedBlob // the profile, sealed with the DEK
  localWrap: SealedBlob // DEK sealed under the passphrase-derived KEK
  deviceWraps: DeviceWrap[] // DEK sealed to each paired device's KEM key
}

const DEK_BYTES = 32
const SALT_BYTES = 16

/** Seal a profile under a passphrase. Returns the DEK too, so the caller can
    add device wraps without re-deriving (the DEK never leaves Core). */
export async function sealProfile(
  crypto: CryptoPort,
  plaintext: Uint8Array,
  passphrase: string,
): Promise<{ envelope: Envelope; dek: Uint8Array }> {
  const dek = crypto.randomBytes(DEK_BYTES)
  const salt = crypto.randomBytes(SALT_BYTES)
  const kek = await crypto.kdf(passphrase, salt)
  const envelope: Envelope = {
    salt,
    data: crypto.seal(dek, plaintext),
    localWrap: crypto.seal(kek, dek),
    deviceWraps: [],
  }
  return { envelope, dek }
}

/** Unlock with the passphrase. Throws if it's wrong (the AEAD won't open). */
export async function openProfile(
  crypto: CryptoPort,
  env: Envelope,
  passphrase: string,
): Promise<{ plaintext: Uint8Array; dek: Uint8Array }> {
  const kek = await crypto.kdf(passphrase, env.salt)
  const dek = crypto.open(kek, env.localWrap)
  return { plaintext: crypto.open(dek, env.data), dek }
}

/** Pair a device: wrap the DEK to its KEM public key. Pure — returns a new
    Envelope. A zero-knowledge host can store the result and still never open it. */
export function addDeviceWrap(
  crypto: CryptoPort,
  env: Envelope,
  dek: Uint8Array,
  devicePublicKey: Uint8Array,
): Envelope {
  const { kemCt, sharedSecret } = crypto.kemEncapsulate(devicePublicKey)
  return { ...env, deviceWraps: [...env.deviceWraps, { kemCt, wrap: crypto.seal(sharedSecret, dek) }] }
}

/** Unlock via a device's KEM secret (sync, or recovery from a hosted Core).
    KEM decapsulation never errors on a wrong key — the AEAD on each wrap is
    the real gate, so we try each wrap and let a bad one fail closed. */
export function openWithDevice(
  crypto: CryptoPort,
  env: Envelope,
  deviceSecretKey: Uint8Array,
): { plaintext: Uint8Array; dek: Uint8Array } {
  for (const dw of env.deviceWraps) {
    try {
      const sharedSecret = crypto.kemDecapsulate(dw.kemCt, deviceSecretKey)
      const dek = crypto.open(sharedSecret, dw.wrap)
      return { plaintext: crypto.open(dek, env.data), dek }
    } catch {
      /* not this device's wrap — try the next */
    }
  }
  throw new Error('no device wrap opens with this key')
}
