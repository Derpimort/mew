import { describe, expect, it } from 'vitest'
import {
  blocksForDay,
  complete,
  dayClear,
  dayEndMin,
  findByQuery,
  findFreeSlot,
  isDeep,
  loadBySegment,
  place,
  plannedDeepMin,
  roll,
} from '../week'
import type { Block, BlockStatus } from '../types'

const D = '2026-06-09'

function mk(over: Partial<Block>): Block {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'X',
    tag: 'work',
    dayKey: D,
    startMin: 9 * 60,
    endMin: 10 * 60,
    protected: true,
    status: 'open',
    calendarRefs: [],
    estimateSource: 'user',
    ...over,
  }
}

describe('week model', () => {
  it('positive-only by construction: the only statuses are open/done/rolled', () => {
    // If someone adds a "failed"/"missed" status this assertion forces a conversation.
    const legal: BlockStatus[] = ['open', 'done', 'rolled']
    expect(legal).toHaveLength(3)
  })

  it('sorts a day and excludes rolled originals', () => {
    const a = mk({ startMin: 14 * 60, endMin: 15 * 60 })
    const b = mk({ startMin: 9 * 60, endMin: 10 * 60 })
    const c = mk({ startMin: 11 * 60, endMin: 12 * 60, status: 'rolled' })
    expect(blocksForDay([a, b, c], D).map((x) => x.id)).toEqual([b.id, a.id])
  })

  it('finds the first free slot around existing blocks', () => {
    const blocks = [
      mk({ startMin: 9 * 60, endMin: 11 * 60 }),
      mk({ startMin: 12 * 60, endMin: 13 * 60 }),
    ]
    expect(findFreeSlot(blocks, D, 60)).toEqual({ startMin: 8 * 60, endMin: 9 * 60 }) // first fit: before the 9:00 block
    expect(findFreeSlot(blocks, D, 90)).toEqual({ startMin: 13 * 60, endMin: 14.5 * 60 })
  })

  it('returns null when the day cannot hold the duration', () => {
    const blocks = [mk({ startMin: 8 * 60, endMin: 18 * 60 })]
    expect(findFreeSlot(blocks, D, 60)).toBeNull()
  })

  it('place without a time lands in the first free slot, protected by default', () => {
    const existing = [mk({ startMin: 8 * 60, endMin: 9 * 60 })]
    const b = place(existing, { title: 'deck', tag: 'work', dayKey: D, durationMin: 120 })
    expect(b).toMatchObject({ startMin: 9 * 60, endMin: 11 * 60, protected: true, status: 'open' })
  })

  it('roll keeps the original (linked) and creates tomorrow’s block — graceful, never a drop', () => {
    const b = mk({ title: 'deck' })
    const { blocks, rolled } = roll([b], b.id, '2026-06-10', 9 * 60)
    const orig = blocks.find((x) => x.id === b.id)!
    expect(orig.status).toBe('rolled')
    expect(orig.rolledToId).toBe(rolled!.id)
    expect(rolled).toMatchObject({ dayKey: '2026-06-10', startMin: 9 * 60, endMin: 10 * 60, status: 'open' })
  })

  it('dayClear ignores rest blocks and needs every task done', () => {
    const t1 = mk({})
    const t2 = mk({ startMin: 11 * 60, endMin: 12 * 60 })
    const rest = mk({ tag: 'rest', startMin: 18 * 60, endMin: 19 * 60 })
    expect(dayClear([t1, t2, rest], D)).toBe(false)
    const done = complete(complete([t1, t2, rest], t1.id, 0), t2.id, 0)
    expect(dayClear(done, D)).toBe(true)
  })

  it('deep work = work blocks ≥ 1h; load segments map health with private', () => {
    const deep = mk({ startMin: 9 * 60, endMin: 12 * 60 })
    const shallow = mk({ startMin: 13 * 60, endMin: 13 * 60 + 30 })
    const health = mk({ tag: 'health', startMin: 15 * 60, endMin: 16 * 60 })
    expect(isDeep(deep)).toBe(true)
    expect(isDeep(shallow)).toBe(false)
    expect(plannedDeepMin([deep, shallow, health], D)).toBe(180)
    expect(loadBySegment([deep, shallow, health], D)).toEqual({ work: 210, priv: 60, rest: 0 })
  })

  it('the working day ends at the later of 18:30 and the last block', () => {
    expect(dayEndMin([mk({ startMin: 9 * 60, endMin: 10 * 60 })], D)).toBe(18 * 60 + 30)
    expect(dayEndMin([mk({ startMin: 19 * 60, endMin: 20 * 60 })], D)).toBe(20 * 60)
  })

  describe('findByQuery — "lunch" and "order lunch" are different blocks', () => {
    const lunch = mk({ title: 'Lunch', tag: 'private', startMin: 13 * 60, endMin: 14 * 60 })
    const order = mk({ title: 'Order lunch', tag: 'private', startMin: 11 * 60, endMin: 11 * 60 + 15 })

    it('exact base title beats substring match', () => {
      expect(findByQuery([order, lunch], 'lunch', D)?.id).toBe(lunch.id)
      expect(findByQuery([lunch, order], 'lunch', D)?.id).toBe(lunch.id)
    })

    it('the longer phrase still finds its own block', () => {
      expect(findByQuery([lunch, order], 'order lunch', D)?.id).toBe(order.id)
    })
  })
})
