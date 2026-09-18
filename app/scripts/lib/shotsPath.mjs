/* Where a proof's PNGs go, as one rule in one place.

   Nineteen files under `app/shots/` are tracked — README embeds two of them and
   CONTRIBUTING names an owner for each — while the directory itself is
   gitignored as a build artifact. Five proofs write exactly those nineteen
   names, so every run rewrote committed evidence in place, and CONTRIBUTING's
   remedy was remembering to `git checkout -- app/shots` afterwards. In one
   night two gate runs rewrote seven and then sixteen of them; both were caught
   because someone looked, which is not a mechanism.

   A proof that silently rewrites the evidence it is judged against can be made
   to agree with whatever the code now does. So the overwrite costs a keystroke
   and the restore costs nothing:

     pnpm shoot                   → shots/latest/  (ignored; git status stays clean)
     PIN_CANON=1 pnpm shoot       → shots/         (the tracked names, in place)
     git add -f app/shots/<file>  → review the image diff, then commit it

   Kept separate from lib/harness.mjs so the rule can be unit-tested without
   importing playwright-core, which vitest deliberately keeps out of its run. */

/** The directory a run writes to, relative to `app/`. */
export function shotsRelDir(env = process.env) {
  return env.PIN_CANON === '1' ? 'shots' : 'shots/latest'
}

/** Whether this run is deliberately re-pinning committed canon. */
export function isPinningCanon(env = process.env) {
  return env.PIN_CANON === '1'
}
