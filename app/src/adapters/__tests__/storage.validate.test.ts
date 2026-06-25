/* validateSchema — the pure guard the Dexie adapter runs over loaded state after
   a version bump. It's the seam that turns "old data missing a now-required
   field" from silent undefined behavior into a named error with a repair, so it
   tests here, free of IndexedDB (the Dexie round-trip is the contract suite's
   job; this is the logic that decides what's wrong). Issue #182. */
import { describe, expect, it } from 'vitest'
import { validateSchema } from '../storage'
import type { PersistedState } from '../storage-port'
import type { Block, Capture, ChatMessage, MemoryEvent } from '../../domain/types'

function emptyState(over: Partial<PersistedState> = {}): PersistedState {
  return { blocks: [], captures: [], chat: [], memory: [], settings: null, ...over }
}

function block(over: Partial<Block>): Block {
  return {
    id: 'b1',
    title: 'X',
    tag: 'work',
    dayKey: '2026-06-09',
    startMin: 540,
    endMin: 600,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

describe('validateSchema', () => {
  it('clean state has no errors', () => {
    const state = emptyState({
      blocks: [block({})],
      captures: [{ id: 'c1', title: 'cap', createdAt: 1, status: 'open' }],
      chat: [{ id: 'm1', role: 'user', body: 'hi', ts: 1 }],
      memory: [{ id: 'e1', ts: 1, kind: 'completed', dayKey: '2026-06-09' }],
    })
    expect(validateSchema(state)).toEqual([])
  })

  /* The headline acceptance case: a v1 block that loaded without a required
     field is caught — and the finding names the field and a positive repair. */
  it('flags a block missing a required field and suggests a repair', () => {
    const broken = { ...block({}), dayKey: undefined } as unknown as Block
    const errors = validateSchema(emptyState({ blocks: [broken] }))

    expect(errors.length).toBe(1)
    expect(errors[0].table).toBe('blocks')
    expect(errors[0].id).toBe('b1')
    expect(errors[0].message).toContain('dayKey')
    expect(errors[0].repair.length).toBeGreaterThan(0) // a concrete next step, not empty
  })

  it('flags every missing required block field at once (id, dayKey, status)', () => {
    const broken = { title: 'orphan', tag: 'work' } as unknown as Block
    const errors = validateSchema(emptyState({ blocks: [broken] }))
    const fields = errors.map((e) => e.message)
    expect(errors.every((e) => e.table === 'blocks')).toBe(true)
    expect(fields.some((m) => m.includes('`id`'))).toBe(true)
    expect(fields.some((m) => m.includes('`dayKey`'))).toBe(true)
    expect(fields.some((m) => m.includes('`status`'))).toBe(true)
  })

  it('flags a capture with no id', () => {
    const broken = { title: 'no id' } as unknown as Capture
    const errors = validateSchema(emptyState({ captures: [broken] }))
    expect(errors.length).toBe(1)
    expect(errors[0].table).toBe('captures')
    expect(errors[0].message).toContain('`id`')
  })

  it('flags a chat message missing its ordering timestamp', () => {
    const broken = { id: 'm1', role: 'user', body: 'hi' } as unknown as ChatMessage
    const errors = validateSchema(emptyState({ chat: [broken] }))
    expect(errors.length).toBe(1)
    expect(errors[0].table).toBe('chat')
    expect(errors[0].message).toContain('`ts`')
  })

  it('flags memory events missing id, ts, or kind', () => {
    const broken = { dayKey: '2026-06-09' } as unknown as MemoryEvent
    const errors = validateSchema(emptyState({ memory: [broken] }))
    const fields = errors.map((e) => e.message)
    expect(errors.every((e) => e.table === 'memory')).toBe(true)
    expect(fields.some((m) => m.includes('`id`'))).toBe(true)
    expect(fields.some((m) => m.includes('`ts`'))).toBe(true)
    expect(fields.some((m) => m.includes('`kind`'))).toBe(true)
  })

  /* Orphaned reference: a soft problem. It's reported (so it shows in the audit
     trail) but worded as repair-in-place, never "missing required" — history is
     allowed to outlive its block, so this must NOT trigger a table clear. */
  it('reports an orphaned memory→block reference as repairable, not missing', () => {
    const memory = [
      {
        id: 'e1',
        ts: 1,
        kind: 'completed',
        dayKey: '2026-06-09',
        blockId: 'gone',
      } as unknown as MemoryEvent,
    ]
    const errors = validateSchema(emptyState({ memory }))
    expect(errors.length).toBe(1)
    expect(errors[0].table).toBe('memory')
    expect(errors[0].message).toContain('no longer in the week')
    expect(errors[0].message.includes('missing required')).toBe(false)
  })

  it('does not flag a memory→block reference that resolves', () => {
    const state = emptyState({
      blocks: [block({ id: 'here' })],
      memory: [
        {
          id: 'e1',
          ts: 1,
          kind: 'completed',
          dayKey: '2026-06-09',
          blockId: 'here',
        } as unknown as MemoryEvent,
      ],
    })
    expect(validateSchema(state)).toEqual([])
  })

  /* Reading an old backup that predates a field returns a detailed list, never
     a throw — the caller (load) decides repair vs warn from this. */
  it('returns a detailed list (never throws) for a multi-table-corrupt backup', () => {
    const state = emptyState({
      blocks: [{ title: 'no id no day' } as unknown as Block],
      memory: [{ dayKey: '2026-06-09' } as unknown as MemoryEvent],
    })
    const errors = validateSchema(state)
    expect(errors.length).toBeGreaterThan(1)
    expect(new Set(errors.map((e) => e.table))).toEqual(new Set(['blocks', 'memory']))
    for (const e of errors) {
      expect(typeof e.message).toBe('string')
      expect(typeof e.repair).toBe('string')
    }
  })

  /* Defensive: a malformed export where a table is absent entirely must not
     throw (no undefined behavior) — the missing table reads as empty. */
  it('tolerates absent tables in a malformed state', () => {
    const partial = { blocks: [block({})] } as unknown as PersistedState
    expect(() => validateSchema(partial)).not.toThrow()
    expect(validateSchema(partial)).toEqual([])
  })
})
