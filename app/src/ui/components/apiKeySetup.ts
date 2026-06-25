/* Pure helpers for the guided API-key setup (#161), kept out of the component
   file so the JSX module exports only components (react-refresh) — same split as
   dialGeometry / lanes / orbitGeometry. No React, no DOM: unit-testable directly. */

/** Which key affordance the Privacy & model card shows for the active provider:
    - 'edit'   — the raw password field is open (entered the dense form on purpose);
    - 'masked' — a key is set: the masked field to view/swap it (the normal form);
    - 'setup'  — no key yet and not editing: the guided "Set up AI" button replaces
                 the dense form (#161 acceptance: dense form hidden until a key). */
export function keySetupView(activeKey: string, editing: boolean): 'edit' | 'masked' | 'setup' {
  if (editing) return 'edit'
  return activeKey.trim().length > 0 ? 'masked' : 'setup'
}
