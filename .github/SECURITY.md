# Security Policy

MEW is local-first and privacy-first by design: there is no MEW server, your
data lives on your device (IndexedDB), and your API keys never leave the device
— they are sent only to the model endpoint you choose. Because MEW handles
cryptographic keys (BYO model keys, the post-quantum crypto-at-rest work, and
gbrain serve tokens), calendar OAuth, and your local week, we take security
reports seriously and handle them privately and gratefully.

Thank you for helping keep MEW and the people who use it safe. Reporting a
vulnerability is a contribution, and we treat it as one.

## Supported versions

Security fixes land on the latest release. We recommend always running the
newest version — the desktop app self-updates from signed GitHub Releases, and
the web build is a static bundle you redeploy.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.9+  | :white_check_mark: |
| < 0.1.9 | :x:                |

If you are on an older build, the first step we will ask for is an upgrade, so
please try the latest version before reporting.

## Scope

**In scope**

- The MEW app (`app/`): scheduling and the week model, the GBrain/nudge logic,
  and the UI.
- Cryptography and key handling: how keys are entered, held on-device, and used;
  crypto-at-rest; the `gbrain serve` token flow.
- The desktop shell (`desktop/`): the Tauri webview, its Content-Security-Policy,
  the loopback OAuth flow, and the **updater signature validation** (the
  `tauri.conf.json` updater public key) — see `desktop/README.md`.
- Data handling and privacy: anything that would cause keys or personal data to
  leave the device against the product's promise.

**Out of scope**

- Vulnerabilities in third-party dependencies — please report those upstream to
  the affected project. If a dependency issue specifically and materially affects
  MEW, we still want to hear about it, but the fix usually lives upstream.
- Findings that require a already-compromised device or OS, social engineering of
  maintainers, or physical access.
- Reports generated solely by automated scanners with no demonstrated impact, and
  best-practice suggestions with no concrete vulnerability (open a regular issue
  or discussion for those instead).

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security problem.** Public
issues disclose the flaw to everyone before there is a fix. Report it privately
through one of these channels.

1. **GitHub private advisory (preferred)** — open a report at
   [github.com/Derpimort/mew/security/advisories/new](https://github.com/Derpimort/mew/security/advisories/new)
   (or the repo's **Security** tab → **Report a vulnerability**). GitHub Private
   Vulnerability Reporting keeps the report private to the maintainers and is the
   fastest route to a response — no mailbox to misconfigure.
2. **Private message to a maintainer** — if you can't use GitHub advisories,
   contact the repository owner ([@Derpimort](https://github.com/Derpimort))
   privately. (A dedicated `security@` mailbox will be listed here once it's
   provisioned and monitored.)

Whichever channel you use, please include as much as you can:

- A description of the issue and its impact (what an attacker could do).
- Steps to reproduce, or a minimal proof of concept.
- The affected version/commit and platform (web or desktop, and OS).
- Any logs, screenshots, or suggested fix you have.

## What to expect (coordinated disclosure)

We follow coordinated vulnerability disclosure (common CVD practice, per ISO/IEC
29147). _(A `.well-known/security.txt` per [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116)
pointing here may be added to the web build later — tracked separately.)_

- **Acknowledgement:** we aim to confirm receipt within **5 business days**.
- **Assessment:** we will work with you to understand and reproduce the issue and
  agree on its severity.
- **Fix & release:** we will develop a fix, release it, and credit you (if you
  wish) in the advisory and release notes.
- **Public disclosure:** we ask that you keep the report private until a fix is
  available or **90 days** have passed from your initial report, whichever comes
  first. We will coordinate timing with you and will not let a report sit
  silently.

We will keep you updated as we work, and we will not take legal action against
researchers who report in good faith, act in scope, and give us a reasonable
window to fix the issue before disclosing.

## Security model notes

A few specifics that frame what "secure" means for MEW:

- **Keys stay on-device.** No MEW server ever sees them; `exportJson` strips
  every key from backups. A bug that causes a key to be persisted to a backup, or
  sent anywhere but the user's chosen endpoint, is in scope.
- **External calendar events are never modified.** They are not ours to move.
- **Graceful degradation is by design.** With no model key, the deterministic
  parser carries the week; with no brain, the keyless floor carries recall. A
  missing key or brain is expected behavior, not a vulnerability.
- **Desktop updates are signed.** The updater validates artifacts against the
  public key committed in `desktop/src-tauri/tauri.conf.json`; losing or
  mishandling the private signing key is part of our security model
  (`desktop/README.md`).
- **Strict CSP.** Both the web (`app/docker/security-headers.conf`) and desktop
  (`tauri.conf.json`) builds ship a strict Content-Security-Policy; CSP-bypass
  findings are in scope.

## Known advisories

<!--
Published security advisories and CVEs will be listed here once the project has
external users. Each entry should link to its GitHub Security Advisory and the
release that fixed it. Intentionally empty for now.
-->

_None published yet._
