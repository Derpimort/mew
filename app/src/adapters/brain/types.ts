/* BrainPort — the engine-agnostic contract between MEW and a knowledge
   brain. MEW is a SENSE (it writes what happens) and a recall CONSUMER (it
   reads what matters into the model's context). Pure contract: any
   `gbrain serve` endpoint satisfies it — a desktop sidecar, a dev's own
   install, or a hosted engine. Every implementation must degrade
   gracefully: a dead brain can never block the week. */

export interface BrainPage {
  slug: string
  /** page taxonomy: task | person | week | pref | … (brains may auto-type) */
  type?: string
  /** full markdown body (frontmatter added by the adapter); omit for
      timeline-only writes — the target pages are stubbed if missing */
  body?: string
  tags?: string[]
  /** slugs this page links to (person/<name>, week/<dayKey>, …) */
  links?: string[]
  /** timeline entries to attach: date is YYYY-MM-DD */
  timeline?: { slug: string; date: string; summary: string }[]
}

export interface RecallOpts {
  limit?: number
}

/** The structured rule shape lives in the domain (it outlives any brain). */
export type { PrefKind, PrefPayload } from '../../domain/types'
import type { PrefPayload } from '../../domain/types'

export interface BrainPort {
  /** Fire-and-forget write; failures warn and flip health, never throw. */
  ingest(page: BrainPage): Promise<void>
  /** Hybrid recall: short, citable lines for the model's context. Empty on
      any failure — silence, not error. */
  recall(question: string, opts?: RecallOpts): Promise<string[]>
  /** Cheap reachability probe (also flipped by every failed call). */
  health(): Promise<boolean>
  /** Every stored preference (tag=preference), newest first; [] on failure. */
  listPrefs(): Promise<PrefPayload[]>
}
