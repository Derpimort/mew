# ADR — MEW Core runtime + post-quantum crypto stack

_Spike #54, ratified 2026-06-13. Epic #53. Status: **accepted**._

## Context

MEW is moving from a browser SPA (engine + data in IndexedDB) to **Architecture C / "D"**: a standalone **MEW Core** service that owns the profile, runs **on-device by default** (Tauri sidecar beside gbrain) or **hosted per-user** (opt-in), with thin clients. Profile data is encrypted **at rest** under one security model that holds local *and* hosted. Two decisions gate the rest: the Core runtime, and the crypto stack.

## Decision

**Runtime: Bun Core + a `CryptoPort` (crypto as an adapter).**
- Bun runs the existing TS `domain/` + `state/store.ts` **verbatim** — proven in the spike (`bun` executed `domain/time.ts` directly, no build step). Minimal redev was a hard requirement; this meets it.
- Single-binary via `bun build --compile`, spawned as a Tauri sidecar exactly like gbrain (`externalBin`).
- Crypto lives **in Core** (not the Tauri shell) — because the **hosted deploy has no Tauri shell**, and the model must be identical local and hosted.

**Crypto stack (envelope encryption):**
| Layer | Choice |
|---|---|
| At-rest AEAD | **XChaCha20-Poly1305** (already PQ-safe; 24-byte nonce) |
| KDF | **Argon2id** (passphrase → KEK) |
| Key-wrap / sync | **hybrid X25519 + ML-KEM-768 (X-Wing)** |
| Signatures | **none** (at-rest needs only KEM + AEAD + KDF) |

The DEK seals bulk profile rows; the DEK is wrapped (a) under the Argon2id KEK [local unlock] and (b) under a hybrid-KEM shared secret per paired device [sync / **zero-knowledge hosted**: the host stores only ciphertext + a KEM-wrapped DEK it can't open].

**KEM implementation — staged behind `CryptoPort`:**
- **MVP:** pure-TS `@noble/post-quantum` + `@noble/ciphers` (Cure53-audited AEAD) + `hash-wasm` Argon2id. Zero native deps. The KEM is self-audited only, but the **hybrid** construction bounds that (an ML-KEM-impl bug alone can't break it without also breaking X25519).
- **GA / FIPS:** swap the KEM to **`aws-lc-rs`** (the only FIPS 140-3-validated ML-KEM) via a **`napi-rs`** Node-API addon (not the experimental `bun:ffi`). One edit in the factory; zero at call sites.

## Validation (throwaway PoC, ran under Bun)
Envelope round-trip: local passphrase unlock **PASS**, PQ hybrid-KEM unlock **PASS**, AEAD tamper-reject **PASS**. Overhead ~16 B/blob; X-Wing ct ~1.1 KB.

## Alternative considered — Rust Core
Would let a phone self-host its own Core and put crypto natively in-process. **Rejected for now:** it forces a Rust rewrite of `domain/` + `state/store.ts` (against minimal-redev), gbrain stays Bun regardless, and the relay / hosted path already covers mobile without on-phone hosting. Revisit only if "a phone hosts its own Core fully offline" becomes a hard requirement.

## Consequences / risks
- **napi packaging** (only at GA): prebuilt `.node` per target triple, bundled into the sidecar. The MVP pure-TS path avoids this.
- **Key recovery:** lose the passphrase → the local-wrapped DEK is gone. A recovery-code wrap (a third DEK path) and/or a second paired device's KEM-wrap is the recovery story (designed in #57).
- **Argon2id on low-end mobile:** 64 MiB may be heavy — tune per platform.
- **Zero-knowledge host ⇒ no server-side search** over ciphertext; MEW recall already runs Core/client-side via gbrain, so this mostly holds.

## Sources
FIPS 203/204/205 final (2024-08-13); `aws-lc-rs` ML-KEM is FIPS 140-3-validated; RustCrypto `ml-dsa` had a timing leak (RUSTSEC-2025-0144); `@noble/ciphers` Cure53-audited, `@noble/post-quantum` self-audited; Bun docs recommend Node-API over `bun:ffi`; X-Wing (`draft-connolly-cfrg-xwing-kem`).
